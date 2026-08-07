-- Migration 024: chat_messages.key_source, the managed metering discriminator
-- (F13 PR 3).
--
-- The managed AI path bills answers made on the PLATFORM key against the
-- org's monthly allowance (org_billing.ai_answers_included). Metering counts
-- assistant rows, so the row must say which key answered: counting every
-- assistant row would meter customers for calls made on their own BYOK key,
-- which is free and uncapped forever by the frozen pricing.
--
-- NULL means the row predates this column (the BYOK only era) or is a user
-- row; the meter counts key_source = 'platform' exactly, so history can
-- never be billed retroactively and user rows never count. The column is on
-- a table user sessions cannot write in any verb (migration 008), so the
-- meter's inputs are as unforgeable as the messages themselves.

alter table public.chat_messages
  add column key_source text
  check (key_source in ('byok', 'platform'));

-- A user row never carries a key: same shape discipline as the migration
-- 008 role fields constraint, stated as its own named constraint.
alter table public.chat_messages
  add constraint chat_messages_key_source_role
  check (key_source is null or role = 'assistant');

comment on column public.chat_messages.key_source is
  'Which key answered: byok (org key, never metered) or platform (managed, counted against org_billing.ai_answers_included). NULL predates F13 or is a user row.';
