-- =============================================================
-- PestLLM — DELTA SETUP (generated from supabase/migrations/*)
-- For a database that already has 0001–0010 and
-- 0011_webhook_dedup_and_reminders applied (the pre-existing
-- schema). Applies 0011_human_takeover through 0021 in order.
-- =============================================================

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
