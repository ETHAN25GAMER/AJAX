-- PestLLM: message-event log for SLA / responsiveness analytics.
-- conversations.state_json turns carry no timestamps, so response times were
-- uncomputable. This is a timestamp+direction log, NOT a message store — no
-- message content is duplicated here, so the DPDP retention posture is
-- unchanged (and rows are pruned on the same clock, see the retention cron).
-- Everything here is idempotent.

create table if not exists message_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound_agent','outbound_staff')),
  at timestamptz not null default now()
);

-- The KPI pairing scan walks a conversation's events in time order.
create index if not exists message_events_convo_at_idx
  on message_events (conversation_id, at);

-- Range-bounded KPI fetches and the retention prune both cut on `at`.
create index if not exists message_events_at_idx on message_events (at);

-- FK covering index for the cascade path on customer deletion (DPDP erasure).
create index if not exists message_events_customer_idx on message_events (customer_id);

alter table message_events enable row level security;

-- Admin read for the KPI "Responsiveness" section; writes come from the
-- webhook / staff-reply action via the service role.
drop policy if exists message_events_admin_select on message_events;
create policy message_events_admin_select on message_events
  for select to authenticated
  using (is_admin(auth.uid()));

-- Deliberately NOT changed ------------------------------------------------------
-- * No body/content column: SLA needs when + who, never what. Content lives in
--   state_json under the existing retention policy.
-- * No Realtime publication: this is an analytics log, not a live feed.
