-- =============================================================
-- Havier Pest Control — Beta Test Seed
-- Run this in Supabase SQL Editor to get a clean slate.
--
-- IMPORTANT: This truncates ALL application data.
-- Auth users (profiles/technicians) must be re-invited through
-- the Admin → Users page after running this script.
-- =============================================================

-- -------------------------------------------------------------
-- STEP 1: Clear all application data (dependency order)
-- -------------------------------------------------------------
truncate table amc                  cascade;
truncate table escalations          cascade;
truncate table appointment_tracking_tokens cascade;
truncate table technician_positions cascade;
truncate table appointments         cascade;
truncate table conversations        cascade;
truncate table customers            cascade;
truncate table pricing              cascade;

-- Reset deployment tier to tier2 (default)
update deployment_settings set tier = 'tier2' where id = 1;

-- -------------------------------------------------------------
-- STEP 2: Pricing (INR, inclusive of 18% GST)
-- Property size reference used by the tool:
--   Small   ≈  650 sqft (1BHK)
--   Medium  ≈ 1100 sqft (2–3BHK)
--   Large   ≈ 2000 sqft (4BHK / commercial)
-- -------------------------------------------------------------
insert into pricing (pest_type, service_tier, base_price, per_sqft, notes, requires_inspection)
values
  -- Cockroaches
  ('cockroaches', 'standard',  1800.00, 0.50,
   'Gel bait + residual spray, 1 visit, 30-day free re-treatment guarantee', false),
  ('cockroaches', 'plus',      2400.00, 0.80,
   'Monthly treatment plan, scheduled visits year-round, free callbacks', false),
  ('cockroaches', 'specialist',4500.00, 1.50,
   'Severe infestation — multi-product protocol, flush-out + IGR, 30-day guarantee', false),

  -- Rats
  ('rats',        'standard',  2200.00, 0.80,
   'Rodent bait stations + entry-point sealing, 30-day guarantee', false),
  ('rats',        'plus',      3600.00, 1.20,
   'Monthly monitoring visits + follow-up, 12 visits/year', false),
  ('rats',        'specialist',   0.00, 0.00,
   'Structural infestation with gnaw damage — on-site inspection required', true),

  -- Lizards
  ('lizards',     'standard',  1000.00, 0.25,
   'Repellent spray + adhesive gel barriers, 30-day guarantee', false),
  ('lizards',     'plus',      1800.00, 0.40,
   'Quarterly treatment, 4 visits/year, free callbacks', false),

  -- Termites (always inspection-required)
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

-- -------------------------------------------------------------
-- STEP 3: Eight AMC customers (fake beta data)
-- Monthly AMC — annual_price column stores the monthly rate;
-- notes field records billing cycle for clarity.
-- lead_days = 7 (1-week notice before monthly renewal)
-- -------------------------------------------------------------
insert into customers (phone, name, address, notes) values
  ('919876543201', 'Ananya Sharma',
   '14B Rustom Baug, Marine Lines, Mumbai 400002',
   'Beta customer — cockroach AMC'),
  ('918765432102', 'Rajesh Gupta',
   '22 Churchgate Mansion, Churchgate, Mumbai 400020',
   'Beta customer — rat AMC'),
  ('917654321203', 'Priya Mehta',
   '8 Khalsa Niwas, Grant Road, Mumbai 400007',
   'Beta customer — lizard AMC'),
  ('916543210304', 'Vikram Sharma',
   '31 Nirmala Niwas, Marine Lines, Mumbai 400002',
   'Beta customer — cockroach AMC'),
  ('919123456505', 'Kavya Nair',
   '5 Nair Building, CST Road, Mumbai 400001',
   'Beta customer — termite AMC'),
  ('918234567606', 'Arjun Desai',
   '17 Desai Mansion, Charni Road, Mumbai 400004',
   'Beta customer — cockroach AMC'),
  ('917345678707', 'Sunita Joshi',
   '9 Joshi Bhavan, Girgaon, Mumbai 400004',
   'Beta customer — rat AMC'),
  ('916456789808', 'Mohammed Khan',
   '3 Khan Terrace, Marine Lines, Mumbai 400002',
   'Beta customer — lizard AMC');

-- -------------------------------------------------------------
-- STEP 4: AMC contracts — one per customer, staggered starts
-- -------------------------------------------------------------

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-01-15', '2026-07-15', 7, 'cockroaches', 800.00, 'active',
       'Monthly billing — ₹800/month; commenced Jan 2026'
from customers c where c.phone = '919876543201';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-02-01', '2026-07-01', 7, 'rats', 1200.00, 'active',
       'Monthly billing — ₹1,200/month; commenced Feb 2026'
from customers c where c.phone = '918765432102';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-02-20', '2026-07-20', 7, 'lizards', 600.00, 'active',
       'Monthly billing — ₹600/month; commenced Feb 2026'
from customers c where c.phone = '917654321203';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-03-05', '2026-07-05', 7, 'cockroaches', 800.00, 'active',
       'Monthly billing — ₹800/month; commenced Mar 2026'
from customers c where c.phone = '916543210304';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-03-15', '2026-07-15', 7, 'termites', 2000.00, 'active',
       'Monthly billing — ₹2,000/month; commenced Mar 2026'
from customers c where c.phone = '919123456505';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-04-01', '2026-07-01', 7, 'cockroaches', 800.00, 'active',
       'Monthly billing — ₹800/month; commenced Apr 2026'
from customers c where c.phone = '918234567606';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-04-22', '2026-07-22', 7, 'rats', 1200.00, 'active',
       'Monthly billing — ₹1,200/month; commenced Apr 2026'
from customers c where c.phone = '917345678707';

insert into amc (customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, notes)
select c.id, '2026-05-10', '2026-07-10', 7, 'lizards', 600.00, 'active',
       'Monthly billing — ₹600/month; commenced May 2026'
from customers c where c.phone = '916456789808';

-- -------------------------------------------------------------
-- Done. Next steps:
-- 1. Go to Admin → Users and invite your two technicians by email.
--    After they accept, set their profile details:
--      Nirvan  | phone: 917738287831 | role: technician
--      Sourav  | phone: 919136274331 | role: technician
-- 2. Invite your admin user (owner/manager) and promote to role='admin'
--    via Supabase Studio: UPDATE profiles SET role='admin' WHERE id='<uid>';
-- 3. Update your .env.local — see docs/onboarding/havier-pest-control-notes.md
-- -------------------------------------------------------------
