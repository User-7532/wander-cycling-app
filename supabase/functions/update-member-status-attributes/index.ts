import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Runs daily (via pg_cron, see migration 0035) and keeps the two
// system-managed member attributes -- grade_year (学年) and active_status
// (現役/OB) -- in sync with each profile's cohort_year (入部年度), purely as
// a function of cohort_year + today's date (JST). Existing
// profile_attribute_values rows are never read as an input to the
// computation -- both values are recomputed fresh every run from
// cohort_year alone, then written only if they differ from what's
// currently assigned, so re-running this on the same day is a no-op.
//
// Japan's academic year runs April(4)-March(3). For a person who joined as
// 1年 in cohort_year Y:
//   - grade advances every April 1st: grade = academicYear(today) - Y + 1.
//     1<=grade<=4 -> `${grade}年`, grade>=5 -> '卒業', grade<1 -> skip this
//     profile entirely (a future/invalid cohort_year is a data-entry
//     problem for a human to fix, not something to guess about).
//   - active_status flips to OB from September 1st of their 3rd academic
//     year onward (Sept 1 of Y+2), independent of the grade label -- not
//     derived from it.

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const GRADE_LABELS = ['1年', '2年', '3年', '4年', '卒業']
const ACTIVE_LABELS = ['現役', 'OB']

// Today's date in JST as {year, month (1-12), day}, independent of whatever
// timezone the function's host happens to run in.
function todayJST(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

// Comparable integer for a y/m/d date, e.g. 2026-09-01 -> 20260901.
function dateNum(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day
}

serve(async (req) => {
  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { year, month, day } = todayJST()
    const academicYear = month >= 4 ? year : year - 1
    const todayNum = dateNum(year, month, day)

    // Look up the two system attributes and their fixed value ids by label.
    const { data: attrs, error: attrsErr } = await supabase
      .from('member_attributes')
      .select('id, key')
      .in('key', ['grade_year', 'active_status'])
    if (attrsErr) throw attrsErr
    const gradeAttr = attrs?.find((a) => a.key === 'grade_year')
    const activeAttr = attrs?.find((a) => a.key === 'active_status')
    if (!gradeAttr || !activeAttr) throw new Error('grade_year / active_status attribute row not found')

    const { data: values, error: valuesErr } = await supabase
      .from('member_attribute_values')
      .select('id, value, attribute_id')
      .in('attribute_id', [gradeAttr.id, activeAttr.id])
    if (valuesErr) throw valuesErr

    const gradeValueIdByLabel = new Map<string, string>()
    const activeValueIdByLabel = new Map<string, string>()
    for (const v of values ?? []) {
      if (v.attribute_id === gradeAttr.id) gradeValueIdByLabel.set(v.value, v.id)
      if (v.attribute_id === activeAttr.id) activeValueIdByLabel.set(v.value, v.id)
    }
    for (const label of GRADE_LABELS) {
      if (!gradeValueIdByLabel.has(label)) throw new Error(`missing grade_year value: ${label}`)
    }
    for (const label of ACTIVE_LABELS) {
      if (!activeValueIdByLabel.has(label)) throw new Error(`missing active_status value: ${label}`)
    }
    const gradeValueIds = [...gradeValueIdByLabel.values()]
    const activeValueIds = [...activeValueIdByLabel.values()]

    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id, cohort_year')
      .not('cohort_year', 'is', null)
    if (profilesErr) throw profilesErr

    // Current assignments under either system attribute, for every profile
    // with a cohort_year, in one query -- diffed against the freshly
    // computed values below so we only write what actually changed.
    const profileIds = (profiles ?? []).map((p) => p.id)
    const currentGradeByProfile = new Map<string, string>()
    const currentActiveByProfile = new Map<string, string>()
    if (profileIds.length > 0) {
      const { data: current, error: currentErr } = await supabase
        .from('profile_attribute_values')
        .select('profile_id, attribute_value_id')
        .in('profile_id', profileIds)
        .in('attribute_value_id', [...gradeValueIds, ...activeValueIds])
      if (currentErr) throw currentErr
      const gradeValueIdSet = new Set(gradeValueIds)
      const activeValueIdSet = new Set(activeValueIds)
      for (const row of current ?? []) {
        if (gradeValueIdSet.has(row.attribute_value_id)) currentGradeByProfile.set(row.profile_id, row.attribute_value_id)
        if (activeValueIdSet.has(row.attribute_value_id)) currentActiveByProfile.set(row.profile_id, row.attribute_value_id)
      }
    }

    let gradeUpdates = 0
    let activeUpdates = 0
    let skipped = 0

    for (const p of profiles ?? []) {
      const cohortYear = p.cohort_year as number
      const grade = academicYear - cohortYear + 1

      if (grade < 1) {
        skipped++
        continue
      }

      const gradeLabel = grade <= 4 ? `${grade}年` : '卒業'
      const desiredGradeValueId = gradeValueIdByLabel.get(gradeLabel)!

      const retirementNum = dateNum(cohortYear + 2, 9, 1)
      const activeLabel = todayNum >= retirementNum ? 'OB' : '現役'
      const desiredActiveValueId = activeValueIdByLabel.get(activeLabel)!

      if (currentGradeByProfile.get(p.id) !== desiredGradeValueId) {
        const { error: delErr } = await supabase
          .from('profile_attribute_values')
          .delete()
          .eq('profile_id', p.id)
          .in('attribute_value_id', gradeValueIds)
        if (delErr) throw delErr
        const { error: insErr } = await supabase
          .from('profile_attribute_values')
          .insert({ profile_id: p.id, attribute_value_id: desiredGradeValueId })
        if (insErr) throw insErr
        gradeUpdates++
      }

      if (currentActiveByProfile.get(p.id) !== desiredActiveValueId) {
        const { error: delErr } = await supabase
          .from('profile_attribute_values')
          .delete()
          .eq('profile_id', p.id)
          .in('attribute_value_id', activeValueIds)
        if (delErr) throw delErr
        const { error: insErr } = await supabase
          .from('profile_attribute_values')
          .insert({ profile_id: p.id, attribute_value_id: desiredActiveValueId })
        if (insErr) throw insErr
        activeUpdates++
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        academicYear,
        profilesConsidered: profiles?.length ?? 0,
        gradeUpdates,
        activeUpdates,
        skipped,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
