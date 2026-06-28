-- PestLLM Phase 1: profiles, role gating, assigned technician, RLS on every table.
-- Service role bypasses RLS so the existing webhook + cron paths remain functional.

-- 1. profiles ----------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'technician' check (role in ('admin','technician')),
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row for every new auth user. Default role is 'technician';
-- promote to admin manually via Supabase Studio: update profiles set role='admin' where id=...
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. appointments: assigned technician --------------------------------------

alter table appointments
  add column if not exists assigned_technician_id uuid references auth.users(id) on delete set null;

create index if not exists appointments_assigned_tech_idx
  on appointments (assigned_technician_id) where assigned_technician_id is not null;

-- 3. is_admin() helper ------------------------------------------------------

create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

-- 4. Enable RLS on every table ----------------------------------------------

alter table profiles      enable row level security;
alter table customers     enable row level security;
alter table conversations enable row level security;
alter table appointments  enable row level security;
alter table pricing       enable row level security;
alter table escalations   enable row level security;

-- 5. Policies ---------------------------------------------------------------
-- Service role bypasses RLS automatically; these policies cover authenticated browser clients.

-- profiles: self-read; admins read+update everyone
drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin(auth.uid()));

drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles
  for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- customers: admins full; techs read only customers tied to their appointments
drop policy if exists customers_admin_all on customers;
create policy customers_admin_all on customers
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists customers_tech_select on customers;
create policy customers_tech_select on customers
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = customers.id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- conversations: admins full; techs read only conversations for their customers
drop policy if exists conversations_admin_all on conversations;
create policy conversations_admin_all on conversations
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists conversations_tech_select on conversations;
create policy conversations_tech_select on conversations
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = conversations.customer_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- appointments: admins full; techs read+update only their own assigned jobs
drop policy if exists appointments_admin_all on appointments;
create policy appointments_admin_all on appointments
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists appointments_tech_select on appointments;
create policy appointments_tech_select on appointments
  for select to authenticated
  using (assigned_technician_id = auth.uid());

drop policy if exists appointments_tech_update on appointments;
create policy appointments_tech_update on appointments
  for update to authenticated
  using (assigned_technician_id = auth.uid())
  with check (assigned_technician_id = auth.uid());

-- pricing: admins full; techs read-only
drop policy if exists pricing_admin_all on pricing;
create policy pricing_admin_all on pricing
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists pricing_tech_select on pricing;
create policy pricing_tech_select on pricing
  for select to authenticated
  using (true);

-- escalations: admins full; techs read+update only escalations for their customers
drop policy if exists escalations_admin_all on escalations;
create policy escalations_admin_all on escalations
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists escalations_tech_select on escalations;
create policy escalations_tech_select on escalations
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.customer_id = escalations.customer_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- 6. Enable Realtime on tables the admin/tech app subscribes to ---------------
-- Supabase Realtime is opt-in per table; tables must be in the
-- supabase_realtime publication for postgres_changes events to fire.

alter publication supabase_realtime add table escalations;
alter publication supabase_realtime add table appointments;
