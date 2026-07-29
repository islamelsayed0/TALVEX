-- Migration 013: the audit log (BRD F12).
--
-- One org wide, append only record of sensitive actions: who did what, when,
-- in which org. The BRD names the categories: role changes, key changes,
-- deletions, billing events. Billing does not exist yet (Phase 2), so the
-- starting vocabulary covers the sensitive actions the product performs
-- today; later features extend the vocabulary by migration (the check
-- constraint below is named for exactly that reason).
--
-- The writing pattern is the one migrations 005 and 007 established and this
-- schema now formalizes as THE audit fanout pattern: SECURITY DEFINER trigger
-- functions on the audited tables are the only writers. Row transitions, not
-- client supplied values, are the source of every recorded fact, so there is
-- nothing a caller can spoof or inject, and an action cannot forget to audit
-- itself because the database, not app code, does the recording. User
-- sessions hold no write verb on the log at all; admins read their own org's
-- log and nobody else's.
--
-- What the detail column carries is deliberately minimal: identifiers, names,
-- and state transitions. Never key material, never ciphertext, never bulk
-- content. Each trigger below states what it records and why that is safe.

-- ---------------------------------------------------------------------------
-- The log itself.

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  -- The vocabulary. Named so later migrations can extend it: drop the
  -- constraint, add it back with the new actions appended. Existing rows
  -- always satisfy the wider set, so the swap is safe on a populated table.
  action       text not null,
  -- Clerk user id of the person behind the action. NULL means the system:
  -- the Clerk webhook sync or a cron path, which run on the service role
  -- token and carry no sub claim.
  actor        text,
  -- Small structured facts about the action: identifiers, names, state
  -- transitions. Never secrets, never bulk content. Shape per action is
  -- documented on each trigger below.
  detail       jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  constraint audit_log_action_allowed check (
    action in (
      'member_role_changed',
      'api_key_added',
      'api_key_replaced',
      'api_key_deleted',
      'monitor_deleted'
    )
  )
);

comment on table public.audit_log is
  'Append only org wide log of sensitive actions (BRD F12). Written only by SECURITY DEFINER triggers on the audited tables; admins read their own org, nobody updates or deletes.';
comment on column public.audit_log.actor is
  'Clerk user id of the person behind the action. NULL means the system (webhook or cron, service role token).';
comment on column public.audit_log.detail is
  'Small structured facts: identifiers, names, transitions. Never key material or bulk content.';

-- The screen reads one org's log newest first; this is that exact question.
create index audit_log_org_id_occurred_at_idx
  on public.audit_log (org_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Fanout triggers. Each is SECURITY DEFINER because the sessions whose
-- actions they record deliberately hold no insert verb on audit_log; the
-- trigger is the one sanctioned path in (the ticket_events construction).
--
-- Each writer skips when the owning org row is already gone: during an org
-- delete the cascade removes child rows first and fires these triggers while
-- the organizations row no longer exists, so inserting a log row would break
-- the foreign key for a log that is about to cascade away regardless. An org
-- being deleted takes its audit log with it by design.

-- Role changes (BRD: role changes). Fires on org_members updates that change
-- role, whether the writer is the Clerk webhook (service role, actor NULL)
-- or an org admin correcting a row under the migration 001 policy. Detail:
-- the target user and the transition, so the log answers who changed whose
-- role from what to what.
create function public.audit_org_members_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from new.role
     and exists (select 1 from public.organizations where id = new.org_id) then
    insert into public.audit_log (org_id, action, actor, detail)
    values (
      new.org_id,
      'member_role_changed',
      public.clerk_user_id(),
      jsonb_build_object(
        'target_user_id', new.clerk_user_id,
        'old_role', old.role,
        'new_role', new.role
      )
    );
  end if;
  return null;
end;
$$;

create trigger audit_org_members_role_change
after update on public.org_members
for each row execute function public.audit_org_members_role_change();

-- Key changes (BRD: key changes). Mirrors the api_key_events trail into the
-- org wide log. Detail carries the provider and the last four display
-- characters, the same two facts the trail records, and never the ciphertext:
-- the value is simply not read here.
create function public.audit_org_api_keys_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_org uuid;
  v_provider text;
  v_last_four text;
begin
  if tg_op = 'INSERT' then
    v_action := 'api_key_added';
    v_org := new.org_id; v_provider := new.provider; v_last_four := new.key_last_four;
  elsif tg_op = 'UPDATE' then
    v_action := 'api_key_replaced';
    v_org := new.org_id; v_provider := new.provider; v_last_four := new.key_last_four;
  else
    v_action := 'api_key_deleted';
    v_org := old.org_id; v_provider := old.provider; v_last_four := old.key_last_four;
  end if;
  if exists (select 1 from public.organizations where id = v_org) then
    insert into public.audit_log (org_id, action, actor, detail)
    values (
      v_org,
      v_action,
      public.clerk_user_id(),
      jsonb_build_object('provider', v_provider, 'key_last_four', v_last_four)
    );
  end if;
  return null;
end;
$$;

create trigger audit_org_api_keys_change
after insert or update or delete on public.org_api_keys
for each row execute function public.audit_org_api_keys_change();

-- Deletions (BRD: deletions). Monitors are the entity the product deletes
-- today. Detail carries the monitor's name so the log stays meaningful after
-- the row is gone; the url stays out because the name is enough to identify
-- the loss and the log should carry the minimum that does the job.
create function public.audit_monitors_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations where id = old.org_id) then
    insert into public.audit_log (org_id, action, actor, detail)
    values (
      old.org_id,
      'monitor_deleted',
      public.clerk_user_id(),
      jsonb_build_object('name', old.name)
    );
  end if;
  return null;
end;
$$;

create trigger audit_monitors_delete
after delete on public.monitors
for each row execute function public.audit_monitors_delete();

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.audit_log enable row level security;

-- Admins read their own org's log. The role authority is org_members.role
-- through is_org_admin (migration 005), never the token claim. Members have
-- no access at all: a sensitive action log is an administration surface.
create policy "org admins read their org's audit log"
on public.audit_log
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- No insert, update, or delete policies for user sessions: the triggers
-- above and the service role are the only writers, and nothing ever updates
-- or deletes. The grants below withhold those verbs too, so the absence is
-- enforced twice.

-- ---------------------------------------------------------------------------
-- GRANTs. Migration 003 pattern: revoke everything, grant back exactly what
-- each role needs. anon gets nothing.

revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;
grant all on table public.audit_log to service_role;

-- Trigger functions fire regardless of the caller's execute privilege;
-- nothing calls them directly, so nobody may.
revoke execute on function public.audit_org_members_role_change() from public, anon, authenticated;
revoke execute on function public.audit_org_api_keys_change() from public, anon, authenticated;
revoke execute on function public.audit_monitors_delete() from public, anon, authenticated;
