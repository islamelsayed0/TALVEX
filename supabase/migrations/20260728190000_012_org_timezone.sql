-- Migration 012: the organization timezone (BRD F11, usage metering).
--
-- One column: organizations.timezone, an IANA zone name such as
-- America/New_York. The org has ONE authoritative timezone and every viewer
-- sees the same usage numbers bucketed by it. NULL means not yet set; the
-- first admin to open the usage screen has their browser zone detected and
-- saved through the validated server action, so the org zone becomes the
-- first admin's zone with zero setup. This is the zone billing will use in
-- Phase 2.
--
-- The check constraint is a sanity gate on shape only (Area/Location
-- segments, or the literal UTC). The authoritative validation runs server
-- side on every save, against the zones the runtime actually supports
-- (src/lib/db/usage.ts).
--
-- Write path note: the F9 status page migration introduces the first narrow
-- admin update policy on organizations, and the F11 ruling was to ride it and
-- only extend the column grant. That migration has not merged yet, so this one
-- carries its own policy of the exact same shape under its own name; the two
-- are permissive policies with identical predicates and coexist cleanly in
-- either merge order. Column reach stays grant controlled either way: this
-- migration grants update on timezone alone, so an admin still cannot rename
-- the org or touch clerk_org_id.

alter table public.organizations
  add column timezone text;

alter table public.organizations
  add constraint organizations_timezone_format check (
    timezone is null
    or timezone = 'UTC'
    or (
      timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$'
      and char_length(timezone) <= 64
    )
  );

comment on column public.organizations.timezone is
  'The org''s one authoritative IANA timezone for usage month bucketing (and Phase 2 billing). NULL until the first admin visit to the usage screen stores the detected browser zone. Validated server side against the runtime''s supported zones on every save.';

-- ---------------------------------------------------------------------------
-- Admin write path. Gated on the DB authoritative admin check (is_org_admin
-- reads org_members.role, not the token claim), the same shape as the F9
-- status page policy. The Clerk webhook (service role) remains the only
-- writer of every other organizations column.

create policy "admins update their org timezone"
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

grant update (timezone) on table public.organizations to authenticated;
