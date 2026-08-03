create table if not exists reimbursement_requests (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references profiles(id) on delete cascade,
  amount_jpy integer not null,
  description text not null,
  receipt_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table reimbursement_requests enable row level security;

create policy "self read own reimbursement" on reimbursement_requests for select using (submitted_by = auth.uid());
create policy "executive read all reimbursements" on reimbursement_requests for select using (is_executive());
create policy "self create own reimbursement" on reimbursement_requests for insert with check (submitted_by = auth.uid());
create policy "self update own pending reimbursement" on reimbursement_requests for update
  using (submitted_by = auth.uid() and status = 'pending')
  with check (submitted_by = auth.uid());
create policy "executive update any reimbursement" on reimbursement_requests for update using (is_executive()) with check (is_executive());
create policy "self delete own pending reimbursement" on reimbursement_requests for delete using (submitted_by = auth.uid() and status = 'pending');
create policy "executive delete any reimbursement" on reimbursement_requests for delete using (is_executive());

-- Receipt photos: private bucket, path convention receipts/<profile_id>/<file>.
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "self read own receipts" on storage.objects for select
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "executive read all receipts" on storage.objects for select
  using (bucket_id = 'receipts' and is_executive());
create policy "self upload own receipts" on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "self delete own receipts" on storage.objects for delete
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
