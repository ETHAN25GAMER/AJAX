-- PestLLM: database refinement — FK covering indexes, KPI query indexes,
-- a DB-level double-booking guard, and data-integrity check constraints.
-- No schema shape changes (no new columns/tables), so lib/supabase/types.ts
-- and application code are unaffected. Everything here is idempotent.

-- 1. FK covering indexes ------------------------------------------------------
-- Postgres does not auto-index FK columns. These cover the joins the app makes
-- constantly (tech RLS policies all join appointments by customer_id) and the
-- cascade/set-null paths on customer/appointment deletion (PDPA erasure).

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
