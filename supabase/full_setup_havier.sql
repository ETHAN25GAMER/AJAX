-- =============================================================
-- Havier Pest Control — FULL SETUP (schema + seed)
--
-- ⚠️  DEPRECATED SNAPSHOT — do not use for new deployments.
-- This file predates migrations 0011–0020 (human takeover, recovery,
-- campaigns, feedback, payments, tier removal, CRM, SLA events,
-- journeys, service-tier removal) and would bootstrap an outdated
-- schema (including the removed service_tier columns).
-- Instead: run supabase/setup_full.sql (one file, generated from
-- all migrations in order), then supabase/seed_havier.sql.
-- =============================================================


-- -------------------------------------------------------------
-- MIGRATION 0001: initial schema
-- -------------------------------------------------------------
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


-- -------------------------------------------------------------
-- MIGRATION 0002a: nudge column
-- -------------------------------------------------------------
alter table conversations
  add column if not exists nudged_at timestamptz;

create index if not exists conversations_nudge_idx
  on conversations (last_message_at)
  where nudged_at is null;


-- -------------------------------------------------------------
-- MIGRATION 0002b: profiles + RLS
-- -------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'technician' check (role in ('admin','technician')),
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

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

alter table appointments
  add column if not exists assigned_technician_id uuid references auth.users(id) on delete set null;

create index if not exists appointments_assigned_tech_idx
  on appointments (assigned_technician_id) where assigned_technician_id is not null;

create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

alter table profiles      enable row level security;
alter table customers     enable row level security;
alter table conversations enable row level security;
alter table appointments  enable row level security;
alter table pricing       enable row level security;
alter table escalations   enable row level security;

drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin(auth.uid()));

drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles
  for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

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

drop policy if exists pricing_admin_all on pricing;
create policy pricing_admin_all on pricing
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists pricing_tech_select on pricing;
create policy pricing_tech_select on pricing
  for select to authenticated
  using (true);

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

do $$ begin
  alter publication supabase_realtime add table escalations;
exception when others then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table appointments;
exception when others then null;
end $$;


-- -------------------------------------------------------------
-- MIGRATION 0003: technician PWA — photos, storage bucket
-- -------------------------------------------------------------
alter table appointments
  add column if not exists tech_notes text,
  add column if not exists completed_at timestamptz;

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

drop policy if exists appointment_photos_admin_all on appointment_photos;
create policy appointment_photos_admin_all on appointment_photos
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

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


-- -------------------------------------------------------------
-- MIGRATION 0004: GPS tracking
-- -------------------------------------------------------------
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

drop policy if exists technician_positions_self_all on technician_positions;
create policy technician_positions_self_all on technician_positions
  for all to authenticated
  using (technician_id = auth.uid())
  with check (technician_id = auth.uid());

drop policy if exists technician_positions_admin_select on technician_positions;
create policy technician_positions_admin_select on technician_positions
  for select to authenticated
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create table if not exists appointment_tracking_tokens (
  token          uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  created_at     timestamptz not null default now(),
  revoked        boolean not null default false,
  revoked_at     timestamptz
);

create unique index if not exists appointment_tracking_tokens_live_idx
  on appointment_tracking_tokens (appointment_id) where revoked = false;

alter table appointment_tracking_tokens enable row level security;

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

drop policy if exists appointment_tracking_tokens_admin_all on appointment_tracking_tokens;
create policy appointment_tracking_tokens_admin_all on appointment_tracking_tokens
  for all to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

alter table appointments
  add column if not exists tracking_state text
    check (tracking_state in ('en_route','arrived'));

alter table customers
  add column if not exists address_lat double precision,
  add column if not exists address_lng double precision;

do $$
begin
  alter publication supabase_realtime drop table technician_positions;
exception when others then
  null;
end $$;
alter publication supabase_realtime add table technician_positions;


-- -------------------------------------------------------------
-- MIGRATION 0005: RLS hardening (inline exists instead of is_admin())
-- -------------------------------------------------------------
drop policy if exists customers_admin_all on customers;
create policy customers_admin_all on customers
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists conversations_admin_all on conversations;
create policy conversations_admin_all on conversations
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists appointments_admin_all on appointments;
create policy appointments_admin_all on appointments
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists pricing_admin_all on pricing;
create policy pricing_admin_all on pricing
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists escalations_admin_all on escalations;
create policy escalations_admin_all on escalations
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

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


-- -------------------------------------------------------------
-- MIGRATION 0006: technician column guard trigger
-- -------------------------------------------------------------
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
  if uid is null then
    return new;
  end if;
  select role into uid_role from profiles where id = uid;
  if uid_role is distinct from 'technician' then
    return new;
  end if;
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
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_tech_column_guard_trg on appointments;
create trigger appointments_tech_column_guard_trg
  before update on appointments
  for each row execute function appointments_tech_column_guard();


-- -------------------------------------------------------------
-- MIGRATION 0007: opt-out columns
-- -------------------------------------------------------------
alter table customers
  add column if not exists opted_out boolean not null default false,
  add column if not exists opted_out_at timestamptz;


-- -------------------------------------------------------------
-- MIGRATION 0008: AMC table
-- -------------------------------------------------------------
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

create index if not exists amc_active_renews_idx
  on amc (renews_at) where status = 'active';

alter table amc enable row level security;

drop policy if exists amc_admin_all on amc;
create policy amc_admin_all on amc
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

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

alter table customers
  add column if not exists amc_pitched_at timestamptz;


-- -------------------------------------------------------------
-- MIGRATION 0009: deployment tier
-- -------------------------------------------------------------
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

drop policy if exists deployment_settings_authed_select on deployment_settings;
create policy deployment_settings_authed_select on deployment_settings
  for select to authenticated
  using (true);


-- -------------------------------------------------------------
-- MIGRATION 0010: indexes + constraints
-- -------------------------------------------------------------
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

create unique index if not exists appointments_booked_slot_unique_idx
  on appointments (slot_start) where status = 'booked';

drop index if exists appointments_slot_idx;

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


-- =============================================================
-- SEED: Havier Pest Control beta data
-- =============================================================

-- Pricing (INR, inclusive of 18% GST)
insert into pricing (pest_type, service_tier, base_price, per_sqft, notes, requires_inspection)
values
  ('cockroaches', 'standard',  1800.00, 0.50,
   'Gel bait + residual spray, 1 visit, 30-day free re-treatment guarantee', false),
  ('cockroaches', 'plus',      2400.00, 0.80,
   'Monthly treatment plan, scheduled visits year-round, free callbacks', false),
  ('cockroaches', 'specialist',4500.00, 1.50,
   'Severe infestation — multi-product protocol, flush-out + IGR, 30-day guarantee', false),
  ('rats',        'standard',  2200.00, 0.80,
   'Rodent bait stations + entry-point sealing, 30-day guarantee', false),
  ('rats',        'plus',      3600.00, 1.20,
   'Monthly monitoring visits + follow-up, 12 visits/year', false),
  ('rats',        'specialist',   0.00, 0.00,
   'Structural infestation with gnaw damage — on-site inspection required', true),
  ('lizards',     'standard',  1000.00, 0.25,
   'Repellent spray + adhesive gel barriers, 30-day guarantee', false),
  ('lizards',     'plus',      1800.00, 0.40,
   'Quarterly treatment, 4 visits/year, free callbacks', false),
  ('termites',    'standard',     0.00, 0.00,
   'On-site inspection required before quote', true),
  ('termites',    'plus',         0.00, 0.00,
   'On-site inspection required before quote', true),
  ('termites',    'specialist',   0.00, 0.00,
   'Soil injection / borer treatment — on-site inspection required', true)
on conflict (pest_type, service_tier) do update
  set base_price          = excluded.base_price,
      per_sqft            = excluded.per_sqft,
      notes               = excluded.notes,
      requires_inspection = excluded.requires_inspection;

-- 8 AMC customers
insert into customers (phone, name, address, notes) values
  ('919876543201', 'Ananya Sharma',  '14B Rustom Baug, Marine Lines, Mumbai 400002',    'Beta customer — cockroach AMC'),
  ('918765432102', 'Rajesh Gupta',   '22 Churchgate Mansion, Churchgate, Mumbai 400020','Beta customer — rat AMC'),
  ('917654321203', 'Priya Mehta',    '8 Khalsa Niwas, Grant Road, Mumbai 400007',       'Beta customer — lizard AMC'),
  ('916543210304', 'Vikram Sharma',  '31 Nirmala Niwas, Marine Lines, Mumbai 400002',   'Beta customer — cockroach AMC'),
  ('919123456505', 'Kavya Nair',     '5 Nair Building, CST Road, Mumbai 400001',        'Beta customer — termite AMC'),
  ('918234567606', 'Arjun Desai',    '17 Desai Mansion, Charni Road, Mumbai 400004',    'Beta customer — cockroach AMC'),
  ('917345678707', 'Sunita Joshi',   '9 Joshi Bhavan, Girgaon, Mumbai 400004',          'Beta customer — rat AMC'),
  ('916456789808', 'Mohammed Khan',  '3 Khan Terrace, Marine Lines, Mumbai 400002',     'Beta customer — lizard AMC')
on conflict (phone) do nothing;

-- AMC contracts (monthly billing, lead_days=7)
insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-01-15', '2026-07-15', 7, 'cockroaches', 800.00, 'active', 'Monthly billing — ₹800/month; commenced Jan 2026'
from customers c where c.phone = '919876543201'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-02-01', '2026-07-01', 7, 'rats', 1200.00, 'active', 'Monthly billing — ₹1,200/month; commenced Feb 2026'
from customers c where c.phone = '918765432102'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-02-20', '2026-07-20', 7, 'lizards', 600.00, 'active', 'Monthly billing — ₹600/month; commenced Feb 2026'
from customers c where c.phone = '917654321203'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-03-05', '2026-07-05', 7, 'cockroaches', 800.00, 'active', 'Monthly billing — ₹800/month; commenced Mar 2026'
from customers c where c.phone = '916543210304'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-03-15', '2026-07-15', 7, 'termites', 2000.00, 'active', 'Monthly billing — ₹2,000/month; commenced Mar 2026'
from customers c where c.phone = '919123456505'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-04-01', '2026-07-01', 7, 'cockroaches', 800.00, 'active', 'Monthly billing — ₹800/month; commenced Apr 2026'
from customers c where c.phone = '918234567606'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-04-22', '2026-07-22', 7, 'rats', 1200.00, 'active', 'Monthly billing — ₹1,200/month; commenced Apr 2026'
from customers c where c.phone = '917345678707'
on conflict (customer_id) do nothing;

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-05-10', '2026-07-10', 7, 'lizards', 600.00, 'active', 'Monthly billing — ₹600/month; commenced May 2026'
from customers c where c.phone = '916456789808'
on conflict (customer_id) do nothing;

-- =============================================================
-- Done. After running this:
-- 1. Invite Nirvan (nirvanfernandes17@gmail.com) from Admin → Users
-- 2. Invite Sourav (his email) from Admin → Users
-- 3. After they log in, run supabase/setup_technicians.sql
-- 4. Promote your admin user: UPDATE profiles SET role='admin' WHERE id='<uid>';
-- =============================================================
