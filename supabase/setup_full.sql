-- =============================================================
-- PestLLM — FULL SETUP (generated from supabase/migrations/*)
-- Run ONCE in the Supabase SQL editor on a FRESH project.
-- Concatenation of migrations 0001–0021 in filename order;
-- includes both 0002_* and both 0011_* files.
-- Regenerate after adding a migration — do not hand-edit.
-- After this: run supabase/seed_havier.sql, create the
-- 'job-photos' Storage bucket, promote your first admin.
-- =============================================================

-- ============ 0001_init.sql ============
-- PestLLM initial schema

create extension if not exists "pgcrypto";

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references customers(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  state_json jsonb not null default '[]'::jsonb
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  confirmation_code text not null unique,
  pest_type text not null,
  service_tier text not null check (service_tier in ('standard','plus','specialist')),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status text not null default 'booked' check (status in ('booked','cancelled','completed')),
  price_quoted numeric(10,2),
  created_at timestamptz not null default now()
);

create index if not exists appointments_slot_idx on appointments (slot_start) where status = 'booked';

create table if not exists pricing (
  id uuid primary key default gen_random_uuid(),
  pest_type text not null,
  service_tier text not null check (service_tier in ('standard','plus','specialist')),
  base_price numeric(10,2) not null,
  per_sqft numeric(10,4) not null default 0,
  notes text,
  requires_inspection boolean not null default false,
  unique (pest_type, service_tier)
);

create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  summary text not null,
  urgency text not null check (urgency in ('low','normal','high')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed pricing rows
insert into pricing (pest_type, service_tier, base_price, per_sqft, notes, requires_inspection) values
  ('ants',        'standard', 149.00, 0.00, 'one visit + 30-day guarantee', false),
  ('ants',        'plus',     349.00, 0.00, 'quarterly recurring', false),
  ('spiders',     'standard', 149.00, 0.00, 'one visit + 30-day guarantee', false),
  ('roaches',     'standard', 199.00, 0.03, 'german roaches priced higher', false),
  ('roaches',     'plus',     449.00, 0.05, 'quarterly recurring', false),
  ('wasps',       'standard', 229.00, 0.00, 'single nest removal', false),
  ('rats',        'standard', 299.00, 0.05, 'rodent baiting + entry seal', false),
  ('rats',        'plus',     599.00, 0.08, 'monitoring + follow-ups', false),
  ('termites',    'specialist', 0.00, 0.00, 'inspection required', true),
  ('bed bugs',    'specialist', 0.00, 0.00, 'inspection required', true),
  ('wildlife',    'specialist', 0.00, 0.00, 'inspection required', true)
on conflict (pest_type, service_tier) do nothing;

-- ============ 0002_nudge.sql ============
-- Track whether we've already sent a re-engagement nudge for the current
-- silence window. Cleared back to NULL the moment the customer replies.
alter table conversations
  add column if not exists nudged_at timestamptz;

create index if not exists conversations_nudge_idx
  on conversations (last_message_at)
  where nudged_at is null;

-- ============ 0002_profiles_and_rls.sql ============
-- PestLLM Phase 1: profiles, role gating, assigned technician, RLS on every table.
-- Service role bypasses RLS so the existing webhook + cron paths remain functional.

-- 1. profiles ----------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'technician' check (role in ('admin','technician')),
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row for every new auth user. Default role is 'technician';
-- promote to admin manually via Supabase Studio: update profiles set role='admin' where id=...
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. appointments: assigned technician --------------------------------------

alter table appointments
  add column if not exists assigned_technician_id uuid references auth.users(id) on delete set null;

create index if not exists appointments_assigned_tech_idx
  on appointments (assigned_technician_id) where assigned_technician_id is not null;

-- 3. is_admin() helper ------------------------------------------------------

create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

-- 4. Enable RLS on every table ----------------------------------------------

alter table profiles      enable row level security;
alter table customers     enable row level security;
alter table conversations enable row level security;
alter table appointments  enable row level security;
alter table pricing       enable row level security;
alter table escalations   enable row level security;

-- 5. Policies ---------------------------------------------------------------
-- Service role bypasses RLS automatically; these policies cover authenticated browser clients.

-- profiles: self-read; admins read+update everyone
drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin(auth.uid()));

drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles
  for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- customers: admins full; techs read only customers tied to their appointments
drop policy if exists customers_admin_all on customers;
create policy customers_admin_all on customers
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists customers_tech_select on customers;
create policy customers_tech_select on customers
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = customers.id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- conversations: admins full; techs read only conversations for their customers
drop policy if exists conversations_admin_all on conversations;
create policy conversations_admin_all on conversations
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists conversations_tech_select on conversations;
create policy conversations_tech_select on conversations
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = conversations.customer_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- appointments: admins full; techs read+update only their own assigned jobs
drop policy if exists appointments_admin_all on appointments;
create policy appointments_admin_all on appointments
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists appointments_tech_select on appointments;
create policy appointments_tech_select on appointments
  for select to authenticated
  using (assigned_technician_id = auth.uid());

drop policy if exists appointments_tech_update on appointments;
create policy appointments_tech_update on appointments
  for update to authenticated
  using (assigned_technician_id = auth.uid())
  with check (assigned_technician_id = auth.uid());

-- pricing: admins full; techs read-only
drop policy if exists pricing_admin_all on pricing;
create policy pricing_admin_all on pricing
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists pricing_tech_select on pricing;
create policy pricing_tech_select on pricing
  for select to authenticated
  using (true);

-- escalations: admins full; techs read+update only escalations for their customers
drop policy if exists escalations_admin_all on escalations;
create policy escalations_admin_all on escalations
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists escalations_tech_select on escalations;
create policy escalations_tech_select on escalations
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = escalations.customer_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- 6. Enable Realtime on tables the admin/tech app subscribes to ---------------
-- Supabase Realtime is opt-in per table; tables must be in the
-- supabase_realtime publication for postgres_changes events to fire.

alter publication supabase_realtime add table escalations;
alter publication supabase_realtime add table appointments;

-- ============ 0003_tech_phase.sql ============
-- PestLLM Phase 3: technician PWA schema.
-- Adds tech_notes + completed_at on appointments, an appointment_photos table,
-- and the job-photos Storage bucket with RLS scoped to the assigned technician.

-- 1. appointments: tech-side columns ----------------------------------------

alter table appointments
  add column if not exists tech_notes text,
  add column if not exists completed_at timestamptz;

-- 2. appointment_photos -----------------------------------------------------

create table if not exists appointment_photos (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('before','after','damage','other')),
  taken_at timestamptz not null default now(),
  taken_by uuid references auth.users(id) on delete set null
);

create index if not exists appointment_photos_appointment_idx
  on appointment_photos (appointment_id, taken_at desc);

alter table appointment_photos enable row level security;

-- Admins: full access.
drop policy if exists appointment_photos_admin_all on appointment_photos;
create policy appointment_photos_admin_all on appointment_photos
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Techs: read photos on jobs assigned to them.
drop policy if exists appointment_photos_tech_select on appointment_photos;
create policy appointment_photos_tech_select on appointment_photos
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.id = appointment_photos.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- Techs: insert photos only on jobs assigned to them, and only as themselves.
drop policy if exists appointment_photos_tech_insert on appointment_photos;
create policy appointment_photos_tech_insert on appointment_photos
  for insert to authenticated
  with check (
    taken_by = auth.uid()
    and exists (
      select 1 from appointments a
      where a.id = appointment_photos.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- 3. job-photos Storage bucket ----------------------------------------------
-- Path convention: <appointment_id>/<photo_uuid>.<ext>
-- The first path segment is the appointment id, which lets the RLS policies
-- below resolve the assigned technician without an extra join through the
-- appointment_photos row (which may not exist yet at the moment of upload).

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

drop policy if exists job_photos_admin_all on storage.objects;
create policy job_photos_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos' and is_admin(auth.uid()))
  with check (bucket_id = 'job-photos' and is_admin(auth.uid()));

drop policy if exists job_photos_tech_select on storage.objects;
create policy job_photos_tech_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and exists (
      select 1 from appointments a
      where a.id::text = (storage.foldername(name))[1]
        and a.assigned_technician_id = auth.uid()
    )
  );

drop policy if exists job_photos_tech_insert on storage.objects;
create policy job_photos_tech_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and owner = auth.uid()
    and exists (
      select 1 from appointments a
      where a.id::text = (storage.foldername(name))[1]
        and a.assigned_technician_id = auth.uid()
    )
  );

-- ============ 0004_gps_tracking.sql ============
-- PestLLM Phase 4: GPS tracking — live tech positions, public customer
-- tracking links, and an admin dispatch realtime feed.

-- 1. technician_positions: one row per actively-sharing tech --------------

create table if not exists technician_positions (
  technician_id  uuid primary key references auth.users(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  lat            double precision not null,
  lng            double precision not null,
  accuracy_m     double precision,
  heading        double precision,
  updated_at     timestamptz not null default now()
);

create index if not exists technician_positions_updated_idx
  on technician_positions (updated_at desc);

alter table technician_positions enable row level security;

-- Tech owns their row, full mutability.
drop policy if exists technician_positions_self_all on technician_positions;
create policy technician_positions_self_all on technician_positions
  for all to authenticated
  using (technician_id = auth.uid())
  with check (technician_id = auth.uid());

-- Admin: SELECT all. Inline exists() rather than is_admin() so the Realtime
-- broadcast filter delivers events (function calls silently drop messages —
-- see prior pain on `escalations`/`appointments`).
drop policy if exists technician_positions_admin_select on technician_positions;
create policy technician_positions_admin_select on technician_positions
  for select to authenticated
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- 2. appointment_tracking_tokens: public-facing tokens for customer links --

create table if not exists appointment_tracking_tokens (
  token          uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  created_at     timestamptz not null default now(),
  revoked        boolean not null default false,
  revoked_at     timestamptz
);

-- At most one live token per appointment.
create unique index if not exists appointment_tracking_tokens_live_idx
  on appointment_tracking_tokens (appointment_id) where revoked = false;

alter table appointment_tracking_tokens enable row level security;

-- Tech can manage tokens only for jobs assigned to them.
drop policy if exists appointment_tracking_tokens_tech_select on appointment_tracking_tokens;
create policy appointment_tracking_tokens_tech_select on appointment_tracking_tokens
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

drop policy if exists appointment_tracking_tokens_tech_insert on appointment_tracking_tokens;
create policy appointment_tracking_tokens_tech_insert on appointment_tracking_tokens
  for insert to authenticated
  with check (
    exists (
      
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

drop policy if exists appointment_tracking_tokens_tech_update on appointment_tracking_tokens;
create policy appointment_tracking_tokens_tech_update on appointment_tracking_tokens
  for update to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- Admin: full access. Inline check for the same Realtime reason.
drop policy if exists appointment_tracking_tokens_admin_all on appointment_tracking_tokens;
create policy appointment_tracking_tokens_admin_all on appointment_tracking_tokens
  for all to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- 3. appointments.tracking_state ----------------------------------------------
-- 'en_route' | 'arrived' while status='booked'. Cleared on completion/cancel.

alter table appointments
  add column if not exists tracking_state text
    check (tracking_state in ('en_route','arrived'));

-- 4. customers: cached geocode for the address --------------------------------

alter table customers
  add column if not exists address_lat double precision,
  add column if not exists address_lng double precision;

-- 5. Realtime: dispatch reads technician_positions live. ---------------------
-- Drop + re-add so the broker wakes up and starts broadcasting. The tokens
-- table stays out of the publication — the customer tracking page polls.

do $$
begin
  alter publication supabase_realtime drop table technician_positions;
exception when others then
  null;
end $$;

alter publication supabase_realtime add table technician_positions;

-- ============ 0005_rls_hardening.sql ============
-- PestLLM Phase 5: RLS hardening.
-- Replace the `is_admin(auth.uid())` function calls (or `(true)` workarounds)
-- in admin policies with inline `exists (select 1 from profiles ...)` checks.
--
-- WHY: Supabase Realtime's broadcast filter silently drops events whose RLS
-- policy calls a function. Inline subqueries work; function calls don't. The
-- previous workaround was `using (true)` on admin policies, which is fine for
-- realtime delivery but is a footgun (an authenticated user with no profile
-- row could still pass). The inline-exists pattern is correct and works with
-- the broadcast filter.
--
-- NOT TOUCHED: profiles_self_select / profiles_admin_update.
--   - profiles isn't in the realtime publication, so the broadcast issue
--     doesn't apply.
--   - A subquery `exists (select 1 from profiles where ...)` from inside a
--     profiles policy would trip RLS recursively, since the inner select on
--     profiles itself goes through profiles_self_select. is_admin is
--     security-definer and bypasses RLS, so it's the safer choice here.

-- 1. customers --------------------------------------------------------------

drop policy if exists customers_admin_all on customers;
create policy customers_admin_all on customers
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 2. conversations ----------------------------------------------------------

drop policy if exists conversations_admin_all on conversations;
create policy conversations_admin_all on conversations
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 3. appointments  (realtime-critical) --------------------------------------

drop policy if exists appointments_admin_all on appointments;
create policy appointments_admin_all on appointments
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 4. pricing ----------------------------------------------------------------

drop policy if exists pricing_admin_all on pricing;
create policy pricing_admin_all on pricing
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 5. escalations  (realtime-critical) ---------------------------------------

drop policy if exists escalations_admin_all on escalations;
create policy escalations_admin_all on escalations
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 6. Wake the Realtime broker on the affected tables ------------------------
-- Policy changes can leave the broker holding a stale filter; drop+re-add
-- forces a re-evaluation so admin clients start receiving events again.

do $$
begin
  alter publication supabase_realtime drop table appointments;
exception when others then null;
end $$;
alter publication supabase_realtime add table appointments;

do $$
begin
  alter publication supabase_realtime drop table escalations;
exception when others then null;
end $$;
alter publication supabase_realtime add table escalations;

-- ============ 0006_tech_column_guard.sql ============
-- PestLLM Phase 5: column-level guard for technician updates to appointments.
--
-- WHY: appointments_tech_update RLS lets a tech UPDATE any column on a job
-- assigned to them (the policy is row-level, not column-level). The Server
-- Actions in app/(tech)/tech/jobs/[id]/actions.ts only touch a safe subset
-- (status, tech_notes, completed_at, tracking_state), but a tech with the
-- anon key and their JWT could call Supabase directly and rewrite pricing,
-- slot times, the linked customer, etc. This trigger enforces the column
-- allowlist at the database level so the policy and the UI are no longer
-- the sole defense.
--
-- NOT ENFORCED: admins (full access) and service-role calls (webhook, cron,
-- public tracking API). Both bypass the column check.

create or replace function appointments_tech_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  uid_role text;
begin
  -- Service role calls have a null auth.uid() — let them through.
  if uid is null then
    return new;
  end if;

  select role into uid_role from profiles where id = uid;

  -- Admins (and anyone who isn't a tech, defensively) bypass column locks.
  if uid_role is distinct from 'technician' then
    return new;
  end if;

  -- Tech path: every column outside the allowlist must be unchanged.
  if new.customer_id            is distinct from old.customer_id
     or new.confirmation_code   is distinct from old.confirmation_code
     or new.pest_type           is distinct from old.pest_type
     or new.service_tier        is distinct from old.service_tier
     or new.slot_start          is distinct from old.slot_start
     or new.slot_end            is distinct from old.slot_end
     or new.price_quoted        is distinct from old.price_quoted
     or new.assigned_technician_id is distinct from old.assigned_technician_id
     or new.created_at          is distinct from old.created_at
  then
    raise exception
      'Technicians can only update status, tech_notes, completed_at, tracking_state on their own appointments'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_tech_column_guard_trg on appointments;
create trigger appointments_tech_column_guard_trg
  before update on appointments
  for each row execute function appointments_tech_column_guard();

-- ============ 0007_opt_out.sql ============
-- PestLLM: DPDP Act opt-out. Customers can reply STOP to stop proactive outreach
-- (re-engagement nudges, future marketing/review requests). Inbound messages are
-- still answered — replying to someone who messaged you isn't unsolicited.

alter table customers
  add column if not exists opted_out boolean not null default false,
  add column if not exists opted_out_at timestamptz;

-- ============ 0008_amc.sql ============
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

-- ============ 0009_deployment_tier.sql ============
-- PestLLM Phase tier-gating: single-row deployment_settings table.
-- Each Supabase project belongs to exactly one client deployment, so a singleton
-- row (id pinned to 1) is the natural shape. Flip `tier` to expose tier-3 features
-- (KPI dashboard) in the admin console.

create table if not exists deployment_settings (
  id int primary key default 1 check (id = 1),
  tier text not null default 'tier2' check (tier in ('tier2','tier3')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into deployment_settings (id) values (1) on conflict (id) do nothing;

alter table deployment_settings enable row level security;

drop policy if exists deployment_settings_admin_write on deployment_settings;
create policy deployment_settings_admin_write on deployment_settings
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Techs need to read it so future tier-gated tech features can branch on it.
-- The value isn't a secret.
drop policy if exists deployment_settings_authed_select on deployment_settings;
create policy deployment_settings_authed_select on deployment_settings
  for select to authenticated
  using (true);

-- ============ 0010_db_refinement.sql ============
-- PestLLM: database refinement — FK covering indexes, KPI query indexes,
-- a DB-level double-booking guard, and data-integrity check constraints.
-- No schema shape changes (no new columns/tables), so lib/supabase/types.ts
-- and application code are unaffected. Everything here is idempotent.

-- 1. FK covering indexes ------------------------------------------------------
-- Postgres does not auto-index FK columns. These cover the joins the app makes
-- constantly (tech RLS policies all join appointments by customer_id) and the
-- cascade/set-null paths on customer/appointment deletion (DPDP Act erasure).

create index if not exists appointments_customer_idx
  on appointments (customer_id);

create index if not exists escalations_customer_idx
  on escalations (customer_id);

create index if not exists appointment_tracking_tokens_appointment_idx
  on appointment_tracking_tokens (appointment_id);

create index if not exists appointment_photos_taken_by_idx
  on appointment_photos (taken_by);

create index if not exists technician_positions_appointment_idx
  on technician_positions (appointment_id);

-- 2. KPI / cron query indexes -------------------------------------------------
-- lib/kpi/queries.ts filters completed jobs by completed_at, funnel sections by
-- created_at, and operational sections by slot_start across ALL statuses. The
-- only slot index so far was partial on status='booked'.

create index if not exists appointments_completed_at_idx
  on appointments (completed_at desc) where status = 'completed';

create index if not exists appointments_created_at_idx
  on appointments (created_at);

create index if not exists appointments_slot_all_idx
  on appointments (slot_start);

create index if not exists escalations_created_at_idx
  on escalations (created_at);

create index if not exists customers_created_at_idx
  on customers (created_at);

-- 3. Double-booking guard -----------------------------------------------------
-- check_availability treats a slot as taken when ANY booked appointment starts
-- at that instant — i.e. the business rule is one booking per slot, globally.
-- Until now only the application enforced it, leaving a check-then-insert race:
-- two concurrent create_appointment calls for the same slot both pass
-- check_availability and both insert. This unique partial index closes that
-- race at the database; the losing insert gets a 23505 and the agent re-offers.
--
-- If this CREATE fails on an existing deployment, you have real double-bookings
-- to resolve first:
--   select slot_start, count(*) from appointments
--   where status = 'booked' group by 1 having count(*) > 1;

create unique index if not exists appointments_booked_slot_unique_idx
  on appointments (slot_start) where status = 'booked';

-- Superseded by the unique index above (same column, same predicate).
drop index if exists appointments_slot_idx;

-- 4. Data-integrity check constraints ------------------------------------------
-- Cheap invariants the app already assumes. Guarded for idempotency; if one
-- fails to ADD because existing rows violate it, fix the data — don't drop the
-- constraint.

do $$ begin
  alter table appointments
    add constraint appointments_slot_order_chk check (slot_end > slot_start);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table pricing
    add constraint pricing_nonnegative_chk check (base_price >= 0 and per_sqft >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table amc
    add constraint amc_date_order_chk check (renews_at >= commenced_at);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table amc
    add constraint amc_nonnegative_chk
    check (lead_days >= 0 and (annual_price is null or annual_price >= 0));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table technician_positions
    add constraint technician_positions_bounds_chk
    check (lat between -90 and 90 and lng between -180 and 180);
exception when duplicate_object then null;
end $$;

-- 5. Deliberately NOT changed ---------------------------------------------------
-- * profiles policies still use is_admin(): inline exists() on profiles from a
--   profiles policy recurses through RLS; the security-definer function is the
--   correct shape there (documented in 0005).
-- * pricing_tech_select stays using (true): pricing is not secret and the
--   broader read grant is harmless.
-- * No per-technician slot-overlap exclusion constraint: capacity is enforced
--   globally per slot (section 3); auto-assign (lib/auto-assign.ts) may
--   legitimately stack a tech's day, and an exclusion constraint would fight
--   the admin's manual override.
-- * No updated_at/touch triggers: nothing in the app reads them yet; add them
--   together with the feature that needs them.

-- ============ 0011_human_takeover.sql ============
-- PestLLM: human takeover / shared team inbox.
-- Lets an admin pause the AI on a single conversation, reply into the live
-- WhatsApp thread from the console, and resume the AI. Everything here is
-- idempotent.

-- 1. Takeover state on conversations -----------------------------------------
-- agent_paused gates the webhook: while true, inbound customer messages are
-- recorded but runAgent() is NOT called (see app/api/whatsapp/webhook/route.ts).
-- paused_by / paused_at are for attribution and display in the console.

alter table conversations
  add column if not exists agent_paused boolean not null default false;

alter table conversations
  add column if not exists paused_by uuid references auth.users(id) on delete set null;

alter table conversations
  add column if not exists paused_at timestamptz;

-- 2. Realtime ----------------------------------------------------------------
-- The conversations inbox subscribes to postgres_changes so inbound messages
-- and other admins' pause/resume/reply actions appear live (same pattern as
-- escalations + appointments in 0002). Realtime is opt-in per table; guard the
-- add so re-running the migration doesn't error if it's already published.

do $$ begin
  alter publication supabase_realtime add table conversations;
exception when duplicate_object then null;
end $$;

-- 3. Deliberately NOT changed -------------------------------------------------
-- * No RLS change: conversations already has conversations_admin_all (0002),
--   which grants admins full select/update — exactly what the inbox needs. The
--   service-role webhook/cron paths bypass RLS as before.
-- * No per-message author column: staff replies are stored in state_json as
--   ordinary assistant turns so the AI's context stays coherent when the agent
--   resumes. Attribution lives at the conversation level (paused_by). Adding a
--   shadow messages table purely to label "staff vs AI" isn't worth it yet.

-- ============ 0011_webhook_dedup_and_reminders.sql ============
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

-- ============ 0012_abandoned_recovery.sql ============
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

-- ============ 0013_campaigns.sql ============
-- PestLLM: broadcast campaigns with segmentation.
-- Admin composes an approved-template send over a customer segment (area /
-- pest history / last-visit age / AMC status); a cron drains recipients in
-- batches so thousands of sends never fight a single request's time budget.
-- Everything here is idempotent.

-- 1. campaigns ----------------------------------------------------------------

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_name text not null,
  -- Positional {{n}} body params for the approved template. The literal token
  -- {name} inside a param is replaced with the recipient's first name at send
  -- time (app/api/cron/campaign-dispatch/route.ts).
  template_params jsonb not null default '[]'::jsonb,
  -- SegmentSpec (lib/campaigns/segment.ts) that produced the recipient snapshot;
  -- stored for display/audit. Recipients are snapshotted at creation, so later
  -- customer changes don't mutate a launched campaign.
  segment jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','sending','done')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  launched_at timestamptz,
  completed_at timestamptz
);

-- 2. campaign_recipients --------------------------------------------------------

create table if not exists campaign_recipients (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sent','skipped','failed')),
  -- skip reason / send error for the campaign detail view
  detail text,
  sent_at timestamptz,
  primary key (campaign_id, customer_id)
);

-- The dispatch cron's access path: queued rows for a sending campaign.
create index if not exists campaign_recipients_status_idx
  on campaign_recipients (campaign_id, status);

-- FK covering index for the cascade path on customer deletion (DPDP erasure).
create index if not exists campaign_recipients_customer_idx
  on campaign_recipients (customer_id);

-- 3. RLS ------------------------------------------------------------------------
-- Admin-only in the console; the dispatch cron uses the service role (bypasses
-- RLS). Technicians have no business reading marketing state.

alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;

drop policy if exists campaigns_admin_all on campaigns;
create policy campaigns_admin_all on campaigns
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists campaign_recipients_admin_all on campaign_recipients;
create policy campaign_recipients_admin_all on campaign_recipients
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- 4. Deliberately NOT changed ---------------------------------------------------
-- * No sent/skipped/failed counter columns on campaigns: counts are derived
--   from campaign_recipients at read time, so they can never drift from the
--   per-recipient truth. Denormalize only if the recipients table grows past
--   what a grouped count handles comfortably.
-- * No Realtime publication: campaign progress is polled by page refresh; the
--   dispatch cadence (minutes) doesn't warrant a live stream.
-- * Opt-out is NOT filtered here: the dispatch cron sends via
--   sendTemplateToCustomer with kind='promotional', so the opt-out gate is
--   enforced at send time (recipients get status='skipped'), and the segment
--   builder additionally excludes opted-out customers for honest previews.

-- ============ 0014_feedback.sql ============
-- PestLLM: post-visit CSAT feedback.
-- After a technician marks a job complete, the customer is asked to rate the
-- visit (WhatsApp Flow when one is published, else a plain 1-5 reply). Ratings
-- land here; 4+ gets a Google-review nudge. Everything here is idempotent.

-- 1. feedback -------------------------------------------------------------------

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  -- One rating per job: a re-submitted flow or repeated "5" reply must not
  -- stack rows (the insert conflicts and the webhook treats it as done).
  unique (appointment_id)
);

create index if not exists feedback_customer_idx on feedback (customer_id);
create index if not exists feedback_created_at_idx on feedback (created_at);

-- 2. CSAT request marker on appointments ------------------------------------------

-- Set when the rating ask actually went out. Doubles as idempotency (ask once)
-- and as the attribution window for bare-number replies: a lone "4" from the
-- customer only counts as a rating while a recent request is outstanding.
alter table appointments
  add column if not exists csat_requested_at timestamptz;

-- 3. RLS ---------------------------------------------------------------------------

alter table feedback enable row level security;

-- Admin read for the KPI feedback strip. Writes come from the webhook via the
-- service role (bypasses RLS) — no authenticated insert path is needed.
drop policy if exists feedback_admin_select on feedback;
create policy feedback_admin_select on feedback
  for select to authenticated
  using (is_admin(auth.uid()));

-- 4. Deliberately NOT changed -------------------------------------------------------
-- * No tech policies: technicians see their job outcomes in person; rating
--   visibility is a management concern.
-- * No Realtime publication: feedback is reviewed in aggregate, not triaged live.

-- ============ 0015_payments.sql ============
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

-- ============ 0016_remove_tier.sql ============
-- PestLLM: remove deployment-tier gating.
-- The tier2/tier3 packaging concept is retired for now: every deployment gets
-- every feature (the KPI dashboard is no longer gated, the settings page and
-- lib/tier.ts are gone). Dropping the singleton table removes the last trace.
-- Idempotent.

drop table if exists deployment_settings;

-- Deliberately NOT changed ----------------------------------------------------
-- * is_admin() and all role RLS stay: admin/technician is access control, not
--   product packaging.
-- * Service tiers on appointments/pricing (standard/plus/specialist) stay:
--   they are service levels the customer books, unrelated to deployment tiers.
-- * If tiered packaging returns, re-run 0009 — it is itself idempotent.

-- ============ 0017_crm.sql ============
-- PestLLM: CRM columns on customers — tags + click-to-WhatsApp ad attribution.
-- Powers the /admin/customers surface, the campaign `tag` segment filter, and
-- the "Lead sources" KPI strip. Everything here is idempotent.

-- 1. Tags ----------------------------------------------------------------------
-- Free-form labels admins put on customers ("vip", "society-block-A", "hindi").
-- Campaign segmentation filters on them with @> containment, hence the GIN.

alter table customers
  add column if not exists tags text[] not null default '{}';

create index if not exists customers_tags_idx on customers using gin (tags);

-- 2. Acquisition (click-to-WhatsApp ads) ----------------------------------------
-- Meta attaches a `referral` object to inbound messages that came from an ad.
-- The webhook stamps it here FIRST-TOUCH ONLY: the source that actually
-- acquired the customer is never overwritten by later ad clicks.
-- Shape: { source_type, source_id, source_url, headline } (all nullable).

alter table customers
  add column if not exists acquisition jsonb;

alter table customers
  add column if not exists acquired_at timestamptz;

-- 3. Deliberately NOT changed ----------------------------------------------------
-- * No customers RLS change: customers_admin_all (0002) already covers the new
--   columns for the console; the webhook writes via the service role.
-- * No separate tags table: text[] + GIN is plenty at this scale, and keeps
--   tag editing a single-column update. Revisit if tags ever need metadata.
-- * No index on acquisition: the KPI groups a range-bounded fetch in memory
--   (same approach as computeAreaDistribution).

-- ============ 0018_sla_events.sql ============
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

-- ============ 0019_journeys.sql ============
-- PestLLM: journeys — admin-composable automation sequences.
-- A journey is: trigger event → wait N days → send approved template → wait →
-- send… Enrollment and advancement run in /api/cron/journeys. Everything here
-- is idempotent.

-- 1. journeys -------------------------------------------------------------------

create table if not exists journeys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger text not null check (trigger in ('job_completed','customer_created')),
  -- Disabled journeys neither enroll nor advance. New journeys start disabled
  -- so a half-composed sequence can't fire.
  enabled boolean not null default false,
  -- Enrollment watermark: only trigger events AFTER this instant enroll, so
  -- enabling a journey doesn't blast the entire historical customer base.
  enabled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2. journey_steps ---------------------------------------------------------------
-- Steps are TEMPLATE-ONLY by design: delayed sends are almost always outside
-- Meta's 24h service window, where free-form text is rejected (131047). The
-- {name} token in a param becomes the recipient's first name at send time
-- (same substitution as campaigns).

create table if not exists journey_steps (
  journey_id uuid not null references journeys(id) on delete cascade,
  position int not null check (position >= 1),
  delay_days int not null default 0 check (delay_days >= 0 and delay_days <= 365),
  template_name text not null,
  template_params jsonb not null default '[]'::jsonb,
  primary key (journey_id, position)
);

-- 3. journey_enrollments ----------------------------------------------------------

create table if not exists journey_enrollments (
  journey_id uuid not null references journeys(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  -- The event instance that caused enrollment (appointment id for
  -- job_completed; the customer id itself for customer_created). Part of the
  -- PK so completing a second job can re-enroll, but the SAME job can't
  -- double-enroll on cron re-runs.
  trigger_ref uuid not null,
  current_position int not null default 1,
  next_run_at timestamptz not null,
  status text not null default 'active' check (status in ('active','done','cancelled')),
  enrolled_at timestamptz not null default now(),
  primary key (journey_id, customer_id, trigger_ref)
);

-- The advance pass's access path: due active enrollments.
create index if not exists journey_enrollments_due_idx
  on journey_enrollments (status, next_run_at);

-- FK covering index for the cascade path on customer deletion (DPDP erasure).
create index if not exists journey_enrollments_customer_idx
  on journey_enrollments (customer_id);

-- 4. RLS ---------------------------------------------------------------------------
-- Admin-only in the console; the cron uses the service role (bypasses RLS).

alter table journeys enable row level security;
alter table journey_steps enable row level security;
alter table journey_enrollments enable row level security;

drop policy if exists journeys_admin_all on journeys;
create policy journeys_admin_all on journeys
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists journey_steps_admin_all on journey_steps;
create policy journey_steps_admin_all on journey_steps
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists journey_enrollments_admin_all on journey_enrollments;
create policy journey_enrollments_admin_all on journey_enrollments
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- 5. Deliberately NOT changed -------------------------------------------------------
-- * The AMC cron and the CSAT ask stay hardcoded: they carry business logic
--   (idempotency markers, price context, rating attribution) a generic
--   step-runner shouldn't reimplement. Journeys are for ADDITIONAL
--   client-specific sequences (30-day check-in, win-back, seasonal tips).
-- * No free-text step kind: see the template-only note on journey_steps.
-- * No per-step send log: enrollment status + current_position is enough to
--   resume; campaign_recipients-style bookkeeping can come with reporting.

-- ============ 0020_remove_service_tiers.sql ============
-- PestLLM: remove service tiers (standard/plus/specialist) — flat service.
-- One price per pest, one visit duration (90 min, in code). The
-- requires_inspection flag on pricing stays: it's how the business quotes
-- termites/bed bugs, independent of tiers. Idempotent.

-- 1. Collapse pricing to one row per pest ---------------------------------------
-- Keep the 'standard' row when the pest has one (the base offering), otherwise
-- the cheapest row (ties broken by id). Guarded: only runs while the
-- service_tier column still exists.

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'pricing' and column_name = 'service_tier'
  ) then
    delete from pricing p
    where exists (
      select 1 from pricing q
      where q.pest_type = p.pest_type
        and q.id <> p.id
        and (
          (q.service_tier = 'standard' and p.service_tier <> 'standard')
          or (
            q.service_tier <> 'standard'
            and p.service_tier <> 'standard'
            and (q.base_price < p.base_price
                 or (q.base_price = p.base_price and q.id < p.id))
          )
        )
    );
  end if;
end $$;

alter table pricing drop constraint if exists pricing_pest_type_service_tier_key;
alter table pricing drop column if exists service_tier;

create unique index if not exists pricing_pest_type_unique_idx
  on pricing (pest_type);

-- 2. Appointments lose their tier -----------------------------------------------
-- Historical bookings keep everything else (pest, slot, price_quoted); the
-- tier label carried no billing truth (price_quoted was never derived from it).

alter table appointments drop constraint if exists appointments_service_tier_check;
alter table appointments drop column if exists service_tier;

-- 3. Deliberately NOT changed -----------------------------------------------------
-- * requires_inspection stays on pricing: inspection-first quoting is a real
--   business rule, not a tier.
-- * per_sqft stays: property size still scales the estimate.
-- * The slot model (3 windows/day, one booking per slot globally, 0010's
--   unique index) is untouched — duration is now a single code constant.
-- * AMC is untouched: annual contracts were never tiered.

-- ============ 0021_mcq_flows.sql ============
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
