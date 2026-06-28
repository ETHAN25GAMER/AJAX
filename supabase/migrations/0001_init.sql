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
