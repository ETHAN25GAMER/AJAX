-- PestLLM: MCQ flow engine state.
-- The customer conversation becomes deterministic button/list flows
-- (lib/flows/); the free-form agent leaves the customer path. Everything here
-- is idempotent.

-- 1. Flow position on conversations ---------------------------------------------
-- { flow, node, data, updated_at } — null means no active flow (next inbound
-- message opens the main menu). Written only by the webhook (service role).

alter table conversations
  add column if not exists flow_state jsonb;

-- 2. Reminder confirmation on appointments ---------------------------------------
-- Set when the customer taps [Confirm] on the reminder template's quick-reply
-- button. Surfaced as a badge in the admin appointments list.

alter table appointments
  add column if not exists reminder_confirmed_at timestamptz;

-- 3. Deliberately NOT changed ------------------------------------------------------
-- * No RLS changes: conversations/appointments admin policies (0002) already
--   cover the new columns; the webhook writes via the service role.
-- * No flow-definition tables: flows are code (lib/flows/definitions/*) —
--   they branch on tool results and carry per-node behavior a table can't
--   express. Admin-composable sequences already exist as journeys (0019).
-- * state_json keeps its Anthropic MessageParam shape: the engine appends
--   plain text turns, so the conversations UI, human takeover, SLA logging,
--   and retention are untouched.
