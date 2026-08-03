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
//
// Separately: whenever this run flips a profile's active_status from
// not-OB to OB for someone who currently holds executive tier (アプリ管理者
// permissions, profiles.club_role_id -> club_roles.tier = 'executive'),
// that's a real person "graduating" in the club's internal accounting
// while still holding admin access. We push a LINE nudge to that person
// and to every other current executive so a successor gets confirmed
// before their involvement actually ends. This is naturally idempotent:
// it only fires on the run where the stored active_status value actually
// changes to OB, so re-running the same day is a no-op here too.
//
// Also separately: for *every* profile whose active_status newly becomes OB
// this run (not just executives), we reassign profiles.club_role_id to the
// seeded OB/alumni-tier role (club_roles id=14), which naturally clears
// whatever specific position (幹事長, 広報, ...) they held. This is a normal
// `profiles` UPDATE, so the zero-executive-lockout trigger
// (prevent_zero_executive_lockout) fires as usual -- if this profile is
// currently the sole remaining executive, the trigger raises and blocks
// just that one update; we catch it per-profile (one UPDATE statement per
// profile, so one block never rolls back anyone else's role-clear) and
// report it back as `roleClearBlocked`, leaving that person's role
// untouched until a successor is promoted -- exactly what the succession
// nudge above exists to prompt.

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'

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
      .select('id, full_name, cohort_year, club_role_id')
      .not('cohort_year', 'is', null)
    if (profilesErr) throw profilesErr

    // Reverse lookup (value id -> label) for active_status, used below to
    // tell whether a profile's *previous* active_status was already OB.
    const activeLabelByValueId = new Map<string, string>()
    for (const [label, id] of activeValueIdByLabel) activeLabelByValueId.set(id, label)

    // Current executive-tier roster (アプリ管理者), independent of
    // cohort_year -- this function never writes club_role_id, so this is
    // simply "who holds admin access right now." Used both to check
    // whether a newly-retired profile is one of them, and to know who to
    // notify.
    const { data: execRoles, error: execRolesErr } = await supabase.from('club_roles').select('id').eq('tier', 'executive')
    if (execRolesErr) throw execRolesErr
    const executiveRoleIds = new Set((execRoles ?? []).map((r) => r.id))

    const { data: executiveProfiles, error: executiveProfilesErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('club_role_id', [...executiveRoleIds])
    if (executiveProfilesErr) throw executiveProfilesErr

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

    // Profiles whose active_status is newly flipping to OB *this run* (was
    // not already OB) and who currently hold executive tier -- these are
    // the people who need a succession nudge below.
    const newlyRetiredExecutives: { id: string; full_name: string }[] = []

    // Every profile whose active_status is newly flipping to OB *this run*
    // (was not already OB), executive or not -- these all get their
    // club_role_id reassigned to the seeded OB role below.
    const newlyOB: { id: string; full_name: string }[] = []

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

      const currentActiveValueId = currentActiveByProfile.get(p.id)
      if (currentActiveValueId !== desiredActiveValueId) {
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

        const previousActiveLabel = currentActiveValueId ? activeLabelByValueId.get(currentActiveValueId) : undefined
        if (activeLabel === 'OB' && previousActiveLabel !== 'OB') {
          newlyOB.push({ id: p.id, full_name: p.full_name })
          if (executiveRoleIds.has(p.club_role_id)) {
            newlyRetiredExecutives.push({ id: p.id, full_name: p.full_name })
          }
        }
      }
    }

    // Role-clear: for every profile that just newly became OB, reassign
    // club_role_id to the seeded OB/alumni-tier role (id 14), which
    // naturally clears whatever specific position they held. This is a
    // normal `profiles` UPDATE (not a bypass), so
    // prevent_zero_executive_lockout fires as usual -- one UPDATE per
    // profile, so a block on one person's update can never roll back
    // another person's role-clear in the same run.
    const OB_ROLE_ID = 14
    let roleClears = 0
    const roleClearBlocked: { id: string; full_name: string; reason: string }[] = []
    for (const retiree of newlyOB) {
      const { error: roleErr } = await supabase.from('profiles').update({ club_role_id: OB_ROLE_ID }).eq('id', retiree.id)
      if (roleErr) {
        console.log(`role-clear blocked for ${retiree.full_name} (${retiree.id}): ${roleErr.message}`)
        roleClearBlocked.push({ id: retiree.id, full_name: retiree.full_name, reason: roleErr.message })
        continue
      }
      roleClears++
    }

    // Succession nudge: for each profile that just auto-retired (OB) while
    // still holding executive tier, LINE-push everyone who currently holds
    // executive tier (including the retiree themself, since their
    // club_role_id hasn't changed -- only their OB status has) so a
    // successor gets confirmed before their admin access should lapse.
    const successionNudges: Record<string, unknown> = {}
    if (newlyRetiredExecutives.length > 0) {
      const executiveNames = (executiveProfiles ?? []).map((e) => e.full_name)
      const executiveIds = (executiveProfiles ?? []).map((e) => e.id)

      const { data: identities, error: identitiesErr } = await supabase
        .from('line_identities')
        .select('profile_id, line_user_id')
        .in('profile_id', executiveIds)
      if (identitiesErr) throw identitiesErr
      const lineUserIdByProfile = new Map((identities ?? []).map((i) => [i.profile_id, i.line_user_id]))

      const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!

      for (const retiree of newlyRetiredExecutives) {
        const text = [
          `🎓 ${retiree.full_name}さんのステータスが自動的に「OB」に切り替わりました`,
          `${retiree.full_name}さんは現在も「アプリ管理者」の権限を保持しています。後任のアプリ管理者が決まっているか、このまま権限を持ち続けて問題ないか、確認をお願いします。`,
          '',
          '現在のアプリ管理者:',
          ...executiveNames.map((n) => `・${n}`),
        ]
          .join('\n')
          .slice(0, 4900)

        const notified: string[] = []
        const noLineIdentity: string[] = []
        const failed: Record<string, string> = {}

        for (const exec of executiveProfiles ?? []) {
          const lineUserId = lineUserIdByProfile.get(exec.id)
          if (!lineUserId) {
            console.log(`succession nudge: skipping ${exec.full_name} (${exec.id}) -- no linked LINE id`)
            noLineIdentity.push(exec.full_name)
            continue
          }
          const res = await fetch(LINE_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
          })
          if (!res.ok) {
            const errText = await res.text()
            console.error(`succession nudge: LINE push to ${exec.full_name} (${exec.id}) failed:`, errText)
            failed[exec.full_name] = errText
            continue
          }
          notified.push(exec.full_name)
        }

        successionNudges[retiree.id] = { retiree: retiree.full_name, notified, noLineIdentity, failed }
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
        roleClears,
        roleClearBlocked,
        successionNudges,
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
