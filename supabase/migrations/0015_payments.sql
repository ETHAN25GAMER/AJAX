-- PestLLM: payment links (Razorpay).
-- Booking deposits and AMC renewal collection via hosted payment links shared
-- in the WhatsApp thread. Rows are written by the tools / payments webhook
-- (service role); admins read them in the console. Idempotent.

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  purpose text not null check (purpose in ('deposit','amc_renewal')),
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created','paid','failed')),
  -- Razorpay payment-link id (plink_…) — the webhook routes paid events by it.
  provider_ref text unique,
  link_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists payments_customer_idx on payments (customer_id);
create index if not exists payments_appointment_idx
  on payments (appointment_id) where appointment_id is not null;

alter table payments enable row level security;

-- Admin read-only in the console; all writes go through the service role
-- (create_appointment / request_amc_renewal tools and the Razorpay webhook).
drop policy if exists payments_admin_select on payments;
create policy payments_admin_select on payments
  for select to authenticated
  using (is_admin(auth.uid()));

-- Deliberately NOT changed ----------------------------------------------------
-- * No amc_id column: AMC contracts are keyed by customer_id (one per
--   customer, 0008), so customer_id + purpose='amc_renewal' identifies the
--   contract without a second FK.
-- * No 'refunded'/'expired' statuses: out of scope until refunds are a real
--   workflow; Razorpay link expiry simply leaves the row 'created'.
-- * Deposit amount is env-driven (RAZORPAY_DEPOSIT_AMOUNT), not a
--   deployment_settings column: it's an operational knob like
--   RETENTION_CONV_MONTHS, and env keeps it alongside the Razorpay keys it
--   depends on.
