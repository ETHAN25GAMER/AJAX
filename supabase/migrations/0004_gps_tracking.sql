-- PestLLM Phase 4: GPS tracking — live tech positions, public customer
-- tracking links, and an admin dispatch realtime feed.

-- 1. technician_positions: one row per actively-sharing tech --------------

create table if not exists technician_positions (
  technician_id  uuid primary key references auth.users(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  lat            double precision not null,
  lng            double precision not null,
  accuracy_m     double precision,
  heading        double precision,
  updated_at     timestamptz not null default now()
);

create index if not exists technician_positions_updated_idx
  on technician_positions (updated_at desc);

alter table technician_positions enable row level security;

-- Tech owns their row, full mutability.
drop policy if exists technician_positions_self_all on technician_positions;
create policy technician_positions_self_all on technician_positions
  for all to authenticated
  using (technician_id = auth.uid())
  with check (technician_id = auth.uid());

-- Admin: SELECT all. Inline exists() rather than is_admin() so the Realtime
-- broadcast filter delivers events (function calls silently drop messages —
-- see prior pain on `escalations`/`appointments`).
drop policy if exists technician_positions_admin_select on technician_positions;
create policy technician_positions_admin_select on technician_positions
  for select to authenticated
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- 2. appointment_tracking_tokens: public-facing tokens for customer links --

create table if not exists appointment_tracking_tokens (
  token          uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  created_at     timestamptz not null default now(),
  revoked        boolean not null default false,
  revoked_at     timestamptz
);

-- At most one live token per appointment.
create unique index if not exists appointment_tracking_tokens_live_idx
  on appointment_tracking_tokens (appointment_id) where revoked = false;

alter table appointment_tracking_tokens enable row level security;

-- Tech can manage tokens only for jobs assigned to them.
drop policy if exists appointment_tracking_tokens_tech_select on appointment_tracking_tokens;
create policy appointment_tracking_tokens_tech_select on appointment_tracking_tokens
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

drop policy if exists appointment_tracking_tokens_tech_insert on appointment_tracking_tokens;
create policy appointment_tracking_tokens_tech_insert on appointment_tracking_tokens
  for insert to authenticated
  with check (
    exists (
      
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

drop policy if exists appointment_tracking_tokens_tech_update on appointment_tracking_tokens;
create policy appointment_tracking_tokens_tech_update on appointment_tracking_tokens
  for update to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from appointments a
      where a.id = appointment_tracking_tokens.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- Admin: full access. Inline check for the same Realtime reason.
drop policy if exists appointment_tracking_tokens_admin_all on appointment_tracking_tokens;
create policy appointment_tracking_tokens_admin_all on appointment_tracking_tokens
  for all to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- 3. appointments.tracking_state ----------------------------------------------
-- 'en_route' | 'arrived' while status='booked'. Cleared on completion/cancel.

alter table appointments
  add column if not exists tracking_state text
    check (tracking_state in ('en_route','arrived'));

-- 4. customers: cached geocode for the address --------------------------------

alter table customers
  add column if not exists address_lat double precision,
  add column if not exists address_lng double precision;

-- 5. Realtime: dispatch reads technician_positions live. ---------------------
-- Drop + re-add so the broker wakes up and starts broadcasting. The tokens
-- table stays out of the publication — the customer tracking page polls.

do $$
begin
  alter publication supabase_realtime drop table technician_positions;
exception when others then
  null;
end $$;

alter publication supabase_realtime add table technician_positions;
