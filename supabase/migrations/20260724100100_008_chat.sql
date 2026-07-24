-- Migration 008: AI support chat, and the chat to ticket bridge (Phase 1
-- Task 5, BRD F6). Two tables plus one ALTER on tickets that mirrors the
-- incident_id bridge from migration 006.
--
-- Transcript visibility, the Task 5 addendum's revised ruling (superseding the
-- personal privacy default considered during design, logged in
-- docs/DECISIONS.md): support chat is a workplace record. Org admins read
-- every conversation in their org; a member reads only their own. This is the
-- same "creator or admin" shape the ticket select policy uses, encoded once
-- here, and disclosed in the UI ("Conversations are visible to your IT team").
--
-- Write model, and why messages are NOT user insertable:
--   - chat_conversations: a member creates their OWN conversation through RLS,
--     and may update its status (open -> resolved when the assistant confirms
--     the issue is solved; open -> escalated when a ticket is created from it).
--     Title is set once at creation from the first message and never rewritten.
--   - chat_messages: written ONLY by the server (the chat route, on the service
--     role) and never by a user session, exactly as monitor_checks are written
--     only by the cron path (docs/DECISIONS.md, "cron written tables"). Two
--     reasons: assistant messages carry provider, model, and token counts that
--     a member must not be able to forge, and the route already holds the
--     service role to read the org key. So authenticated gets SELECT only on
--     chat_messages; the route enforces that the caller owns the conversation
--     before writing to it. Nobody edits or deletes a message in v1.
--
-- The chat to ticket bridge is byte for byte the migration 006 idea applied to
-- a new column: tickets.conversation_id, nullable, ON DELETE SET NULL, cross
-- org linkage refused by the insert with check under the caller's own RLS,
-- immutable after insert (not in the update grant), and a created_from_chat
-- trail event written by the same trigger.

-- ---------------------------------------------------------------------------
-- chat_conversations

create table public.chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  -- Clerk user id of whoever started the conversation, pinned by the insert
  -- policy to the session's own sub claim.
  created_by  text not null,
  -- The first user message, truncated, set once at creation. A label, not
  -- content; the messages are the content.
  title       text not null check (btrim(title) <> '' and char_length(title) <= 200),
  -- open while in progress; resolved when the user confirms the issue is
  -- solved; escalated when a ticket is created from it. The column exists so
  -- resolution rate can be counted later; there is no analytics UI this task.
  status      text not null default 'open' check (status in ('open', 'resolved', 'escalated')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.chat_conversations is
  'AI support chat conversations. Workplace records: creator or org admin can read (addendum ruling). Members create and update only their own; title is fixed at creation.';
comment on column public.chat_conversations.status is
  'open, resolved (user confirmed solved), or escalated (a ticket was created from it). For future resolution rate reporting.';

create index chat_conversations_org_created_by_idx
  on public.chat_conversations (org_id, created_by);
-- The conversation list orders by recent activity; the message insert trigger
-- below keeps updated_at current so this index serves that ordering.
create index chat_conversations_org_updated_at_idx
  on public.chat_conversations (org_id, updated_at);

create trigger chat_conversations_set_updated_at
before update on public.chat_conversations
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat_messages. org_id is denormalized from the conversation so RLS never
-- needs a join for the org test, matching every tenant table.

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.chat_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null check (btrim(content) <> '' and char_length(content) <= 100000),
  -- Provider, model, and token counts are recorded on assistant messages for
  -- future usage metering (BRD F11). User messages never carry them.
  provider         text check (provider in ('anthropic', 'openai', 'google')),
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz not null default now(),
  -- A user message is plain content; the provider/model/token fields belong to
  -- assistant messages only. This keeps a user turn from ever carrying forged
  -- metering metadata even if the write path had a bug.
  constraint chat_messages_role_fields check (
    (role = 'user'
      and provider is null and model is null
      and input_tokens is null and output_tokens is null)
    or role = 'assistant'
  )
);

comment on table public.chat_messages is
  'Chat messages. Written only by the server (service role) like monitor_checks; authenticated has SELECT only. Visibility rides the conversation. Immutable in v1.';

create index chat_messages_conversation_id_created_at_idx
  on public.chat_messages (conversation_id, created_at);
create index chat_messages_org_id_idx on public.chat_messages (org_id);

-- Keep the parent conversation's updated_at current on every new message, so
-- the conversation list can order by real activity. SECURITY DEFINER for the
-- same reason as the ticket trail writer: nothing user facing writes here, and
-- the touch must happen whoever inserted the message.
create or replace function public.chat_messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_conversations
    set updated_at = now()
    where id = new.conversation_id;
  return new;
end;
$$;

create trigger chat_messages_touch_conversation
after insert on public.chat_messages
for each row execute function public.chat_messages_touch_conversation();

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

-- The addendum's ruling, encoded at the database: inside the active org, a
-- member reads only conversations they created; an admin (per org_members.role)
-- reads them all. Identical shape to the ticket select policy.
create policy "read own conversations, org admins read all"
on public.chat_conversations
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and (
    created_by = (select public.clerk_user_id())
    or public.is_org_admin(org_id)
  )
);

-- A member creates their own conversation, in their active org, as themselves.
create policy "members create their own conversations"
on public.chat_conversations
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and created_by = (select public.clerk_user_id())
);

-- Only the creator changes their conversation, and the column grant narrows
-- that to status alone (resolve, or escalate on ticket creation). An admin can
-- read every conversation but does not drive another member's resolution.
create policy "members update their own conversations"
on public.chat_conversations
for update
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and created_by = (select public.clerk_user_id())
)
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and created_by = (select public.clerk_user_id())
);

-- Messages ride conversation visibility: the subquery on chat_conversations
-- runs under the caller's own RLS, so "conversations you can see" is literally
-- the select policy above (own, or all for an admin), never a second copy of
-- the rule. No insert/update/delete policy exists: message writes go through
-- the service role in the chat route, and the grants below withhold those
-- verbs from authenticated regardless.
create policy "read messages on visible conversations"
on public.chat_messages
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and conversation_id in (select id from public.chat_conversations)
);

-- ---------------------------------------------------------------------------
-- GRANTs. Migration 003 pattern.

revoke all on table public.chat_conversations from anon, authenticated;
grant select on table public.chat_conversations to authenticated;
grant insert (org_id, created_by, title) on table public.chat_conversations to authenticated;
grant update (status) on table public.chat_conversations to authenticated;
grant all on table public.chat_conversations to service_role;

revoke all on table public.chat_messages from anon, authenticated;
-- SELECT only: every message write is a server action on the service role.
grant select on table public.chat_messages to authenticated;
grant all on table public.chat_messages to service_role;

-- Trigger functions fire regardless of caller privilege; nothing calls them
-- directly, so nobody may.
revoke execute on function public.chat_messages_touch_conversation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The chat to ticket bridge. tickets.conversation_id, mirroring migration
-- 006's incident_id in every respect.

alter table public.tickets
  add column conversation_id uuid references public.chat_conversations (id) on delete set null;

comment on column public.tickets.conversation_id is
  'The chat conversation this ticket was escalated from, or NULL. Set only at creation, pinned by the insert policy to a conversation the caller can see in the same org. ON DELETE SET NULL so a removed conversation never deletes a ticket. Immutable after insert (not in the update grant).';

-- A ticket has at most one origin: it comes from an incident, or from a chat,
-- or neither, never both. The escalation and incident paths are distinct.
alter table public.tickets
  add constraint tickets_single_origin
  check (not (incident_id is not null and conversation_id is not null));

-- One conversation, at most a few tickets: partial index on the linked rows.
create index tickets_conversation_id_idx on public.tickets (conversation_id)
  where conversation_id is not null;

-- conversation_id joins the insert column grant so a member may set it at
-- creation. It is deliberately NOT in the update grant: the link is fixed at
-- birth, exactly like incident_id.
grant insert (org_id, submitted_by, title, description, incident_id, conversation_id)
  on table public.tickets to authenticated;

-- The insert with check gains the same org linkage clause the incident_id
-- branch uses. Under the caller's own RLS, "conversations you can see" is your
-- own conversations (or, for an admin, all of them). Org B's conversation id is
-- never in that set, so B cannot mint a ticket pointing at A's conversation,
-- and a member links only a conversation they can already see. ALTER, not drop
-- and recreate, so every other clause from migrations 005 and 006 stays exact.
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
    or incident_id in (select id from public.incidents)
  )
  and (
    conversation_id is null
    or conversation_id in (select id from public.chat_conversations)
  )
);

-- ---------------------------------------------------------------------------
-- The trail learns created_from_chat. Drop and re add the check constraint
-- (Postgres has no ALTER on a check), then extend the trail writer by one
-- branch. A ticket born from a conversation records created_from_chat and
-- carries the conversation id in the detail; the incident and ordinary paths
-- are byte for byte migration 006.

alter table public.ticket_events
  drop constraint ticket_events_event_type_check,
  add constraint ticket_events_event_type_check check (
    event_type in ('created', 'status_changed', 'auto_closed', 'created_from_incident', 'created_from_chat')
  );

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
    if v_actor is null and new.status = 'closed' then
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

-- The trigger binding from migration 005 still points at this function; the
-- revoke is reasserted for the same reason as before.
revoke execute on function public.tickets_write_event() from public, anon, authenticated;
