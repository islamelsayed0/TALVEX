-- Migration 020: SSL certificate expiry alerts.
--
-- The check path already opens a TLS connection to every https monitor on
-- every sweep. This migration adds the two columns that let the sweep remember
-- what that handshake said: when the certificate expires, and which warning
-- threshold has already been alerted, so each crossing notifies exactly once.
--
-- Rulings carried into the schema:
--   - Both columns are sweep owned ledgers, the digest_last_sent_on posture
--     from migration 017: no user session holds a write grant on either. A
--     writable cert_expires_at would let a user fabricate expiry warnings;
--     a writable cert_alerted_threshold would let one replay or suppress
--     them. The isolation suite proves the refusal.
--   - http monitors carry NULL and no product surface shows anything for
--     them. NULL on an https monitor means the expiry has not been read yet
--     (or the last handshake failed and the previous value was kept).
--   - An expiring certificate is a warning, not an incident, so nothing here
--     touches the incidents tables and no audit action is added: certificate
--     state is telemetry, not an admin action.
--
-- The grant conversion below is the load bearing part. Migration 003 granted
-- insert and update on monitors TABLE WIDE to authenticated, and table wide
-- grants cover columns added later, which would hand user sessions these two
-- ledgers the moment they exist. So the write verbs move to column lists:
-- exactly the columns the app writes today (src/lib/db/monitors.ts:
-- createMonitor inserts org_id, name, url, interval_seconds; updateMonitor
-- updates name, url, interval_seconds, active). A welcome side effect is that
-- the sweep owned columns from 003/004 (last_checked_at, last_status,
-- failing_since), service role only by convention until now, become service
-- role only by grant as well. select and delete stay table wide: members read
-- every column of their org's monitors, and delete has no column dimension.

alter table public.monitors
  add column cert_expires_at timestamptz,
  add column cert_alerted_threshold text
    check (cert_alerted_threshold in ('14d', '3d', 'expired'));

comment on column public.monitors.cert_expires_at is
  'Expiry instant of the TLS certificate observed by the most recent successful https handshake. NULL for http monitors, and for https monitors not yet read. Written only by the cron sweep (service role); no user session holds a grant on it.';
comment on column public.monitors.cert_alerted_threshold is
  'Deepest expiry threshold already notified for the current certificate (14d, 3d, expired). The dedup ledger: each threshold crossing alerts once, and a renewal that moves cert_expires_at later clears it. Written only by the cron sweep (service role); no user session holds a grant on it.';

-- ---------------------------------------------------------------------------
-- GRANTs. Convert the monitors write verbs from table wide to column scoped
-- so the two new columns are excluded for user sessions. The RLS policies
-- from migration 003 are unchanged: rows are still scoped to the active org;
-- this narrows which columns a permitted row write may touch.
--
-- service_role needs nothing here: migration 003 granted it ALL at the table
-- level, which covers columns added later, including both ledgers. The anon
-- column grants from migration 011 (id, org_id, name, last_status for the
-- public status page) are additive column grants and are untouched; they do
-- not include the new columns, so the status page cannot read cert data.

revoke insert, update on table public.monitors from authenticated;

grant insert (org_id, name, url, interval_seconds, active)
  on table public.monitors to authenticated;
grant update (name, url, interval_seconds, active)
  on table public.monitors to authenticated;
