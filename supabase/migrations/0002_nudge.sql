-- Track whether we've already sent a re-engagement nudge for the current
-- silence window. Cleared back to NULL the moment the customer replies.
alter table conversations
  add column if not exists nudged_at timestamptz;

create index if not exists conversations_nudge_idx
  on conversations (last_message_at)
  where nudged_at is null;
