-- Migration 015: chat grounding citations (the F14 follow up).
--
-- One nullable column: which knowledge base articles grounded an assistant
-- reply, as a jsonb array of article ids. The chat route records it at the
-- moment of the reply; the conversation screens later resolve the ids to
-- titles THROUGH THE VIEWER'S OWN SCOPED READ, so what a card shows is
-- governed by the same articles policy as Get Help, not by what is stored
-- here. Ids are references, not content: an id whose article the viewer
-- cannot read resolves to no row and renders nothing.
--
-- Write posture is unchanged from migration 008: chat_messages is written
-- only by the server on the service role, and authenticated holds SELECT
-- alone. The new column needs no grant changes because the table level
-- SELECT covers it and no user verb exists to reach it. Deliberately no
-- foreign key to articles: a deleted article must not delete or null parts
-- of a chat transcript, and a dangling id simply resolves to nothing.

alter table public.chat_messages
  add column grounded_article_ids jsonb;

comment on column public.chat_messages.grounded_article_ids is
  'Article ids that grounded this assistant reply, or NULL for ungrounded messages and user turns. Service role written like the rest of the row. Screens resolve ids through the viewer''s own scoped articles read, so the visibility contract, not this column, decides what renders.';

-- Shape: assistant rows only, an array, and small. Retrieval caps at three
-- articles; eight leaves room without ever letting the column become a
-- dumping ground.
alter table public.chat_messages
  add constraint chat_messages_grounding_shape check (
    grounded_article_ids is null
    or (
      role = 'assistant'
      and jsonb_typeof(grounded_article_ids) = 'array'
      and jsonb_array_length(grounded_article_ids) between 1 and 8
    )
  );
