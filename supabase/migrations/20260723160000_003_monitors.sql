-- Migration 003: uptime monitors (Phase 1 Task 1, BRD F3).
--
-- Three tables: monitors (user managed), monitor_checks (raw results, kept
-- 30 days), monitor_daily_rollups (per monitor per day aggregates that keep
-- history after raw rows are pruned). RLS is enabled here, in the same
-- migration that creates the tables (CLAUDE.md security rule 2).
--
-- Write paths, so the policies below make sense:
--   - monitors: created, edited, and deleted by signed in org members through
--     the app's org scoped client, under RLS.
--   - monitor_checks and monitor_daily_rollups: written ONLY by the cron
--     sweep (/api/cron/check-monitors) on the service role client, which
--     bypasses RLS. User sessions can read their org's rows and nothing else;
--     there are deliberately no insert/update/delete policies for them, and
--     the GRANTs below withhold those verbs too.
--
-- GRANTs: this is the first migration to carry explicit GRANTs. The local
-- stack currently leans on config.toml's auto_expose_new_tables, which is
-- deprecated upstream (removal 2026-10-30, tracked in config.toml). From this
-- migration on, every new table states its grants explicitly so nothing
-- breaks when that flag goes.

-- ---------------------------------------------------------------------------
-- monitors

create table public.monitors (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (btrim(name) <> '' and char_length(name) <= 120),
  -- Syntactic guard only: http(s) or nothing. The authoritative validation
  -- lives in src/lib/db/monitor-url.ts, and the SSRF guard (rejecting hosts
  -- that resolve to private or internal address space) runs at check time in
  -- the cron path, where the DNS answer is actually used.
  url               text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  interval_seconds  integer not null default 300 check (interval_seconds >= 300),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_checked_at   timestamptz,
  last_status       text check (last_status in ('up', 'down'))
);

comment on table public.monitors is
  'HTTP uptime monitors, one row per monitored URL, owned by an organization.';
comment on column public.monitors.last_status is
  'Result of the most recent check. NULL means never checked (shown as pending).';

create index monitors_org_id_idx on public.monitors (org_id);

-- Keep updated_at honest on every update, regardless of caller.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger monitors_set_updated_at
before update on public.monitors
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- monitor_checks: raw results, pruned after 30 days by the cron sweep.
-- org_id is denormalized from the monitor so RLS never needs a join and
-- rows keep their tenant even if read in isolation.

create table public.monitor_checks (
  id                uuid primary key default gen_random_uuid(),
  monitor_id        uuid not null references public.monitors (id) on delete cascade,
  org_id            uuid not null references public.organizations (id) on delete cascade,
  checked_at        timestamptz not null default now(),
  status            text not null check (status in ('up', 'down')),
  response_time_ms  integer check (response_time_ms >= 0),
  error_message     text
);

comment on table public.monitor_checks is
  'Raw check results. Written only by the cron sweep (service role). Kept 30 days, then pruned; monitor_daily_rollups carries older history.';

create index monitor_checks_monitor_id_checked_at_idx
  on public.monitor_checks (monitor_id, checked_at desc);
create index monitor_checks_org_id_idx on public.monitor_checks (org_id);
-- The prune query deletes by age alone.
create index monitor_checks_checked_at_idx on public.monitor_checks (checked_at);

-- ---------------------------------------------------------------------------
-- monitor_daily_rollups: per monitor per day aggregates, UTC days. These
-- outlive the raw rows and are what uptime history beyond 30 days reads.

create table public.monitor_daily_rollups (
  monitor_id       uuid not null references public.monitors (id) on delete cascade,
  org_id           uuid not null references public.organizations (id) on delete cascade,
  day              date not null,
  uptime_percent   numeric(5, 2) not null check (uptime_percent between 0 and 100),
  avg_response_ms  integer,
  min_response_ms  integer,
  max_response_ms  integer,
  check_count      integer not null check (check_count > 0),
  primary key (monitor_id, day)
);

comment on table public.monitor_daily_rollups is
  'Daily aggregates per monitor (UTC days). Maintained only by the cron sweep (service role). Response columns are NULL on days where every check timed out.';

create index monitor_daily_rollups_org_id_day_idx
  on public.monitor_daily_rollups (org_id, day);

-- Recomputes one UTC day of rollups from the raw rows. Called by the cron
-- sweep after it writes checks (for today, and for yesterday right after a
-- day boundary). Idempotent: recomputing a day it already wrote is a no op.
create or replace function public.upsert_monitor_daily_rollups(p_day date)
returns void
language sql
set search_path = ''
as $$
  insert into public.monitor_daily_rollups
    (monitor_id, org_id, day, uptime_percent, avg_response_ms,
     min_response_ms, max_response_ms, check_count)
  select
    c.monitor_id,
    c.org_id,
    p_day,
    round(100.0 * count(*) filter (where c.status = 'up') / count(*), 2),
    round(avg(c.response_time_ms))::integer,
    min(c.response_time_ms),
    max(c.response_time_ms),
    count(*)::integer
  from public.monitor_checks c
  where (c.checked_at at time zone 'UTC')::date = p_day
  group by c.monitor_id, c.org_id
  on conflict (monitor_id, day) do update set
    uptime_percent  = excluded.uptime_percent,
    avg_response_ms = excluded.avg_response_ms,
    min_response_ms = excluded.min_response_ms,
    max_response_ms = excluded.max_response_ms,
    check_count     = excluded.check_count;
$$;

comment on function public.upsert_monitor_daily_rollups(date) is
  'Recomputes monitor_daily_rollups for one UTC day from monitor_checks. Cron path only.';

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.monitors enable row level security;
alter table public.monitor_checks enable row level security;
alter table public.monitor_daily_rollups enable row level security;

-- Members read their active org's monitors.
create policy "members read their org's monitors"
on public.monitors
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- Members create monitors, but only inside their active org: the with check
-- stops a session writing a row that carries another org's org_id. Role
-- distinctions (owner/admin/technician/member) come later per the BRD.
create policy "members create monitors in their org"
on public.monitors
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- Members update their org's monitors. The with check stops an update from
-- moving a monitor into another org.
create policy "members update their org's monitors"
on public.monitors
for update
to authenticated
using (
  org_id in (
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

create policy "members delete their org's monitors"
on public.monitors
for delete
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- Check history and rollups: members read their org's rows. No write
-- policies exist for user sessions on purpose; the cron sweep writes these
-- through the service role, which bypasses RLS.
create policy "members read their org's check history"
on public.monitor_checks
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

create policy "members read their org's daily rollups"
on public.monitor_daily_rollups
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- ---------------------------------------------------------------------------
-- GRANTs. Verb level access control under the RLS row filter. The revokes
-- run first because the remote project auto grants API roles full access to
-- new public tables; the grants then state exactly what each role gets.
-- anon gets nothing: no Talvex surface reads tenant data without a session.

revoke all on table public.monitors from anon, authenticated;
grant select, insert, update, delete on table public.monitors to authenticated;
grant all on table public.monitors to service_role;

revoke all on table public.monitor_checks from anon, authenticated;
grant select on table public.monitor_checks to authenticated;
grant all on table public.monitor_checks to service_role;

revoke all on table public.monitor_daily_rollups from anon, authenticated;
grant select on table public.monitor_daily_rollups to authenticated;
grant all on table public.monitor_daily_rollups to service_role;

-- The rollup function is cron path only.
revoke execute on function public.upsert_monitor_daily_rollups(date) from public, anon, authenticated;
grant execute on function public.upsert_monitor_daily_rollups(date) to service_role;

-- set_updated_at is a trigger function; nothing calls it directly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
