-- Migration 004: incidents (Phase 1 Task 2, BRD F4).
--
-- Two tables plus one column on monitors:
--   - incidents: one row per outage on a monitor. Lifecycle is open and
--     resolved only; acknowledgement, assignment, and severity arrive with
--     tickets in a later task.
--   - incident_events: the append only system written timeline (opened,
--     reopened, recovered, resolved). Users never write these; the record
--     of what happened is exactly what the cron path wrote.
--   - monitors.failing_since: the minimal confirmation state. A single
--     failed check never opens an incident; it stamps failing_since and the
--     next sweep rechecks. See src/lib/monitoring/incident-engine.ts for the
--     full state machine.
--
-- Write paths, so the policies below make sense:
--   - Both tables are written ONLY by the cron sweep
--     (/api/cron/check-monitors) on the service role client. User sessions
--     can read their org's rows and nothing else: there are deliberately no
--     insert/update/delete policies for authenticated, and the GRANTs below
--     withhold those verbs too. Human incident actions (notes, manual
--     resolution) are out of scope in this task by ruling.
--
-- GRANTs follow the migration 003 pattern: revoke everything from anon and
-- authenticated first, then grant back exactly the verbs each role needs.

-- ---------------------------------------------------------------------------
-- monitors: confirmation state. NULL means no unconfirmed failure is
-- pending. Set to the checked_at of the first failed check while the
-- monitor waits for its confirming recheck; cleared when the recheck comes
-- back up (a blip) or when the incident opens or reopens.

alter table public.monitors add column failing_since timestamptz;

comment on column public.monitors.failing_since is
  'When the first unconfirmed failed check happened. NULL unless the monitor is awaiting the confirming recheck. Managed only by the cron sweep.';

-- ---------------------------------------------------------------------------
-- incidents. org_id is denormalized from the monitor so RLS never needs a
-- join, matching monitor_checks.

create table public.incidents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  monitor_id        uuid not null references public.monitors (id) on delete cascade,
  status            text not null default 'open' check (status in ('open', 'resolved')),
  -- Backdated to the FIRST failed check of the confirmed failure, not the
  -- confirming recheck, so downtime is counted from when it actually began.
  opened_at         timestamptz not null,
  resolved_at       timestamptz,
  last_reopened_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- The two lifecycle states pin their timestamps: open incidents have no
  -- resolved_at, resolved incidents always have one.
  constraint incidents_status_resolved_at check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

comment on table public.incidents is
  'Outages detected by the cron sweep, one per confirmed failure (with a 30 minute reopen cooldown). Written only by the cron path (service role).';
comment on column public.incidents.opened_at is
  'Start of the outage, backdated to the first failed check of the confirmed failure.';
comment on column public.incidents.last_reopened_at is
  'When the incident last flipped back to open inside the flap cooldown. NULL when it never reopened.';

create index incidents_org_id_idx on public.incidents (org_id);
create index incidents_monitor_id_opened_at_idx
  on public.incidents (monitor_id, opened_at desc);
-- The engine's invariant, enforced where it cannot be raced: a monitor has
-- at most one open incident.
create unique index incidents_one_open_per_monitor
  on public.incidents (monitor_id)
  where status = 'open';

create trigger incidents_set_updated_at
before update on public.incidents
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- incident_events: the timeline. Append only by construction: only the
-- service role can write at all, and it only ever inserts.

create table public.incident_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  incident_id  uuid not null references public.incidents (id) on delete cascade,
  event_type   text not null check (
    event_type in ('opened', 'reopened', 'recovered', 'resolved')
  ),
  occurred_at  timestamptz not null,
  -- The monitor check that triggered the event, where one did. SET NULL, not
  -- CASCADE: raw checks are pruned after 30 days (migration 003) and the
  -- timeline must outlive them.
  check_id     uuid references public.monitor_checks (id) on delete set null,
  detail       text
);

comment on table public.incident_events is
  'Append only system written incident timeline. Written only by the cron path (service role); users can read, never edit or delete.';
comment on column public.incident_events.check_id is
  'The monitor check that triggered this event, if any. Goes NULL when the check row is pruned; the event and its timestamps remain.';

create index incident_events_incident_id_occurred_at_idx
  on public.incident_events (incident_id, occurred_at);
create index incident_events_org_id_idx on public.incident_events (org_id);
-- Deleting a pruned check must find its events without a table scan.
create index incident_events_check_id_idx on public.incident_events (check_id);

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;

-- Members read their org's incidents. No write policies exist for user
-- sessions on purpose; the cron sweep writes through the service role,
-- which bypasses RLS.
create policy "members read their org's incidents"
on public.incidents
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

create policy "members read their org's incident timeline"
on public.incident_events
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
);

-- ---------------------------------------------------------------------------
-- GRANTs. Verb level access control under the RLS row filter, migration 003
-- pattern: authenticated reads only, service_role everything, anon nothing.

revoke all on table public.incidents from anon, authenticated;
grant select on table public.incidents to authenticated;
grant all on table public.incidents to service_role;

revoke all on table public.incident_events from anon, authenticated;
grant select on table public.incident_events to authenticated;
grant all on table public.incident_events to service_role;
