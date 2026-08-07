-- Migration 022: billing entitlements (BRD F13, frozen pricing in
-- docs/DECISIONS.md 2026-08-07).
--
-- Two tables, both written by the server alone:
--
--   org_billing            one row per org that has ever touched Stripe. The
--                          Stripe webhook is the writer, on the service role,
--                          mirroring the Clerk webhook posture: a webhook
--                          carries no user session, so there is no token to
--                          scope by. Admins of the org read their own row and
--                          nothing else; no user session holds any write verb.
--                          An org with NO row is free tier by definition, and
--                          the resolver in src/lib/billing/entitlements.ts
--                          treats absence as free, never as an error.
--
--   stripe_webhook_events  the idempotency ledger, ported from the HelpMe Hub
--                          predecessor: one row per Stripe event id, created
--                          when the event first arrives, stamped processed_at
--                          when handling succeeds. "Seen" and "done" are two
--                          separate states, so a delivery that failed halfway
--                          is retried by Stripe and reprocessed, while a
--                          duplicate of a finished delivery returns 200
--                          without touching org_billing. User sessions have
--                          no business here at all, in any verb.
--
-- The entitlement columns (plan, limits, the AI allowance) are denormalized
-- onto org_billing on purpose: the webhook computes them from the plan matrix
-- at write time, so enforcement reads one row instead of re-deriving pricing,
-- and a plan change is visible in the database as a plain diff. The free tier
-- values double as column defaults so a partially written row degrades to
-- free, never to more.

-- ---------------------------------------------------------------------------
-- org_billing

create table public.org_billing (
  org_id                  uuid primary key
                          references public.organizations (id) on delete cascade,
  -- Both Stripe ids are unique: the subscription event handlers match rows by
  -- these columns, and uniqueness is what makes that match one org, never a
  -- fan out across tenants.
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  plan                    text not null default 'free'
                          check (plan in ('free', 'basic', 'pro', 'business')),
  status                  text not null default 'active'
                          check (status in ('active', 'past_due', 'canceled')),
  -- Managed AI answers included per month, the TOTAL the org is entitled to:
  -- plan allowance plus the add on when ai_addon is true. Zero means the
  -- managed path is closed (BYOK chat is ungated forever and never consults
  -- this table).
  ai_answers_included     integer not null default 0
                          check (ai_answers_included >= 0),
  ai_addon                boolean not null default false,
  -- How many organizations the paying account may hold (Business raises this
  -- to 10). Enforcement lands in F13 PR 3.
  org_limit               integer not null default 1
                          check (org_limit >= 1),
  -- NULL means unlimited. Free is 2, Basic 15, Pro and Business NULL.
  monitor_limit           integer
                          check (monitor_limit is null or monitor_limit >= 0),
  current_period_end      timestamptz,
  -- The clickwrap legal gate (docs/DECISIONS.md 2026-08-07): stamped by the
  -- checkout server action BEFORE any checkout session is created, with the
  -- version of the terms that was on screen. Never written by the webhook and
  -- never cleared by it.
  clickwrap_accepted_at   timestamptz,
  clickwrap_terms_version text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.org_billing is
  'One row per org that has touched Stripe billing (BRD F13). Server written only: the Stripe webhook and the checkout action, both on the service role. No row means free tier by definition.';
comment on column public.org_billing.ai_answers_included is
  'Total managed AI answers per month: plan allowance plus add on. Zero closes the managed path; BYOK is never consulted against this.';
comment on column public.org_billing.monitor_limit is
  'NULL means unlimited.';
comment on column public.org_billing.clickwrap_accepted_at is
  'When an org admin accepted the Terms of Service and Privacy Policy at checkout. Written by the checkout action before any Stripe session exists.';

create trigger org_billing_set_updated_at
before update on public.org_billing
for each row execute function public.set_updated_at();

alter table public.org_billing enable row level security;

-- Admins read their own org's billing row. The role authority is
-- org_members.role through is_org_admin (migration 005), never the token
-- claim. Members see nothing: billing is an administration surface, like the
-- audit log.
create policy "org admins read their org's billing"
on public.org_billing
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- No insert, update, or delete policies for user sessions: the webhook and
-- the checkout action write on the service role. The grants below withhold
-- the verbs too, so the absence is enforced twice (migration 017 pattern).

revoke all on table public.org_billing from anon, authenticated;
grant select on table public.org_billing to authenticated;
grant all on table public.org_billing to service_role;

-- ---------------------------------------------------------------------------
-- stripe_webhook_events

create table public.stripe_webhook_events (
  -- The Stripe event id ('evt_...'), the natural key idempotency hangs on.
  id            text primary key,
  event_type    text not null,
  -- NULL until handling succeeds. A row with a NULL stamp is a delivery that
  -- was seen but not finished; Stripe's retry reprocesses it, and every
  -- handler is an idempotent upsert so reprocessing is safe.
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.stripe_webhook_events is
  'Idempotency ledger for /api/webhooks/stripe, ported from the HelpMe Hub predecessor. Row on first sight, processed_at stamp on success. Service role only; no user session holds any verb.';

-- RLS on with no policies: even if a grant ever widened by mistake, the
-- policy layer would still return nothing to user sessions. Platform state,
-- not tenant data, like platform_heartbeat.
alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events from anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;
