-- Both messages of a single turn (user + assistant) are inserted together in
-- one statement in line-bot/index.ts, so they get the *identical*
-- created_at (Postgres evaluates now() once per transaction). Ordering
-- history by created_at alone can then return that pair in either order on
-- retrieval, scrambling who-said-what for the model. A monotonic sequence
-- gives a real total order regardless of timestamp ties.
alter table ai_secretary_messages add column seq bigserial;
create index ai_secretary_messages_conversation_seq_idx on ai_secretary_messages(conversation_id, seq);
