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
