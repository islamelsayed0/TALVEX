-- Migration 021: maintenance windows (pause alerts for one monitor).
--
-- An MSP restarting a server at midnight currently triggers a real incident,
-- an email, and a Discord ping. This migration adds the state for "pause
-- alerts for this monitor until a chosen time": suppression silences
-- NOTIFICATIONS ONLY. Checks still run, incidents still open and resolve,
-- the timeline stays true; only the noise is held. Dispatch consults
-- suppress_until at send time and the sweep catches up an open incident the
-- window outlived, so a real outage is never swallowed.
--
-- Rulings carried into the schema:
--   - One window per monitor at a time: a single suppress_until timestamptz.
--     Setting while one is active replaces it; clearing ends it. No
--     recurrence, no schedules.
--   - Hard cap of 24 hours, enforced BY THE DATABASE against a stamped set
--     time. A forgotten window is the failure mode; the cap is the safety.
--     The cap is trustworthy only because suppress_set_at is written by the
--     gate trigger below, never by a client: a client writable set time
--     could be forged forward to stretch the window.
--   - Setting and clearing a window is an ADMIN action and is audited
--     (monitor_alerts_paused / monitor_alerts_resumed). The detail carries
--     the until timestamp, which is schedule metadata, not content.
--
-- Enforcement shape, and why a trigger: Postgres has no per column policies,
-- so "members may update name and url but only admins may update
-- suppress_until" cannot be said in RLS. The BEFORE UPDATE gate below raises
-- unless the caller's session is an org admin (the same clerk_is_org_admin
-- claim authority the migration 001 policies use) or the service role, and
-- it stamps suppress_set_at itself, which is how a column no user session
-- holds a grant on gets its value (the set_updated_at precedent: trigger
-- assignments are not column privilege checked). No SECURITY DEFINER is
-- needed; the definer discipline stays reserved for functions that must
-- cross a privilege boundary, and this one does not.

alter table public.monitors
  add column suppress_until  timestamptz,
  add column suppress_set_at timestamptz,
  add constraint monitors_suppress_until_capped check (
    suppress_until is null
    or (suppress_set_at is not null
        and suppress_until <= suppress_set_at + interval '24 hours')
  );

comment on column public.monitors.suppress_until is
  'Alerts for this monitor are silenced until this instant. NULL means no window. One window per monitor; setting replaces, clearing ends. Capped at 24 hours from the stamped set time. Notifications only: checks, incidents, and the timeline are untouched.';
comment on column public.monitors.suppress_set_at is
  'When the current window was set, stamped by the gate trigger and never by a client, so the 24 hour cap cannot be stretched. NULL whenever suppress_until is NULL.';

-- ---------------------------------------------------------------------------
-- The gate: admin only writes to suppress_until, and the trusted stamp.

create function public.monitors_suppression_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.suppress_until is distinct from old.suppress_until then
    -- current_user is the caller's database role because this function is
    -- NOT security definer: 'authenticated' for user sessions, whatever the
    -- claim says, and 'service_role' for the admin client and the sweep.
    if current_user <> 'service_role'
       and not (select public.clerk_is_org_admin()) then
      raise insufficient_privilege
        using message = 'Only an organization admin can pause or resume alerts.';
    end if;
    if new.suppress_until is null then
      new.suppress_set_at := null;
    else
      new.suppress_set_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger monitors_suppression_gate
before update on public.monitors
for each row execute function public.monitors_suppression_gate();

revoke execute on function public.monitors_suppression_gate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit: pausing and resuming are admin actions the log must carry.

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
    'ticket_reopened',
    'monitor_alerts_paused',
    'monitor_alerts_resumed'
  )
);

-- The 013 definer pattern: fires only on real change to suppress_until, so
-- the sweep's routine status updates and a window expiring on its own (which
-- touches nothing) record nothing. Replacing an active window is a pause
-- with the new until. Detail carries the monitor name and, for a pause, the
-- until timestamp: schedule metadata, not content.
create function public.audit_monitors_suppression_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.suppress_until is distinct from old.suppress_until
     and exists (select 1 from public.organizations where id = new.org_id) then
    if new.suppress_until is null then
      insert into public.audit_log (org_id, action, actor, detail)
      values (
        new.org_id,
        'monitor_alerts_resumed',
        public.clerk_user_id(),
        jsonb_build_object('name', new.name)
      );
    else
      insert into public.audit_log (org_id, action, actor, detail)
      values (
        new.org_id,
        'monitor_alerts_paused',
        public.clerk_user_id(),
        jsonb_build_object('name', new.name, 'until', new.suppress_until)
      );
    end if;
  end if;
  return null;
end;
$$;

create trigger audit_monitors_suppression_change
after update on public.monitors
for each row execute function public.audit_monitors_suppression_change();

revoke execute on function public.audit_monitors_suppression_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- GRANTs. Additive on the migration 020 column lists (the 017 idiom):
-- suppress_until becomes writable for authenticated sessions, with the gate
-- trigger deciding WHICH authenticated sessions. suppress_set_at appears in
-- no user grant at all, exactly like cert_alerted_threshold and
-- digest_last_sent_on: it is the ledger the cap is measured against.
-- service_role holds table level ALL from migration 003, which covers both.

grant update (suppress_until) on table public.monitors to authenticated;
