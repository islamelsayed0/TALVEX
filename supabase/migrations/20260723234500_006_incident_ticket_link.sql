-- Migration 006: the incident to ticket bridge (Phase 1 Task 4, BRD F8).
--
-- A single ALTER on tickets plus the RLS and trail changes that link entails.
-- Deliberately small: no new tables, no auto creation, no status coupling.
-- Tickets are still born only by a member submitting the Get help form; this
-- migration only lets that form remember which incident it came from.
--
--   - tickets.incident_id: nullable FK to the incident a ticket was created
--     from. NULL for every ordinary ticket. One incident may spawn many
--     tickets over its life; a ticket references at most one incident. ON
--     DELETE SET NULL, not CASCADE: an incident going away must never take a
--     ticket (and its comments and trail) with it. The link is metadata; the
--     ticket is the record of work.
--
--   - The insert with check gains one clause: a ticket may carry an
--     incident_id only when that incident belongs to the SAME organization,
--     expressed as "an incident this session can see". Incidents are visible
--     org wide (migration 004), so "visible to you" is exactly "in your org"
--     here, and the ticket's own org_id is already pinned to the active org
--     by the existing clause. Org B therefore cannot mint a ticket pointing
--     at org A's incident: A's incident is not in B's visible set, so the
--     check fails. This mirrors the comment policy's "on a ticket you can
--     see" pattern, so there is one idea, not two copies of it.
--
--   - RLS decision on WHO may link (Task 4 ruling): ANY member may, not just
--     admins. The Create ticket button is admin only in the UI because
--     ticket workflow is an admin concern, but the database treats the link
--     as harmless same org metadata. A member already sees every incident in
--     their org, so linking a ticket to one they can see reveals nothing and
--     grants nothing; gating it at the row layer would entangle role logic
--     into the deliberately role agnostic "any member creates tickets" path
--     for no security gain. The boundary that matters, cross org linkage, is
--     the one enforced here and tested in tests/isolation/. See
--     docs/DECISIONS.md for the full rationale.
--
--   - ticket_events gains a created_from_incident type, written by the same
--     trigger that writes created. A ticket born with an incident_id records
--     that origin in its trail, carrying the incident id in the detail. The
--     incident timeline is untouched: incidents record uptime truth, tickets
--     record workflow, and only the ticket side learns about the link.

-- ---------------------------------------------------------------------------
-- The column.

alter table public.tickets
  add column incident_id uuid references public.incidents (id) on delete set null;

comment on column public.tickets.incident_id is
  'The incident this ticket was created from, or NULL. Set only at creation, pinned by the insert policy to an incident in the same org. ON DELETE SET NULL so a removed incident never deletes a ticket.';

-- One incident, many tickets: the lookup is "tickets for this incident", so
-- the index is on incident_id. Partial, because the column is NULL for the
-- overwhelming majority of tickets and only linked rows are ever queried by it.
create index tickets_incident_id_idx on public.tickets (incident_id)
  where incident_id is not null;

-- ---------------------------------------------------------------------------
-- Grants. incident_id joins the insert column grant so a member may set it at
-- creation. It is deliberately NOT in the update grant (which stays status
-- only): the link is fixed at birth and never rewritten, matching the ruling
-- that a ticket references at most one incident.

grant insert (org_id, submitted_by, title, description, incident_id)
  on table public.tickets to authenticated;

-- ---------------------------------------------------------------------------
-- The insert with check gains the same org linkage clause. ALTER, not drop
-- and recreate, so the select and update policies and every other clause stay
-- exactly as migration 005 wrote them; only the with check expression grows.

alter policy "members create tickets in their org as themselves"
on public.tickets
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and submitted_by = (select public.clerk_user_id())
  and (
    incident_id is null
    -- Under the caller's own RLS this subquery is exactly the incidents this
    -- session may see, which for org wide incident visibility is exactly the
    -- incidents in the active org. Another org's incident id is never in it.
    or incident_id in (select id from public.incidents)
  )
);

-- ---------------------------------------------------------------------------
-- The trail learns one new event type. Drop and re add the check constraint
-- (Postgres has no ALTER ... on a check); the auto generated name from
-- migration 005 is <table>_<column>_check.

alter table public.ticket_events
  drop constraint ticket_events_event_type_check,
  add constraint ticket_events_event_type_check check (
    event_type in ('created', 'status_changed', 'auto_closed', 'created_from_incident')
  );

-- The trail writer, extended by one branch on INSERT. Everything else is
-- byte for byte migration 005: the status_changed and auto_closed paths are
-- unchanged. A ticket born with an incident_id records created_from_incident
-- and puts the incident id in the detail; an ordinary ticket still records
-- created. SECURITY DEFINER for the same reason as before: submitters have no
-- insert verb on ticket_events, and this trigger is the one sanctioned way in.
create or replace function public.tickets_write_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := public.clerk_user_id();
begin
  if tg_op = 'INSERT' then
    if new.incident_id is not null then
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'created_from_incident', new.submitted_by,
              'Created from incident ' || new.incident_id || '.');
    else
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'created', new.submitted_by, 'Ticket submitted.');
    end if;
  elsif old.status is distinct from new.status then
    if v_actor is null and new.status = 'closed' then
      -- No sub claim means the service role, and the only service role
      -- status write is the 7 day sweep: the system note the ruling asks for.
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'auto_closed', null,
              'Closed automatically 7 days after it was resolved.');
    else
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'status_changed', v_actor,
              'Status changed from ' || replace(old.status, '_', ' ')
                || ' to ' || replace(new.status, '_', ' ') || '.');
    end if;
  end if;
  return null;
end;
$$;

-- The trigger binding from migration 005 still points at this function; a
-- CREATE OR REPLACE keeps it. The revoke below is reasserted for the same
-- reason as before: nothing calls this directly, so nobody may.
revoke execute on function public.tickets_write_event() from public, anon, authenticated;
