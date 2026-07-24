-- Migration 007: the BYOK key vault (Phase 1 Task 5, BRD F6/F7).
--
-- The most sensitive table in the product. An organization brings its own AI
-- provider key (Anthropic, OpenAI, or Google); the chat feature (migration
-- 008) uses it server side. Rulings enforced here, from the Task 5 prompt:
--
--   - Ruling 2: the key is encrypted at the APPLICATION layer (AES 256 GCM,
--     see src/lib/chat/encryption.ts) BEFORE it reaches Postgres. This table
--     stores ciphertext in encrypted_key, plus the provider and the last four
--     plaintext characters for display. The encryption secret lives only in
--     the server env (API_KEY_ENCRYPTION_SECRET), never in the database.
--   - Ruling 3: the key never travels back to a browser after save. There is
--     no reveal path. encrypted_key is therefore withheld from the
--     authenticated SELECT grant entirely (column level grant below): not even
--     an org admin can read the ciphertext through the API. Only the service
--     role reads it, server side, at the moment of a provider call.
--   - Ruling 6: key management is admin only, enforced at the DATABASE via
--     is_org_admin() (the same authority the ticket status policies use, the
--     org_members.role column, not the token claim). Members have no access at
--     all, not even select. Every key action writes an append only trail event
--     (added, replaced, deleted) through a trigger, exactly the ticket_events
--     pattern; users never write the trail directly.
--
-- Members still need to know, without any access to this table, whether their
-- org has a key at all (the Get help AI door only appears when one exists) and
-- which providers are available (the chat provider picker). Two SECURITY
-- DEFINER helpers below answer exactly those two questions, and nothing else:
-- they leak a boolean and a provider list, never the key or its last four.

-- ---------------------------------------------------------------------------
-- org_api_keys: one key per provider per org.

create table public.org_api_keys (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  provider       text not null check (provider in ('anthropic', 'openai', 'google')),
  -- AES 256 GCM ciphertext produced by src/lib/chat/encryption.ts. Never the
  -- plaintext key, never logged. Withheld from the authenticated SELECT grant.
  encrypted_key  text not null check (btrim(encrypted_key) <> ''),
  -- The last four plaintext characters, the only key derived value the UI ever
  -- shows. Safe to display; not enough to reconstruct the key.
  key_last_four  text not null check (btrim(key_last_four) <> '' and char_length(key_last_four) <= 8),
  -- Clerk user id of the admin who added or last replaced the key, pinned by
  -- the insert/update policies to an admin of the active org.
  added_by       text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One key per provider per org: replacing a key updates this row in place.
  unique (org_id, provider)
);

comment on table public.org_api_keys is
  'BYOK provider keys, one per provider per org. encrypted_key is AES 256 GCM ciphertext; the plaintext never touches the database and is withheld from the authenticated SELECT grant. Admin only, enforced by RLS.';
comment on column public.org_api_keys.encrypted_key is
  'AES 256 GCM ciphertext of the provider key. Readable only by the service role, decrypted server side at call time. Never returned to any client.';
comment on column public.org_api_keys.key_last_four is
  'Last four plaintext characters of the key, for display only.';

create trigger org_api_keys_set_updated_at
before update on public.org_api_keys
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- api_key_events: the append only key management trail. Same construction as
-- ticket_events: written only by the trigger below (security definer) and the
-- service role. Users read it, never write it. It records who did what and
-- when, carrying only the provider and last four, never anything key shaped.

create table public.api_key_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  event_type     text not null check (event_type in ('added', 'replaced', 'deleted')),
  provider       text not null check (provider in ('anthropic', 'openai', 'google')),
  key_last_four  text not null,
  -- Clerk user id of the admin behind the action. Never NULL here: every key
  -- action is taken by a signed in admin, never the service role or cron.
  actor          text not null,
  occurred_at    timestamptz not null default now()
);

comment on table public.api_key_events is
  'Append only trail of key management actions. Trigger written; users read, never write. Carries provider and last four only, never the key or ciphertext.';

create index api_key_events_org_id_occurred_at_idx
  on public.api_key_events (org_id, occurred_at);

-- The trail writer. SECURITY DEFINER because admins have no insert verb on
-- api_key_events; the trigger is the one sanctioned path in. Every value comes
-- from the row transition, never from a client supplied field, so there is
-- nothing to inject. It records the last four, never the ciphertext.
create or replace function public.org_api_keys_write_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.api_key_events (org_id, event_type, provider, key_last_four, actor)
    values (new.org_id, 'added', new.provider, new.key_last_four, public.clerk_user_id());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.api_key_events (org_id, event_type, provider, key_last_four, actor)
    values (new.org_id, 'replaced', new.provider, new.key_last_four, public.clerk_user_id());
    return new;
  else
    insert into public.api_key_events (org_id, event_type, provider, key_last_four, actor)
    values (old.org_id, 'deleted', old.provider, old.key_last_four, public.clerk_user_id());
    return old;
  end if;
end;
$$;

create trigger org_api_keys_write_event
after insert or update or delete on public.org_api_keys
for each row execute function public.org_api_keys_write_event();

-- ---------------------------------------------------------------------------
-- Presence helpers for members. SECURITY DEFINER so they can answer "does my
-- org have a key" and "which providers" WITHOUT granting any member access to
-- the table itself (ruling 6: members have no access, not even select). They
-- are scoped to the caller's active org through clerk_active_org_id(), which
-- reads the request JWT and works the same under definer rights. They return a
-- provider list and a boolean, never the key or its last four.

create or replace function public.org_api_key_providers()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select k.provider
  from public.org_api_keys k
  join public.organizations o on o.id = k.org_id
  where o.clerk_org_id = public.clerk_active_org_id()
  order by k.provider
$$;

comment on function public.org_api_key_providers() is
  'Providers the caller''s active org has a key for. SECURITY DEFINER so members can drive the chat provider picker without any access to org_api_keys. Never returns the key or last four.';

create or replace function public.org_has_api_key()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.org_api_key_providers())
$$;

comment on function public.org_has_api_key() is
  'True when the caller''s active org has at least one provider key. Drives the Get help AI door; leaks only a boolean.';

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.org_api_keys enable row level security;
alter table public.api_key_events enable row level security;

-- Admin only, every verb, scoped to the active org. A single FOR ALL policy:
-- select, insert, update, and delete all require is_org_admin() on the row's
-- org (the org_members.role authority, migration 005) AND the row's org being
-- the active org. A non admin member matches zero rows for reads and is
-- refused every write, so they have no access at all. is_org_admin reads the
-- database column, not the token claim, so a forged or stale claim changes
-- nothing.
create policy "org admins manage api keys"
on public.org_api_keys
for all
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
  and added_by = (select public.clerk_user_id())
);

-- The trail is visible to admins of the org and nobody else. No write policy:
-- the trigger and the service role are the only writers.
create policy "org admins read the api key trail"
on public.api_key_events
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- ---------------------------------------------------------------------------
-- GRANTs. Migration 003 pattern: revoke everything, grant back exactly the
-- verbs (and here, columns) each role needs. anon gets nothing.

revoke all on table public.org_api_keys from anon, authenticated;
-- SELECT is column level and DELIBERATELY EXCLUDES encrypted_key: the
-- ciphertext is never selectable through the authenticated role, not even by
-- an admin (ruling 3). Only the service role, with grant all below, reads it.
grant select (id, org_id, provider, key_last_four, added_by, created_at, updated_at)
  on table public.org_api_keys to authenticated;
grant insert (org_id, provider, encrypted_key, key_last_four, added_by)
  on table public.org_api_keys to authenticated;
-- Replace updates the ciphertext, last four, and who did it; updated_at is
-- trigger managed and org_id/provider are the identity, so neither is grantable.
grant update (encrypted_key, key_last_four, added_by)
  on table public.org_api_keys to authenticated;
grant delete on table public.org_api_keys to authenticated;
grant all on table public.org_api_keys to service_role;

revoke all on table public.api_key_events from anon, authenticated;
grant select on table public.api_key_events to authenticated;
grant all on table public.api_key_events to service_role;

-- The trail trigger fires regardless of caller privilege; nothing calls it
-- directly, so nobody may.
revoke execute on function public.org_api_keys_write_event() from public, anon, authenticated;

-- Presence helpers: callable by signed in members (they drive member facing
-- UI), and by the service role. anon never reaches them.
revoke execute on function public.org_api_key_providers() from public, anon;
grant execute on function public.org_api_key_providers() to authenticated, service_role;
revoke execute on function public.org_has_api_key() from public, anon;
grant execute on function public.org_has_api_key() to authenticated, service_role;
