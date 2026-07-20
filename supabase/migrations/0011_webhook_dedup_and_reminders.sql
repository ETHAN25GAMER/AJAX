-- PestLLM: webhook idempotency + reminder dedup.
--
-- 1. wa_messages — one row per WhatsApp message id we have accepted for
--    processing. Meta redelivers webhooks it thinks failed, and a batch can be
--    retried wholesale; inserting the message id first (and skipping on
--    conflict) makes agent runs — and their tool side effects like bookings —
--    idempotent per inbound message.
--
-- 2. appointments.reminder_sent_at — set when the 24h reminder template goes
--    out. The reminders cron previously selected a 2-hour slot window on an
--    hourly schedule, so every appointment matched two consecutive runs and
--    customers got the reminder twice. Filtering on this column makes the send
--    once-only regardless of window width or cron retries.
--
-- Both objects are touched only by the service-role client (webhook + cron).
-- RLS is enabled with no policies so anon/authenticated roles have no access;
-- service role bypasses RLS.

create table if not exists wa_messages (
  id text primary key,               -- Meta message id (wamid.…)
  received_at timestamptz not null default now()
);

alter table wa_messages enable row level security;

-- Retention: rows only need to outlive Meta's redelivery horizon; the daily
-- retention cron may prune anything older than a few days.
create index if not exists wa_messages_received_at_idx
  on wa_messages (received_at);

alter table appointments
  add column if not exists reminder_sent_at timestamptz;
