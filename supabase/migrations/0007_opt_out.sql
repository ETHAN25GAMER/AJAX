-- PestLLM: DPDP Act opt-out. Customers can reply STOP to stop proactive outreach
-- (re-engagement nudges, future marketing/review requests). Inbound messages are
-- still answered — replying to someone who messaged you isn't unsolicited.

alter table customers
  add column if not exists opted_out boolean not null default false,
  add column if not exists opted_out_at timestamptz;
