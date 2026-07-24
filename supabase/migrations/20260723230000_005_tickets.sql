-- Migration 005: tickets (Phase 1 Task 3, BRD F5).
--
-- Three tables:
--   - tickets: help requests submitted by org members. Lifecycle is open,
--     in_progress, resolved, closed. Resolved means the team believes it is
--     handled; closed is terminal, set manually by an admin or automatically
--     by the cron sweep 7 days after resolution. No priorities, categories,
--     or assignment in this task; those are future work by ruling.
--   - ticket_comments: user written conversation on a ticket. User content,
--     stored apart from the system trail, rendered interleaved with it.
--   - ticket_events: the append only system written activity trail (created,
--     status_changed, auto_closed). Users never write these; triggers below
--     and the cron path are the only writers.
--
-- Roles, the first role distinction in the product: a regular member sees
-- only tickets they submitted; org admins see every ticket in the org. The
-- authority for "is this user an admin" is org_members.role, the column the
-- Clerk webhook sync maintains, NOT the role claim in the session token.
-- public.is_org_admin() below encodes that; the token only identifies the
-- user (sub claim) and the active org.
--
-- Write paths, so the policies below make sense:
--   - tickets: any member inserts into their own org, as themselves, status
--     open. Only admins update, and the column grant limits even them to the
--     status column; every timestamp is trigger managed.
--   - ticket_comments: members insert on tickets they can see, as
--     themselves, while the ticket is not closed. Comments are immutable:
--     no update or delete for anyone but the service role.
--   - ticket_events: written ONLY by the triggers below (security definer)
--     and the service role. No user verbs beyond select.
--
-- GRANTs follow the migration 003 pattern: revoke everything from anon and
-- authenticated first, then grant back exactly the verbs (and here, columns)
-- each role needs.

-- ---------------------------------------------------------------------------
-- Claim and role helpers.

-- The signed in user, from the Clerk JWT sub claim. Centralized like
-- clerk_active_org_id() (migration 001): one place to be right, every
-- policy calls it. NULL on the service role token, which carries no sub.
create or replace function public.clerk_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt()->>'sub'
$$;

comment on function public.clerk_user_id() is
  'Clerk user id (JWT sub claim) of the session. NULL for the service role and anon.';

-- True when the signed in user's org_members row for the given org carries
-- an admin grade role. This is the role authority for RLS (Task 3 ruling):
-- the database column the webhook sync maintains, not the token claim, so a
-- forged or stale claim changes nothing. Runs with invoker rights on
-- purpose: the org_members select policy already scopes rows to the active
-- org, so asking about any other org returns false.
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.clerk_user_id = public.clerk_user_id()
      and m.role in ('owner', 'admin')
  )
$$;

comment on function public.is_org_admin(uuid) is
  'True when the session user''s org_members.role for this org is owner or admin. The database, not the token claim, is the role authority.';

-- ---------------------------------------------------------------------------
-- tickets

create table public.tickets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  -- Clerk user id of the submitter. The insert policy pins it to the
  -- session's own sub claim, so it cannot be forged.
  submitted_by  text not null,
  title         text not null check (btrim(title) <> '' and char_length(title) <= 200),
  description   text not null check (btrim(description) <> '' and char_length(description) <= 10000),
  status        text not null default 'open' check (
    status in ('open', 'in_progress', 'resolved', 'closed')
  ),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  closed_at     timestamptz,
  -- Each lifecycle state pins its timestamps. Closed keeps resolved_at when
  -- it arrived via resolved (the auto close path) and leaves it NULL when an
  -- admin closed the ticket directly.
  constraint tickets_status_timestamps check (
    (status in ('open', 'in_progress') and resolved_at is null and closed_at is null)
    or (status = 'resolved' and resolved_at is not null and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

comment on table public.tickets is
  'Help requests submitted by org members. Status is the only user writable column after creation, admins only; timestamps and the trail are trigger managed.';
comment on column public.tickets.submitted_by is
  'Clerk user id of the submitter, pinned to the session sub claim by the insert policy.';
comment on column public.tickets.resolved_at is
  'When the ticket last entered resolved. Cleared if an admin reopens it; kept through auto close.';

create index tickets_org_id_idx on public.tickets (org_id);
create index tickets_submitted_by_idx on public.tickets (org_id, submitted_by);
-- The auto close sweep asks one question: resolved longer than 7 days ago.
create index tickets_resolved_at_idx on public.tickets (resolved_at)
  where status = 'resolved';

create trigger tickets_set_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

-- Lifecycle rules, enforced where they cannot be skipped. Closed is terminal
-- for every caller including the service role; the timestamps follow the
-- status so no client ever writes them (the column grant below withholds
-- them anyway).
create or replace function public.tickets_apply_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'closed' then
    raise exception 'closed tickets are final and cannot change status';
  end if;
  if new.status = 'resolved' then
    new.resolved_at := now();
  elsif new.status = 'closed' then
    new.closed_at := now();
  else
    -- Back to open or in_progress: the ticket is no longer considered
    -- handled, so the resolution timestamp goes away with the state.
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger tickets_apply_status_change
before update on public.tickets
for each row execute function public.tickets_apply_status_change();

-- ---------------------------------------------------------------------------
-- ticket_comments: user content. org_id is denormalized from the ticket so
-- RLS never needs a join for the org test, matching every tenant table.

create table public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  ticket_id   uuid not null references public.tickets (id) on delete cascade,
  -- Clerk user id of the author, pinned to the session by the insert policy.
  author      text not null,
  body        text not null check (btrim(body) <> '' and char_length(body) <= 10000),
  created_at  timestamptz not null default now()
);

comment on table public.ticket_comments is
  'User written comments on tickets. Immutable once posted: no update or delete verbs for user sessions.';

create index ticket_comments_ticket_id_created_at_idx
  on public.ticket_comments (ticket_id, created_at);
create index ticket_comments_org_id_idx on public.ticket_comments (org_id);

-- ---------------------------------------------------------------------------
-- ticket_events: the system trail. Append only by construction: the
-- security definer triggers below and the service role are the only
-- writers, and nothing ever updates or deletes.

create table public.ticket_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  event_type   text not null check (
    event_type in ('created', 'status_changed', 'auto_closed')
  ),
  -- Clerk user id of whoever caused the event; NULL for the system (the
  -- auto close sweep runs on the service role token, which has no sub).
  actor        text,
  detail       text,
  occurred_at  timestamptz not null default now()
);

comment on table public.ticket_events is
  'Append only system written ticket trail. Written only by triggers and the cron path; users can read, never write.';
comment on column public.ticket_events.actor is
  'Clerk user id of the person behind the event. NULL means the system did it.';

create index ticket_events_ticket_id_occurred_at_idx
  on public.ticket_events (ticket_id, occurred_at);
create index ticket_events_org_id_idx on public.ticket_events (org_id);

-- The trail writer. SECURITY DEFINER because the users whose actions it
-- records deliberately have no insert verb on ticket_events; the trigger is
-- the one sanctioned path in. Every branch derives its content from the row
-- transition itself, never from client supplied values, so there is nothing
-- a caller can inject.
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
    insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
    values (new.org_id, new.id, 'created', new.submitted_by, 'Ticket submitted.');
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

create trigger tickets_write_event
after insert or update on public.tickets
for each row execute function public.tickets_write_event();

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_events enable row level security;

-- The role rule, encoded at the database (Task 3 ruling): inside the active
-- org, a member reads only tickets they submitted; an admin (per
-- org_members.role) reads them all.
create policy "members read own tickets, org admins read all"
on public.tickets
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and (
    submitted_by = (select public.clerk_user_id())
    or public.is_org_admin(org_id)
  )
);

-- Any member creates tickets, but only inside their active org and only as
-- themselves; the with check pins both. Status is not in the insert column
-- grant, so every ticket is born open by the column default.
create policy "members create tickets in their org as themselves"
on public.tickets
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and submitted_by = (select public.clerk_user_id())
);

-- Only org admins change tickets, and the column grant narrows even them to
-- status alone. A member updating their own ticket matches zero rows here:
-- the role clause reads org_members.role through is_org_admin(), so the
-- database, not the app, is what says no.
create policy "org admins update ticket status"
on public.tickets
for update
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
)
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- Comments ride ticket visibility: the subquery on tickets runs under the
-- caller's own RLS, so "tickets you can see" is literally the select policy
-- above, never a second copy of the rule that could drift.
create policy "members read comments on tickets they can see"
on public.ticket_comments
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and ticket_id in (select id from public.tickets)
);

-- Commenting: as yourself, in your org, on a ticket you can see, while it
-- is not closed. Submitters reach their own tickets, admins reach all, and
-- a member who cannot see a ticket cannot comment on it because the
-- subquery never yields it.
create policy "members comment on visible tickets until closed"
on public.ticket_comments
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and author = (select public.clerk_user_id())
  and ticket_id in (
    select id from public.tickets where status <> 'closed'
  )
);

-- The trail is visible exactly where the ticket is.
create policy "members read the trail on tickets they can see"
on public.ticket_events
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and ticket_id in (select id from public.tickets)
)
;

-- No insert, update, or delete policies on ticket_events for user sessions,
-- and no update or delete on ticket_comments or tickets: the grants below
-- withhold those verbs too, so the absence is enforced twice.

-- ---------------------------------------------------------------------------
-- GRANTs. Verb and column level access control under the RLS row filter,
-- migration 003 pattern: revoke everything, grant back exactly what each
-- role needs. anon gets nothing.

revoke all on table public.tickets from anon, authenticated;
grant select on table public.tickets to authenticated;
-- Insert without status or timestamps: tickets are born open by default and
-- the lifecycle trigger owns every timestamp.
grant insert (org_id, submitted_by, title, description)
  on table public.tickets to authenticated;
-- Update reaches status and nothing else, even for admins.
grant update (status) on table public.tickets to authenticated;
grant all on table public.tickets to service_role;

revoke all on table public.ticket_comments from anon, authenticated;
grant select on table public.ticket_comments to authenticated;
grant insert (org_id, ticket_id, author, body)
  on table public.ticket_comments to authenticated;
grant all on table public.ticket_comments to service_role;

revoke all on table public.ticket_events from anon, authenticated;
grant select on table public.ticket_events to authenticated;
grant all on table public.ticket_events to service_role;

-- Helper functions: callable by the roles whose policies read them. anon
-- never reaches a policy that calls these, and public gets nothing.
revoke execute on function public.clerk_user_id() from public, anon;
grant execute on function public.clerk_user_id() to authenticated, service_role;
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;

-- Trigger functions fire regardless of the caller's execute privilege;
-- nothing calls them directly, so nobody may.
revoke execute on function public.tickets_apply_status_change() from public, anon, authenticated;
revoke execute on function public.tickets_write_event() from public, anon, authenticated;
