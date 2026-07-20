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
