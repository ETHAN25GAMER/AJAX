-- PestLLM: abandoned-booking recovery marker.
-- One personalized recovery message per silence window for threads with real
-- booking intent (a quote or availability check with no booking afterwards) —
-- the field-services analogue of e-commerce cart recovery. Idempotent.

-- Mirrors nudged_at (0002_nudge): set when the recovery cron sends, cleared in
-- saveConversationHistory the moment the customer replies so a future
-- abandonment can be recovered again.
alter table conversations
  add column if not exists recovery_sent_at timestamptz;

-- Deliberately NOT changed --------------------------------------------------
-- * No new index: the recovery cron reuses the nudge cron's access path
--   (last_message_at range scan + is-null filter on a 500-row-scale table).
-- * Coordination with the nudge cron lives in code, not schema: nudges skip
--   threads the abandoned-booking detector claims (lib/recovery.ts), so the
--   two crons never double-message one customer.
