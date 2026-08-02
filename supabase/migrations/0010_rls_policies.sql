-- Enable RLS everywhere.
alter table club_roles enable row level security;
alter table profiles enable row level security;
alter table line_identities enable row level security;
alter table announcements enable row level security;
alter table club_events enable row level security;
alter table event_registrations enable row level security;
alter table status_posts enable row level security;
alter table tasks enable row level security;
alter table emergency_info enable row level security;
alter table external_links enable row level security;
alter table financial_records enable row level security;
alter table membership_fees enable row level security;
alter table handover_documents enable row level security;
alter table safety_training_modules enable row level security;
alter table safety_training_questions enable row level security;
alter table safety_training_results enable row level security;
alter table trip_tips enable row level security;
alter table trip_tip_photos enable row level security;
alter table account_directory enable row level security;
alter table account_directory_access_log enable row level security;
alter table ai_secretary_conversations enable row level security;
alter table ai_secretary_messages enable row level security;
alter table reminder_jobs enable row level security;

-- club_roles: everyone signed in can read (needed to render role labels), executive-only write.
create policy "read club_roles" on club_roles for select using (auth.uid() is not null);
create policy "executive write club_roles" on club_roles for all using (is_executive()) with check (is_executive());

-- profiles: self always readable/writable; officer+ can read everyone; executive can write anyone.
create policy "read own profile" on profiles for select using (id = auth.uid());
create policy "officer+ read all profiles" on profiles for select using (is_officer_or_above());
create policy "self update own profile" on profiles for update using (id = auth.uid());
create policy "executive write any profile" on profiles for all using (is_executive()) with check (is_executive());

-- Prevent members from promoting themselves by editing their own club_role_id/status.
create or replace function prevent_self_role_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and not is_executive() then
    new.club_role_id := old.club_role_id;
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_self_role_escalation
  before update on profiles
  for each row execute function prevent_self_role_escalation();

-- line_identities: no direct client access; only Edge Functions via service role touch this.

-- announcements: readable by any signed-in member, executive-only write.
create policy "read announcements" on announcements for select using (auth.uid() is not null);
create policy "executive write announcements" on announcements for all using (is_executive()) with check (is_executive());

-- club_events: readable by any signed-in member, executive-only write.
create policy "read club_events" on club_events for select using (auth.uid() is not null);
create policy "executive write club_events" on club_events for all using (is_executive()) with check (is_executive());

-- event_registrations: members manage their own RSVP; officer+ can see everyone's.
create policy "read own registration" on event_registrations for select using (profile_id = auth.uid());
create policy "officer+ read all registrations" on event_registrations for select using (is_officer_or_above());
create policy "self write own registration" on event_registrations for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- status_posts: live board, readable by any signed-in member; author or executive can modify/delete.
create policy "read status_posts" on status_posts for select using (auth.uid() is not null);
create policy "create own status_post" on status_posts for insert with check (author_id = auth.uid());
create policy "owner or executive update status_post" on status_posts for update using (author_id = auth.uid() or is_executive());
create policy "owner or executive delete status_post" on status_posts for delete using (author_id = auth.uid() or is_executive());

-- tasks: officer+ see/manage everything; general/alumni only see tasks assigned to them.
create policy "officer+ read all tasks" on tasks for select using (is_officer_or_above());
create policy "read own assigned task" on tasks for select using (assigned_to = auth.uid());
create policy "executive create tasks" on tasks for insert with check (is_executive());
create policy "assignee or executive update task" on tasks for update using (assigned_to = auth.uid() or is_executive());
create policy "executive delete tasks" on tasks for delete using (is_executive());

-- emergency_info: must stay reachable to any signed-in member regardless of tier.
create policy "read emergency_info" on emergency_info for select using (auth.uid() is not null);
create policy "executive write emergency_info" on emergency_info for all using (is_executive()) with check (is_executive());

-- external_links: readable by any signed-in member, executive-only write.
create policy "read external_links" on external_links for select using (auth.uid() is not null);
create policy "executive write external_links" on external_links for all using (is_executive()) with check (is_executive());

-- financial_records: executive-only, full stop.
create policy "executive read financial_records" on financial_records for select using (is_executive());
create policy "executive write financial_records" on financial_records for all using (is_executive()) with check (is_executive());

-- membership_fees: members see their own fee status; executive manages everyone's.
create policy "self read own fee" on membership_fees for select using (profile_id = auth.uid());
create policy "executive read all fees" on membership_fees for select using (is_executive());
create policy "executive write fees" on membership_fees for all using (is_executive()) with check (is_executive());

-- handover_documents: officer+ read, executive write.
create policy "officer+ read handover_documents" on handover_documents for select using (is_officer_or_above());
create policy "executive write handover_documents" on handover_documents for all using (is_executive()) with check (is_executive());

-- safety_training: any signed-in member can read modules/questions and record their own results.
create policy "read safety_training_modules" on safety_training_modules for select using (auth.uid() is not null);
create policy "executive write safety_training_modules" on safety_training_modules for all using (is_executive()) with check (is_executive());
create policy "read safety_training_questions" on safety_training_questions for select using (auth.uid() is not null);
create policy "executive write safety_training_questions" on safety_training_questions for all using (is_executive()) with check (is_executive());
create policy "self write own training result" on safety_training_results for insert with check (profile_id = auth.uid());
create policy "self read own training result" on safety_training_results for select using (profile_id = auth.uid());
create policy "officer+ read all training results" on safety_training_results for select using (is_officer_or_above());

-- trip_tips: any signed-in member can contribute; author or executive can edit/delete.
create policy "read trip_tips" on trip_tips for select using (auth.uid() is not null);
create policy "create own trip_tip" on trip_tips for insert with check (author_id = auth.uid());
create policy "author or executive update trip_tip" on trip_tips for update using (author_id = auth.uid() or is_executive());
create policy "author or executive delete trip_tip" on trip_tips for delete using (author_id = auth.uid() or is_executive());
create policy "read trip_tip_photos" on trip_tip_photos for select using (auth.uid() is not null);
create policy "manage trip_tip_photos via parent" on trip_tip_photos for all using (
  exists (select 1 from trip_tips t where t.id = trip_tip_id and (t.author_id = auth.uid() or is_executive()))
) with check (
  exists (select 1 from trip_tips t where t.id = trip_tip_id and (t.author_id = auth.uid() or is_executive()))
);

-- account_directory: gated by min_tier column; secrets themselves live in Vault, not here.
create policy "tiered read account_directory" on account_directory for select using (
  (min_tier = 'officer' and is_officer_or_above()) or (min_tier = 'executive' and is_executive())
);
create policy "executive write account_directory" on account_directory for all using (is_executive()) with check (is_executive());
create policy "executive read access log" on account_directory_access_log for select using (is_executive());
create policy "officer+ insert access log" on account_directory_access_log for insert with check (is_officer_or_above());

-- ai_secretary: members see only their own conversation history; executive can audit all.
create policy "self read own conversations" on ai_secretary_conversations for select using (profile_id = auth.uid());
create policy "executive read all conversations" on ai_secretary_conversations for select using (is_executive());
create policy "self read own messages" on ai_secretary_messages for select using (
  exists (select 1 from ai_secretary_conversations c where c.id = conversation_id and c.profile_id = auth.uid())
);
create policy "executive read all messages" on ai_secretary_messages for select using (is_executive());

-- reminder_jobs: executive-managed; members can see reminders addressed to them.
create policy "self read own reminders" on reminder_jobs for select using (profile_id = auth.uid());
create policy "executive manage reminders" on reminder_jobs for all using (is_executive()) with check (is_executive());
