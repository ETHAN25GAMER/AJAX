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
