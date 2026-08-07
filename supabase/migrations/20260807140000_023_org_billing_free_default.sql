-- Migration 023: org_billing.monitor_limit defaults to the free tier's 2.
--
-- Found while building the clickwrap write (F13 PR 2). The clickwrap stamp
-- creates an org's billing row BEFORE any checkout completes, providing only
-- the acceptance columns, so every other column takes its default. Migration
-- 022 left monitor_limit with no default, and on this table NULL means
-- UNLIMITED: accepting the terms without paying would have produced a free
-- plan row that read as unlimited monitors. The resolver now refuses that
-- reading in code (a free plan always resolves to the free matrix), and this
-- migration fixes the row itself so the database never carries the lie. The
-- webhook always writes monitor_limit explicitly, so paid plans are
-- untouched by the default.

alter table public.org_billing
  alter column monitor_limit set default 2;

-- Any row already created through the clickwrap path before this migration:
-- free plan, never written by the webhook, NULL limit. Same reasoning, so
-- the backfill is scoped exactly to that shape.
update public.org_billing
  set monitor_limit = 2
  where plan = 'free' and monitor_limit is null;
