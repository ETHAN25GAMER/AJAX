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
