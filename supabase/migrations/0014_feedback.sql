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
