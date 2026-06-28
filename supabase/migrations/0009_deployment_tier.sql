-- PestLLM Phase tier-gating: single-row deployment_settings table.
-- Each Supabase project belongs to exactly one client deployment, so a singleton
-- row (id pinned to 1) is the natural shape. Flip `tier` to expose tier-3 features
-- (KPI dashboard) in the admin console.

create table if not exists deployment_settings (
  id int primary key default 1 check (id = 1),
  tier text not null default 'tier2' check (tier in ('tier2','tier3')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into deployment_settings (id) values (1) on conflict (id) do nothing;

alter table deployment_settings enable row level security;

drop policy if exists deployment_settings_admin_write on deployment_settings;
create policy deployment_settings_admin_write on deployment_settings
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Techs need to read it so future tier-gated tech features can branch on it.
-- The value isn't a secret.
drop policy if exists deployment_settings_authed_select on deployment_settings;
create policy deployment_settings_authed_select on deployment_settings
  for select to authenticated
  using (true);
