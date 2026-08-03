-- The email/phone number used for 2FA or account recovery on a shared
-- service is often, in practice, someone's personal contact rather than a
-- club-managed one. Tracking it lets the UI warn when that's the case.
alter table account_directory add column if not exists verification_contact text;
