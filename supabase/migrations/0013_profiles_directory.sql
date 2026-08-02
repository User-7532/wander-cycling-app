-- Any signed-in member can see a name/role/year roster, but not phone/
-- emergency_contact/student_id (RLS on profiles restricts those to officer+).
-- SECURITY DEFINER lets this bypass row-level restrictions internally while
-- only ever returning the whitelisted columns below.
create or replace function profiles_directory()
returns table (id uuid, full_name text, avatar_url text, year text, club_role_id smallint)
language sql stable security definer set search_path = public as $$
  select id, full_name, avatar_url, year, club_role_id
  from profiles
  where auth.uid() is not null
$$;
