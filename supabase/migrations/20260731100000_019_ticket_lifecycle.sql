-- Migration 019: the ticket lifecycle, internal notes, and member list hygiene.
--
-- Three things, and one retirement.
--
-- 1. THE STATUS SET CHANGES. It becomes open, in_progress, resolved,
--    canceled. `closed` is retired and the 7 day auto close sweep that
--    produced it is deleted from the cron route in the same pull request.
--    in_progress stays: it is real admin signal and live tickets use it.
--
--    Why closed had to go rather than sit alongside canceled. Migration 005
--    made closed final ("closed tickets are final and cannot change status")
--    and the sweep closed every resolved ticket after 7 days. This migration
--    gives a member a Reopen button on a resolved ticket. Those two facts are
--    incompatible: the button would work for at most 7 days and then start
--    raising, and the member would be told their own ticket is final by a
--    sweep they never saw. Closed's actual job, getting settled tickets out of
--    the way, is done properly below by hidden_by_requester plus a 7 day
--    window derived from the trail, which hides without freezing.
--
-- 2. MEMBERS GET A WRITE PATH, and it is not an UPDATE. See the long comment
--    above member_set_ticket_status for why this is two SECURITY DEFINER
--    functions rather than a policy, and why members end this migration with
--    exactly the same table verbs they started with, which is none.
--
-- 3. INTERNAL NOTES. ticket_comments gains is_internal. Only admins can write
--    one and only admins can read one, both enforced here, so a member cannot
--    see an internal note on their own ticket by any route including the API.
--
-- Terminal pair: resolved and canceled. Neither is final for an admin, who
-- keeps the unrestricted status control migration 005 gave them.

-- ---------------------------------------------------------------------------
-- Lifecycle trigger first, because the data migration below is an UPDATE and
-- would otherwise be refused by the closed guard it is removing.
--
-- The closed branch and the "closed tickets are final" raise are both gone.
-- Nothing is final now: resolved and canceled are end states, not locked
-- ones, and an admin can move a ticket out of either. resolved_at follows the
-- status as before, and is cleared on the way out of resolved (a reopened or
-- canceled ticket is not a resolved one).

create or replace function public.tickets_apply_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if new.status = 'resolved' then
    new.resolved_at := now();
  else
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The data migration. Any closed ticket becomes resolved and keeps its
-- resolution time: an auto closed ticket already carries resolved_at, and a
-- ticket an admin closed outright carries only closed_at, so that becomes its
-- resolution time. Nothing is deleted and the ticket_events trail is not
-- touched, so the history of every one of these tickets reads exactly as it
-- did, with one honest system row added by the trail trigger recording this
-- transition.
--
-- The timestamps constraint is dropped first because the intermediate row
-- (status resolved, closed_at still set) would violate it.
--
-- The lifecycle trigger is disabled for exactly this statement. Left enabled
-- it would stamp resolved_at := now() on the way into resolved, which is the
-- correct behaviour for a live transition and the wrong one here: these
-- tickets were resolved months ago, not during a migration, and rewriting
-- their resolution time to the moment of deployment would be inventing
-- history rather than preserving it. tickets_write_event stays enabled, so
-- the trail still records the transition, attributed to the system.

alter table public.tickets drop constraint tickets_status_timestamps;

alter table public.tickets disable trigger tickets_apply_status_change;

update public.tickets
set status = 'resolved',
    resolved_at = coalesce(resolved_at, closed_at, now())
where status = 'closed';

alter table public.tickets enable trigger tickets_apply_status_change;

-- ---------------------------------------------------------------------------
-- Constraint swaps, by name, the migration 016 idiom. Existing rows satisfy
-- both sets by the time these run.

alter table public.tickets drop constraint tickets_status_check;
alter table public.tickets add constraint tickets_status_check check (
  status in ('open', 'in_progress', 'resolved', 'canceled')
);

-- Only resolved carries a timestamp now. canceled deliberately gets no
-- canceled_at column: the one thing that needs to know when a ticket settled
-- is the member list's 7 day window, and that reads the trail, which already
-- records every transition with its time. A column would be a second copy of
-- a fact the trail already owns, and it could disagree with it.
alter table public.tickets add constraint tickets_status_timestamps check (
  (status = 'resolved' and resolved_at is not null)
  or (status in ('open', 'in_progress', 'canceled') and resolved_at is null)
);

alter table public.tickets drop column closed_at;

comment on column public.tickets.resolved_at is
  'When the ticket last entered resolved. Cleared on the way out, including into canceled.';

-- ---------------------------------------------------------------------------
-- New columns.

-- Member list hygiene. The member decides this ticket has stopped being
-- interesting; the row does not move and is never deleted. Admin lists ignore
-- this column entirely, so the org's record is unaffected by what one member
-- chose to stop looking at.
alter table public.tickets
  add column hidden_by_requester boolean not null default false;

comment on column public.tickets.hidden_by_requester is
  'The requester removed this ticket from their own list. Set only through member_hide_ticket() and only on a terminal ticket. Hides nothing from admins.';

-- Internal notes. Default false so every existing comment stays exactly what
-- it was: visible to the requester.
alter table public.ticket_comments
  add column is_internal boolean not null default false;

comment on column public.ticket_comments.is_internal is
  'An admin only note. Members never read these, on their own tickets or any other, enforced by the select policy rather than by any screen.';

-- Internal notes are read on the ticket detail alongside ordinary comments;
-- this index keeps that read on the existing (ticket_id, created_at) shape
-- while letting the member path skip internal rows without a heap scan.
create index ticket_comments_ticket_id_visible_idx
  on public.ticket_comments (ticket_id, created_at)
  where is_internal = false;

-- ---------------------------------------------------------------------------
-- The trail writer loses its auto_closed branch, which was reachable only
-- from the sweep this pull request deletes. The event_type constraint KEEPS
-- 'auto_closed' on purpose: rows written by the old sweep are real history
-- and narrowing the constraint would either destroy them or fail on them.
--
-- THE REST OF THIS BODY IS MIGRATION 008'S, UNCHANGED. `create or replace`
-- replaces the whole function, so the insert branches that 006 and 008 added
-- (created_from_incident, created_from_chat) have to be carried forward here
-- or they vanish silently: the ticket keeps being created, the trail just
-- stops saying where it came from, and the reference cards on the detail page
-- lose their explanation. Anything that replaces this function again copies
-- the CURRENT body rather than an older migration's.

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
    if new.conversation_id is not null then
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'created_from_chat', new.submitted_by,
              'Created from chat conversation ' || new.conversation_id || '.');
    elsif new.incident_id is not null then
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'created_from_incident', new.submitted_by,
              'Created from incident ' || new.incident_id || '.');
    else
      insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
      values (new.org_id, new.id, 'created', new.submitted_by, 'Ticket submitted.');
    end if;
  elsif old.status is distinct from new.status then
    insert into public.ticket_events (org_id, ticket_id, event_type, actor, detail)
    values (new.org_id, new.id, 'status_changed', v_actor,
            'Status changed from ' || replace(old.status, '_', ' ')
              || ' to ' || replace(new.status, '_', ' ') || '.');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The member write path.
--
-- WHY THIS IS A FUNCTION AND NOT A POLICY. The requirement is a state
-- machine: open or in_progress to resolved, open or in_progress to canceled,
-- resolved to open, and nothing else. RLS cannot express that. An UPDATE
-- policy evaluates USING against the OLD row and WITH CHECK against the NEW
-- row, and neither one can see the other, so the tightest pair expressible is
-- "old status is one of these" AND "new status is one of those", which is the
-- cross product. That cross product wrongly permits resolved to canceled,
-- which the ruling forbids, and it cannot distinguish a real transition from
-- a no op.
--
-- Reopening settles it beyond argument. The explanation must land as the
-- member's comment IN THE SAME ACTION, and two statements from a client are
-- two statements: a caller could send the status change and never send the
-- comment, and no policy can require the second. One function in one
-- transaction can, and does.
--
-- What this buys. Members are granted NOTHING on public.tickets by this
-- migration: no update verb, no column. The migration 005 admin only update
-- policy is untouched and still refuses them. So "every other column is
-- unreachable through the member path" is not an argument about which
-- predicates are tight enough, it is the absence of a path. These two
-- functions are the entire member write surface and each one writes exactly
-- the columns named in its body.
--
-- Definer safety, the migration 011 and 014 shape: pinned empty search_path,
-- every object schema qualified, execute revoked from public and anon. Both
-- functions re derive the caller and the active org from the token and refuse
-- any ticket not submitted by that caller, so there is no argument a caller
-- can pass that reaches another person's ticket or another organization.

create function public.member_set_ticket_status(
  p_ticket_id uuid,
  p_status text,
  p_explanation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    text := public.clerk_user_id();
  v_org     uuid;
  v_current text;
  v_body    text := btrim(coalesce(p_explanation, ''));
begin
  if v_user is null then
    raise exception 'this action needs a signed in user' using errcode = '42501';
  end if;

  select id into v_org
  from public.organizations
  where clerk_org_id = public.clerk_active_org_id();
  if v_org is null then
    raise exception 'this action needs an active organization' using errcode = '42501';
  end if;

  -- Own ticket, own org, or nothing. The row lock stops two concurrent calls
  -- from both reading 'open' and both writing a transition.
  select status into v_current
  from public.tickets
  where id = p_ticket_id
    and org_id = v_org
    and submitted_by = v_user
  for update;

  if v_current is null then
    raise exception 'ticket not found' using errcode = '42501';
  end if;

  -- The member state machine, in one place. Anything not named here is
  -- refused, including every no op, so a member cannot resolve an already
  -- resolved ticket and mint a second trail entry out of nothing.
  if p_status = 'resolved' and v_current in ('open', 'in_progress') then
    null;
  elsif p_status = 'canceled' and v_current in ('open', 'in_progress') then
    null;
  elsif p_status = 'open' and v_current = 'resolved' then
    if v_body = '' then
      raise exception 'reopening a ticket needs an explanation'
        using errcode = '22023';
    end if;
    if char_length(v_body) > 10000 then
      raise exception 'that explanation is too long' using errcode = '22023';
    end if;
  else
    raise exception 'a requester cannot move a ticket from % to %',
      v_current, p_status using errcode = '42501';
  end if;

  -- Reopening: the explanation is the member's own ordinary comment, never
  -- internal, written before the status change so the trail reads
  -- "reopened, because ..." rather than the other way round.
  if p_status = 'open' then
    insert into public.ticket_comments (org_id, ticket_id, author, body, is_internal)
    values (v_org, p_ticket_id, v_user, v_body, false);
  end if;

  update public.tickets set status = p_status where id = p_ticket_id;
end;
$$;

comment on function public.member_set_ticket_status(uuid, text, text) is
  'The requester''s own lifecycle actions: resolve, cancel, and reopen with a required explanation written in the same transaction. Refuses any other transition and any ticket the caller did not submit. Members hold no update verb on tickets; this is their entire status write path.';

create function public.member_hide_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    text := public.clerk_user_id();
  v_org     uuid;
  v_current text;
begin
  if v_user is null then
    raise exception 'this action needs a signed in user' using errcode = '42501';
  end if;

  select id into v_org
  from public.organizations
  where clerk_org_id = public.clerk_active_org_id();
  if v_org is null then
    raise exception 'this action needs an active organization' using errcode = '42501';
  end if;

  select status into v_current
  from public.tickets
  where id = p_ticket_id
    and org_id = v_org
    and submitted_by = v_user
  for update;

  if v_current is null then
    raise exception 'ticket not found' using errcode = '42501';
  end if;

  -- Terminal only. An open ticket cannot be tidied away: the whole point of
  -- the list is that unfinished things stay on it.
  if v_current not in ('resolved', 'canceled') then
    raise exception 'only a resolved or canceled ticket can be removed from your list'
      using errcode = '42501';
  end if;

  update public.tickets set hidden_by_requester = true where id = p_ticket_id;
end;
$$;

comment on function public.member_hide_ticket(uuid) is
  'The requester removes their own settled ticket from their own list. Terminal states only. Sets one boolean; the row never moves and is never deleted, and admin views are unaffected.';

revoke execute on function public.member_set_ticket_status(uuid, text, text)
  from public, anon;
grant execute on function public.member_set_ticket_status(uuid, text, text)
  to authenticated;
revoke execute on function public.member_hide_ticket(uuid) from public, anon;
grant execute on function public.member_hide_ticket(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Comment policies: internal notes in, the closed gate out.

drop policy "members read comments on tickets they can see" on public.ticket_comments;

-- The one new clause is the last one. A member reading their own ticket gets
-- every ordinary comment and no internal note; an admin gets both. This is
-- the only place that rule exists, so no screen can forget it and no API
-- caller can go around it.
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
  and (is_internal = false or public.is_org_admin(org_id))
);

drop policy "members comment on visible tickets until closed" on public.ticket_comments;

-- Two changes. The "not closed" clause is gone with the state itself, so a
-- comment can be added to a ticket in any state; a resolved or canceled
-- ticket that someone wants to say one more thing about is not a problem
-- worth a refusal. And is_internal true is tied to being an admin, so a
-- member cannot mint an invisible comment even though the column now exists
-- in their insert grant.
-- Name kept under 63 characters so it is stored exactly as written and a
-- later migration can drop it by this name without guessing at a truncation.
create policy "members comment on visible tickets, internal is admin only"
on public.ticket_comments
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and author = (select public.clerk_user_id())
  and ticket_id in (select id from public.tickets)
  and (is_internal = false or public.is_org_admin(org_id))
);

-- The column joins the insert grant; the policy above is what decides who may
-- set it true.
grant insert (org_id, ticket_id, author, body, is_internal)
  on table public.ticket_comments to authenticated;

-- ---------------------------------------------------------------------------
-- Audit vocabulary, extended by constraint swap exactly as 013 planned.
--
-- This is a deliberate narrowing of the 2026-07-29 ruling that ticket
-- activity stays in ticket_events and out of the org wide log. Lifecycle
-- transitions join the log because they are now something a MEMBER can do to
-- a shared record, which is the shape of every other action already in here.
-- Comments, notes, and titles stay out: the log records that a transition
-- happened and who caused it, never what anybody wrote.

alter table public.audit_log drop constraint audit_log_action_allowed;
alter table public.audit_log add constraint audit_log_action_allowed check (
  action in (
    'member_role_changed',
    'api_key_added',
    'api_key_replaced',
    'api_key_deleted',
    'monitor_deleted',
    'status_page_enabled',
    'status_page_disabled',
    'status_page_slug_changed',
    'timezone_changed',
    'notification_settings_changed',
    'article_created',
    'article_published',
    'article_unpublished',
    'article_updated',
    'article_deleted',
    'member_tags_changed',
    'inventory_item_created',
    'inventory_item_updated',
    'inventory_item_deleted',
    'ticket_status_changed',
    'ticket_canceled',
    'ticket_reopened'
  )
);

-- Ticket lifecycle fanout, the 013 definer pattern. Cancel and reopen get
-- their own verbs because they are the two transitions someone will one day
-- ask "who did that" about; every other transition, resolve included, is
-- ticket_status_changed carrying the same from and to.
--
-- Detail is four facts: which ticket, the transition, and what kind of actor
-- caused it. No title, no comment, no note. actor_kind is recorded because
-- the actor id alone does not say whether this was the requester tidying up
-- their own ticket or an admin acting on someone else's, and that is the
-- question a reader of this log will actually have.
create function public.audit_tickets_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  text := public.clerk_user_id();
  v_action text;
  v_kind   text;
begin
  if old.status is not distinct from new.status
     or not exists (select 1 from public.organizations where id = new.org_id) then
    return null;
  end if;

  if new.status = 'canceled' then
    v_action := 'ticket_canceled';
  elsif new.status = 'open' and old.status = 'resolved' then
    v_action := 'ticket_reopened';
  else
    v_action := 'ticket_status_changed';
  end if;

  if v_actor is null then
    v_kind := 'system';
  elsif public.is_org_admin(new.org_id) then
    v_kind := 'admin';
  else
    v_kind := 'member';
  end if;

  insert into public.audit_log (org_id, action, actor, detail)
  values (
    new.org_id,
    v_action,
    v_actor,
    jsonb_build_object(
      'ticket_id', new.id,
      'from', old.status,
      'to', new.status,
      'actor_kind', v_kind
    )
  );
  return null;
end;
$$;

create trigger audit_tickets_status_change
after update on public.tickets
for each row execute function public.audit_tickets_status_change();

revoke execute on function public.audit_tickets_status_change()
  from public, anon, authenticated;

comment on table public.tickets is
  'Help requests submitted by org members. Admins update status through the migration 005 policy; requesters act only through member_set_ticket_status() and member_hide_ticket(), holding no update verb of their own. Timestamps and the trail are trigger managed.';
