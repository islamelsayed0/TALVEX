-- Migration 010: notification settings (BRD F10).
--
-- One row per org holding where and when incident notifications go: an email
-- address for Resend, a Discord webhook URL, two email toggles, and the reopen
-- cooldown. The cron sweep (service role) reads it at dispatch time; admins
-- manage it from Settings. Notifications are included on every tier and are
-- never gated, so nothing here encodes a plan check.
--
-- Rulings carried over from the vault (migration 007):
--   - Admin only at the DATABASE via is_org_admin() (the org_members.role
--     column, not the token claim). Members have no access at all.
--   - No delete policy and no delete grant: the row dies with the org via
--     on delete cascade, and clearing a channel is an update to null.
--
-- The webhook URL is org supplied configuration, not a secret on the level of
-- a provider key, but it is still capability bearing (anyone holding it can
-- post into the org's channel), so it stays admin only and is never logged.
--
-- Dedup state lives on the incident itself: incidents.last_notified_at below.
-- A column, not a log table, because the cooldown needs only the time of the
-- most recent notification for that incident, and notification history has no
-- reader in this phase (explicitly out of scope). Service role only, like
-- every other cron managed column on incidents.

-- ---------------------------------------------------------------------------
-- org_notification_settings: one row per org.

create table public.org_notification_settings (
  org_id                 uuid primary key references public.organizations (id) on delete cascade,
  -- Where alert emails go. NULL means email is not configured.
  notification_email     text check (
    notification_email is null or btrim(notification_email) <> ''
  ),
  -- A Discord webhook URL, validated server side (https, discord.com or
  -- discordapp.com, /api/webhooks/ path) before it is saved. NULL means
  -- Discord is not configured.
  discord_webhook        text check (
    discord_webhook is null or btrim(discord_webhook) <> ''
  ),
  -- Email toggles. Discord is deliberately not toggled: configuring the
  -- webhook is the opt in, removing it is the opt out.
  email_on_open          boolean not null default true,
  email_on_resolve       boolean not null default true,
  -- A reopen inside this many minutes of the incident's last notification
  -- sends nothing. Open and resolve always send.
  alert_cooldown_minutes integer not null default 30 check (
    alert_cooldown_minutes between 0 and 1440
  ),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.org_notification_settings is
  'Per org incident notification channels: Resend email and Discord webhook. Admin managed, read by the cron sweep at dispatch time. Never gated by tier.';
comment on column public.org_notification_settings.alert_cooldown_minutes is
  'A reopen within this window of the incident''s last notification sends nothing. Open and resolve ignore the window.';

create trigger org_notification_settings_set_updated_at
before update on public.org_notification_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- incidents.last_notified_at: when this incident last produced a notification
-- (open, reopen, or resolve). NULL until the first send. Written only by the
-- cron path; the authenticated role has select only on incidents (migration
-- 004) so no user session can touch it.

alter table public.incidents add column last_notified_at timestamptz;

comment on column public.incidents.last_notified_at is
  'When this incident last sent a notification. Drives the reopen cooldown. Managed only by the cron sweep (service role).';

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.org_notification_settings enable row level security;

-- Admin only for select, insert, and update, scoped to the active org, the
-- org_api_keys shape exactly. There is deliberately no delete policy (and no
-- delete grant below): the row is removed only by the org cascade.
create policy "org admins manage notification settings"
on public.org_notification_settings
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

create policy "org admins create notification settings"
on public.org_notification_settings
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

create policy "org admins update notification settings"
on public.org_notification_settings
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

-- ---------------------------------------------------------------------------
-- GRANTs. Migration 003 pattern: revoke everything, grant back exactly the
-- verbs and columns each role needs. anon gets nothing. No delete for
-- authenticated: the cascade is the only remover.

revoke all on table public.org_notification_settings from anon, authenticated;
grant select on table public.org_notification_settings to authenticated;
grant insert (org_id, notification_email, discord_webhook, email_on_open, email_on_resolve, alert_cooldown_minutes)
  on table public.org_notification_settings to authenticated;
-- org_id is the identity and is not updatable; timestamps are trigger managed.
grant update (notification_email, discord_webhook, email_on_open, email_on_resolve, alert_cooldown_minutes)
  on table public.org_notification_settings to authenticated;
grant all on table public.org_notification_settings to service_role;
