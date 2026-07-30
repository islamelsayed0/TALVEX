-- Migration 017: the daily digest.
--
-- One email per org per day, at a time the org chooses, in the org's own
-- timezone, listing what needs attention today. Three columns on the F10
-- settings row (migration 010) rather than a table of their own: the digest is
-- another channel setting for the same org, read by the same cron sweep at the
-- same point, and it has no history to keep.
--
-- Rulings carried into the schema:
--   - Off by default. Enabling is a deliberate admin act, so an org that never
--     visits the settings tab never receives an email it did not ask for.
--   - The send time is a wall clock time, not an instant. It is read against
--     organizations.timezone (migration 012, the F11 authority), so 07:30 means
--     the org's 07:30 across daylight saving, forever.
--   - Quiet days send nothing, which is a composition decision and appears
--     nowhere in this schema. The ledger is still stamped on a quiet day,
--     because it records that the day is SETTLED rather than that an email
--     went out: without that, an incident opening at two in the afternoon
--     would make the digest suddenly due and a "your day" email would arrive
--     in the afternoon. Alerting in the moment is the incident alert's job.
--   - The digest ships ungated. Packaging intent is a paid tier at F13
--     (docs/DECISIONS.md, 2026-07-30), so nothing here encodes a plan check,
--     exactly as migration 010 encodes none for incident alerts.
--
-- Reach, and why the ledger is different from the other two columns:
--   digest_enabled and digest_send_time are settings. They ride the existing
--   admin only policies from migration 010 unchanged (that policy is not
--   column scoped; column reach on this table has always been grant
--   controlled), so this migration only extends the insert and update grants.
--
--   digest_last_sent_on is NOT a setting. It is the dedup ledger the sweep
--   writes after a successful send, and it is what stops a second email the
--   same day. It gets no insert or update grant for authenticated at all, so
--   an admin cannot write it even though the same policy passes: a writable
--   ledger would let a user replay today's digest by clearing it, or suppress
--   tomorrow's by stamping it forward. Service role only, the same posture as
--   incidents.last_notified_at. The isolation suite proves the refusal.

alter table public.org_notification_settings
  add column digest_enabled     boolean not null default false,
  add column digest_send_time   time    not null default '08:00',
  add column digest_last_sent_on date;

-- Whole minutes only. The settings form offers HH:MM and the sweep compares
-- the org's local time to this value in whole minutes, so a stray seconds
-- component would be a value the product cannot express or honour.
alter table public.org_notification_settings
  add constraint org_notification_settings_digest_send_time_minute check (
    extract(second from digest_send_time) = 0
  );

comment on column public.org_notification_settings.digest_enabled is
  'Whether this org receives the daily digest. Off until an admin turns it on. Never gated by tier.';
comment on column public.org_notification_settings.digest_send_time is
  'Wall clock time the digest is due, read in organizations.timezone (migration 012). The sweep runs every 5 minutes, so the email lands at or shortly after this time.';
comment on column public.org_notification_settings.digest_last_sent_on is
  'The org local date this org''s digest was last settled: sent, or found to have nothing to report. The dedup ledger, so at most one digest per org per day. Written only by the cron sweep (service role); no user session holds a grant on it.';

-- ---------------------------------------------------------------------------
-- GRANTs. Column grants in Postgres are additive, so these extend the migration
-- 010 grants rather than replacing them; the columns listed there keep exactly
-- the reach they had. digest_last_sent_on appears in neither list on purpose.
--
-- service_role needs nothing here: migration 010 granted it ALL at the table
-- level, which covers columns added later, including the ledger.

grant insert (digest_enabled, digest_send_time)
  on table public.org_notification_settings to authenticated;
grant update (digest_enabled, digest_send_time)
  on table public.org_notification_settings to authenticated;
