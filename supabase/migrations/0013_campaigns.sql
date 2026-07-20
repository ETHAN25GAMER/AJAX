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
