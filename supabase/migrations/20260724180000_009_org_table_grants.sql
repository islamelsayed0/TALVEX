-- Migration 009: explicit GRANTs for the migration 001 and 002 objects.
--
-- The backfill the 2026-07-23 GRANTs decision (docs/DECISIONS.md) said was
-- owed. Migrations 003 onward state their grants; `organizations`,
-- `org_members`, and the two claim helpers predate that rule and were still
-- reachable only because both the local stack (config.toml
-- auto_expose_new_tables) and the remote project auto grant API roles full
-- access to new public tables. That behavior is deprecated upstream with a
-- removal date of 2026-10-30, after which these two tables would silently
-- stop being reachable. This migration is what lets the flag go, and it is
-- removed from supabase/config.toml in the same change.
--
-- What auto exposure had actually granted, verified on the remote project
-- before this migration was written: ALL privileges to anon AND authenticated
-- on both tables. Only RLS stood between `anon` and a write, because neither
-- table has a single policy naming anon. This migration removes that standing
-- privilege rather than leaving it propped up by the row filter alone.
--
-- No schema, no policy, and no row changes here. Privileges only.

-- ---------------------------------------------------------------------------
-- organizations
--
-- Migration 001 gave this table exactly one policy: members read their active
-- org. There is deliberately no insert, update, or delete policy, because the
-- Clerk webhook owns every write through the service role. The grants say the
-- same thing at the verb layer, so the absence is enforced twice.

revoke all on table public.organizations from anon, authenticated;
grant select on table public.organizations to authenticated;
grant all on table public.organizations to service_role;

-- ---------------------------------------------------------------------------
-- org_members
--
-- Migration 001 intended three things for signed in sessions: members read
-- their org's membership, and owners and admins may correct membership rows
-- (insert and update). The grants below preserve exactly that intent, no
-- wider. Deletes stay webhook only, matching the absent delete policy.

revoke all on table public.org_members from anon, authenticated;
grant select on table public.org_members to authenticated;

-- Insert reaches the three columns a membership row is made of. created_at is
-- default managed and never supplied by a caller.
grant insert (org_id, clerk_user_id, role)
  on table public.org_members to authenticated;

-- Update reaches `role` and nothing else. org_id and clerk_user_id are the
-- primary key, the row's identity: correcting someone's role is an update,
-- moving a membership to another org or another person is not a correction,
-- it is forgery. The column grant makes that distinction the database's,
-- not the application's.
grant update (role) on table public.org_members to authenticated;

grant all on table public.org_members to service_role;

-- ---------------------------------------------------------------------------
-- The claim helpers from migrations 001 and 002.
--
-- Migration 005 set this pattern for its own helpers: callable by the roles
-- whose policies read them, and nobody else. These two are read by policies
-- on every tenant table in the schema, all of which are `to authenticated`,
-- so authenticated is the only session role that ever needs them. anon never
-- reaches a policy that calls either, and PUBLIC (which is what a function
-- gets by default, meaning every role present and future) gets nothing.

revoke execute on function public.clerk_active_org_id() from public, anon;
grant execute on function public.clerk_active_org_id() to authenticated, service_role;

revoke execute on function public.clerk_is_org_admin() from public, anon;
grant execute on function public.clerk_is_org_admin() to authenticated, service_role;
