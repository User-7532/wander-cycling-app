-- Thin wrappers around Supabase Vault, callable only by the service role (via
-- the account-secret Edge Function) — never exposed to the client directly.
-- This keeps tier-checking and audit logging in one place (the Edge Function)
-- while still using Vault's encryption at rest for the actual secret value.
create or replace function admin_set_vault_secret(existing_id uuid, secret_value text, secret_name text)
returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare
  new_id uuid;
begin
  if existing_id is null then
    new_id := vault.create_secret(secret_value, secret_name);
    return new_id;
  else
    perform vault.update_secret(existing_id, secret_value);
    return existing_id;
  end if;
end;
$$;

create or replace function admin_reveal_vault_secret(secret_id uuid)
returns text
language plpgsql security definer set search_path = public, vault as $$
declare
  result text;
begin
  select decrypted_secret into result from vault.decrypted_secrets where id = secret_id;
  return result;
end;
$$;

revoke execute on function admin_set_vault_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function admin_reveal_vault_secret(uuid) from public, anon, authenticated;
