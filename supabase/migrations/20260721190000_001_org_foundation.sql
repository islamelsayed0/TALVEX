-- Migration 001: organizations and org_members, the tenancy spine.
-- docs/PHASE_0_PLAN.md Task 4. RLS is enabled HERE, in the same migration
-- that creates the tables. A migration that adds a tenant table without its
-- RLS is incomplete by project rule (CLAUDE.md security rule 2).
--
-- Writes to both tables arrive through the Clerk webhook using the service
-- role, which bypasses RLS. The policies below therefore only need to grant
-- what signed in members may do directly: read their own org's rows, and for
-- owners and admins, correct membership rows. Nobody deletes through the API.

-- The org claim, exactly as recorded in docs/DECISIONS.md. Clerk emits two
-- claim shapes, legacy org_id and v2 o.id; the coalesce reads both and is not
-- optional. Centralized here the same way the route rule lives in
-- src/lib/auth/routes.ts: one place to be right, every policy calls it.
create or replace function public.clerk_active_org_id()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')
$$;

comment on function public.clerk_active_org_id() is
  'Active Clerk organization id from the session token. Dual claim shape per docs/DECISIONS.md.';

-- Same dual shape for the role claim. Returns true when the active session
-- may administer the active organization.
create or replace function public.clerk_is_org_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt()->>'org_role', auth.jwt()->'o'->>'rol')
         in ('org:admin', 'admin', 'org:owner', 'owner')
$$;

comment on function public.clerk_is_org_admin() is
  'True when the session''s active org role is owner or admin. Dual claim shape per docs/DECISIONS.md.';

-- ---------------------------------------------------------------------------

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  clerk_org_id  text not null unique,
  name          text not null,
  created_at    timestamptz not null default now()
);

comment on table public.organizations is
  'One row per Clerk organization, synced by the Clerk webhook. clerk_org_id matches the token claim.';

create table public.org_members (
  org_id         uuid not null references public.organizations (id) on delete cascade,
  clerk_user_id  text not null,
  role           text not null check (role in ('owner', 'admin', 'technician', 'member')),
  created_at     timestamptz not null default now(),
  primary key (org_id, clerk_user_id)
);

comment on table public.org_members is
  'Membership synced by the Clerk webhook. Primary key doubles as the unique (org_id, clerk_user_id) constraint.';

create index org_members_clerk_user_id_idx on public.org_members (clerk_user_id);

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

-- Members see their active organization's row and nothing else.
create policy "members read their active org"
on public.organizations
for select
to authenticated
using (clerk_org_id = (select public.clerk_active_org_id()));

-- Members see the member list of their active organization.
create policy "members read their org's membership"
on public.org_members
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- Owners and admins may correct membership rows in their active org. The
-- with check on insert stops an admin writing a row into another org.
create policy "org admins insert membership"
on public.org_members
for insert
to authenticated
with check (
  (select public.clerk_is_org_admin())
  and org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

create policy "org admins update membership"
on public.org_members
for update
to authenticated
using (
  (select public.clerk_is_org_admin())
  and org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
)
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- No insert, update, or delete policies on organizations, and no delete
-- policy on org_members: those paths are webhook only (service role).
