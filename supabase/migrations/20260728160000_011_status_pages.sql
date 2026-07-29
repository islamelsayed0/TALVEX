-- Migration 011: public status page (BRD F9).
--
-- The first anonymous (unauthenticated) read surface in Talvex. An org admin
-- opts in with a slug; /status/<slug> then shows that org's monitor status, 90
-- day uptime, and recent incidents to anyone, no login. The database is the
-- boundary: anon reads exactly the narrow columns below, only for orgs that
-- opted in, and holds no write verb. A disabled org is invisible to anon even
-- if application code has a bug.
--
-- This reverses, narrowly and on purpose, the "anon gets nothing" rule that has
-- held since migration 009. anon is granted column scoped SELECT on four tables,
-- gated by RLS on organizations.status_page_enabled. The url column on monitors
-- and clerk_org_id on organizations are excluded at the column grant, so a
-- policy mistake still cannot leak them, and incident_events (detail text) is
-- never granted to anon at all.
--
-- Config lives on organizations, not a side table: anon must read
-- organizations.name for the page regardless, so the org is the anon entry point
-- either way, and two org level columns keep the anon surface to a single table
-- with one policy rather than a whole new anon granted table.

-- ---------------------------------------------------------------------------
-- Config columns on organizations.

alter table public.organizations
  add column status_page_enabled boolean not null default false,
  add column status_page_slug text unique;

-- Slug rules: lowercase letters and digits in segments joined by single
-- hyphens, no leading or trailing hyphen, 3 to 63 characters. Slugs are route
-- paths, exempt from the prose hyphen rule.
alter table public.organizations
  add constraint organizations_status_page_slug_format check (
    status_page_slug is null
    or (
      status_page_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and char_length(status_page_slug) between 3 and 63
    )
  );

-- A page cannot be enabled without a slug to serve it at.
alter table public.organizations
  add constraint organizations_status_page_requires_slug check (
    not status_page_enabled or status_page_slug is not null
  );

comment on column public.organizations.status_page_enabled is
  'When true, /status/<slug> is public for this org. Gates every anon read policy in migration 011. Default false: nothing is public until an admin opts in.';
comment on column public.organizations.status_page_slug is
  'The public status page path segment. Globally unique, required when enabled.';

-- ---------------------------------------------------------------------------
-- Admin write path. organizations has had no update policy at all (the Clerk
-- webhook and service_role own the row), but enabling a status page is an admin
-- action from Settings. This adds one narrow update policy, gated on the DB
-- authoritative admin check (is_org_admin reads org_members.role, not the token
-- claim), and a column scoped update grant covering ONLY the two status page
-- columns, so an admin still cannot rename the org or touch clerk_org_id.

create policy "admins update their org status page"
on public.organizations
for update
to authenticated
using (
  clerk_org_id = (select public.clerk_active_org_id())
  and public.is_org_admin(id)
)
with check (
  clerk_org_id = (select public.clerk_active_org_id())
  and public.is_org_admin(id)
);

grant update (status_page_enabled, status_page_slug)
  on table public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- The gate. anon cannot evaluate clerk_active_org_id() (no org claim, execute
-- revoked), so every anon policy tests the opt in flag on the owning org
-- through this helper. It is SECURITY DEFINER so the policies can test
-- status_page_enabled WITHOUT anon ever holding a privilege on that column: the
-- flag gates access but is never itself exposed, keeping the anon column grants
-- below to exactly the visible surface. It returns only a boolean about whether
-- an already public page is public, so it leaks nothing. Pinned search_path,
-- execute granted to anon alone.

create function public.status_page_is_public(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations
    where id = p_org_id and status_page_enabled
  );
$$;

revoke execute on function public.status_page_is_public(uuid)
  from public, authenticated;
grant execute on function public.status_page_is_public(uuid) to anon;

comment on function public.status_page_is_public(uuid) is
  'True when the org has opted its status page public. The single gate for every anon read policy in migration 011. SECURITY DEFINER so the flag can be tested without granting anon any read on organizations.status_page_enabled.';

-- ---------------------------------------------------------------------------
-- anon read policies. Each gates on the flag via the helper above. RLS is
-- permissive: these to-anon policies sit alongside the existing
-- to-authenticated ones and only affect anon.

create policy "anon read enabled status page orgs"
on public.organizations
for select
to anon
using (public.status_page_is_public(id));

create policy "anon read monitors of enabled status pages"
on public.monitors
for select
to anon
using (public.status_page_is_public(org_id));

create policy "anon read rollups of enabled status pages"
on public.monitor_daily_rollups
for select
to anon
using (public.status_page_is_public(org_id));

create policy "anon read incidents of enabled status pages"
on public.incidents
for select
to anon
using (public.status_page_is_public(org_id));

-- ---------------------------------------------------------------------------
-- Column scoped SELECT grants to anon. This is the leak proof boundary: even if
-- a policy above were wrong, anon holds SELECT on ONLY these columns. url,
-- clerk_org_id, intervals, response times, and all other config stay ungranted,
-- and no insert, update, or delete verb is granted, so anon is read only by
-- grant, not merely by policy. anon was fully revoked in migration 009; these
-- narrow re-grants are the first anon privileges in the schema. Every table
-- keeps its existing revoke, service_role, and authenticated grants untouched.

grant select (id, name, status_page_slug)
  on table public.organizations to anon;

grant select (id, org_id, name, last_status)
  on table public.monitors to anon;

grant select (monitor_id, org_id, day, uptime_percent, check_count)
  on table public.monitor_daily_rollups to anon;

grant select (id, org_id, monitor_id, status, opened_at, resolved_at)
  on table public.incidents to anon;
