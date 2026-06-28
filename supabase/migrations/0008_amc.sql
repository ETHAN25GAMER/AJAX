-- PestLLM Phase 6: AMC (Annual Maintenance Contracts).
-- One summary row per customer. Drives the daily renewal-reminder + upsell crons
-- and the agent's lookup/renew/subscribe tools.

-- 1. amc: one row per customer ---------------------------------------------

create table if not exists amc (
  customer_id        uuid primary key references customers(id) on delete cascade,
  commenced_at       date not null,
  renews_at          date not null,
  lead_days          int not null default 30,
  pest_type          text not null,
  annual_price       numeric(10,2),
  status             text not null default 'active'
                       check (status in ('active','expired','cancelled','pending_renewal')),
  reminder_sent_at   timestamptz,
  followup_sent_at   timestamptz,
  notes              text,
  created_at         timestamptz not null default now()
);

-- Daily cron sorts by renews_at; partial index covers the active-only filter.
create index if not exists amc_active_renews_idx
  on amc (renews_at) where status = 'active';

alter table amc enable row level security;

-- Admin: full CRUD. Inline exists() per [[feedback-supabase-realtime]] for
-- consistency with the rest of the project (this table isn't in the realtime
-- publication, but the pattern is what we use everywhere now).
drop policy if exists amc_admin_all on amc;
create policy amc_admin_all on amc
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- Tech: SELECT only for customers they have an appointment with.
drop policy if exists amc_tech_select on amc;
create policy amc_tech_select on amc
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = amc.customer_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- 2. customers.amc_pitched_at -----------------------------------------------
-- Throttles the upsell cron to one pitch per 90 days per customer. Lives on
-- customers (not amc) because upsell targets don't have an amc row yet.

alter table customers
  add column if not exists amc_pitched_at timestamptz;
