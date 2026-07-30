-- Migration 018: the sweep heartbeat.
--
-- Why this table exists at all. The five minute sweep has already stopped
-- silently once in production: the external scheduler auto disabled the job
-- after a 405 while CRON_SECRET had drifted, and monitoring simply stopped
-- with nobody noticing. Every screen kept showing the last values it had, so
-- the dashboard reported health from data that had stopped updating. Nothing
-- in the schema recorded that the sweep ran, so nothing could tell the
-- difference between calm and dead.
--
-- Why not derive it from monitor_checks. The obvious alternative is
-- max(monitor_checks.checked_at). It is wrong three ways: it lags by each
-- monitor's own interval, it cannot tell a dead sweep from an org with no
-- active monitors, and it is empty for a brand new org. The fact worth
-- recording is that the SWEEP RAN, including a sweep where nothing was due,
-- and no tenant table records that.
--
-- Why one row and not one per org. This is platform state. It says the
-- platform's checker is alive; it says nothing about whom it checked. A per
-- org shape would invite exactly the column that breaks the policy below.

create table public.platform_heartbeat (
  -- The primary key is constrained to a single literal, so this is a one row
  -- table at the database rather than by convention. A second row cannot be
  -- inserted even by the service role.
  id              text primary key default 'sweep' check (id = 'sweep'),
  last_run_at     timestamptz,
  last_success_at timestamptz,
  -- Maintained by the trigger below, never by the caller.
  run_count       bigint  not null default 0,
  step_failures   integer not null default 0,
  duration_ms     integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- The row is created here, with null timestamps, so the sweep only ever
-- performs an update and no insert grant is needed by anyone. Null reads
-- honestly as "the sweep has not reported yet"; a freshly migrated deployment
-- that defaulted to now() would look healthy before it had ever run.
insert into public.platform_heartbeat (id) values ('sweep');

-- updated_at and run_count are both maintained here rather than by the caller.
-- run_count especially: incrementing it in the application would mean reading
-- the current value and writing value plus one, which is an extra round trip
-- on every sweep and a lost update if two sweeps ever overlap. In the trigger
-- it is one statement and the database serializes it.
create or replace function public.platform_heartbeat_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.run_count := old.run_count + 1;
  return new;
end;
$$;

revoke execute on function public.platform_heartbeat_touch() from public, anon, authenticated;

create trigger platform_heartbeat_touch
  before update on public.platform_heartbeat
  for each row execute function public.platform_heartbeat_touch();

comment on table public.platform_heartbeat is
  'One row. Records that the cron sweep ran, so a dead scheduler is visible instead of silent. Platform state, not org data: it names no tenant. Written only by the sweep (service role).';
comment on column public.platform_heartbeat.last_run_at is
  'When the sweep last completed, whether or not every step succeeded. This is the freshness clock.';
comment on column public.platform_heartbeat.last_success_at is
  'When the sweep last completed with no failed steps. Lags last_run_at whenever a step is failing.';

-- ---------------------------------------------------------------------------
-- RLS. This is the only table in the schema whose select policy is
-- using (true), and that is a statement about its contents, not a shortcut.
--
-- The table holds no org data by construction: one row, no org_id, no name, no
-- count that belongs to anybody. There is nothing to scope by, so scoping it
-- would be theatre. If a column is ever proposed for this table that says
-- anything about a tenant, this policy becomes wrong and the column belongs in
-- an org scoped table instead. That is the rule this file is here to carry.
--
-- Writes get no policy for any user role, so the row is service role only, the
-- same posture as incidents.last_notified_at and digest_last_sent_on. A
-- writable heartbeat would let a user fake liveness or fake an outage.

alter table public.platform_heartbeat enable row level security;

create policy "every signed in session reads the platform heartbeat"
on public.platform_heartbeat
for select
to authenticated
using (true);

-- anon reads it too, because the public freshness endpoint that the external
-- watcher polls must work without a session. The column grant below, not this
-- policy, is what keeps the operational counts out of that response.
create policy "anon reads the platform heartbeat"
on public.platform_heartbeat
for select
to anon
using (true);

-- ---------------------------------------------------------------------------
-- GRANTs, following the migration 003 idiom: revoke everything, then grant
-- back the exact verbs, with anon narrowed to columns as in migration 011.
--
-- run_count, step_failures, and duration_ms are ungranted to anon on purpose.
-- The public endpoint cannot leak how many sweeps have run or how many steps
-- are failing even if its code asked for them, because the grant refuses
-- before the route is consulted.

revoke all on table public.platform_heartbeat from anon, authenticated;

grant select on table public.platform_heartbeat to authenticated;

grant select (id, last_run_at, last_success_at)
  on table public.platform_heartbeat to anon;

grant all on table public.platform_heartbeat to service_role;
