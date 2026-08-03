-- Safeguard against the club ever ending up with zero アプリ管理者
-- (executive-tier) profiles. "Executive" is determined by
-- profiles.club_role_id -> club_roles.tier = 'executive' (see
-- 0001_club_roles.sql / 0009_rls_functions.sql's is_executive()).
--
-- Without this, demoting the sole remaining executive (changing
-- club_role_id to a non-executive role) or deleting their profile would
-- silently leave nobody with admin access -- no one could create
-- announcements, manage the directory, approve reimbursements, etc.
--
-- Implemented as a BEFORE UPDATE OF club_role_id OR DELETE trigger on
-- profiles rather than an application/UI-level check, so it can't be
-- bypassed by any normal application code path (including service-role
-- writes, which skip RLS but not triggers). It only blocks the specific
-- case of "this row's operation would drop the executive count to zero" --
-- promoting someone new, or demoting/deleting one executive while another
-- still exists, both remain unaffected.

create or replace function prevent_zero_executive_lockout() returns trigger
language plpgsql as $$
declare
  old_tier text;
  new_tier text;
  remaining_executives int;
begin
  select cr.tier into old_tier from club_roles cr where cr.id = OLD.club_role_id;

  -- This profile wasn't executive before the operation, so this operation
  -- can't be the one that empties the executive tier.
  if old_tier is distinct from 'executive' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'UPDATE' then
    select cr.tier into new_tier from club_roles cr where cr.id = NEW.club_role_id;
    -- Still executive after the update (role changed between executive
    -- codes, e.g. 幹事長 -> 特別会計, or club_role_id wasn't actually
    -- changed in value) -- no risk of losing the last executive.
    if new_tier = 'executive' then
      return NEW;
    end if;
  end if;

  -- OLD was executive and this profile is either being deleted or moved
  -- off executive tier. Block only if no other executive-tier profile
  -- would remain.
  select count(*) into remaining_executives
  from profiles p
  join club_roles cr on cr.id = p.club_role_id
  where cr.tier = 'executive' and p.id <> OLD.id;

  if remaining_executives = 0 then
    raise exception 'この操作はできません: アプリ管理者(executive)が0人になってしまいます。先に別のメンバーをアプリ管理者に昇格させてから、この変更を行ってください。'
      using errcode = 'P0001';
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_prevent_zero_executive_lockout on profiles;
create trigger trg_prevent_zero_executive_lockout
  before update of club_role_id or delete on profiles
  for each row execute function prevent_zero_executive_lockout();
