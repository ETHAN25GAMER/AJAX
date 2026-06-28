-- PestLLM Phase 3: technician PWA schema.
-- Adds tech_notes + completed_at on appointments, an appointment_photos table,
-- and the job-photos Storage bucket with RLS scoped to the assigned technician.

-- 1. appointments: tech-side columns ----------------------------------------

alter table appointments
  add column if not exists tech_notes text,
  add column if not exists completed_at timestamptz;

-- 2. appointment_photos -----------------------------------------------------

create table if not exists appointment_photos (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('before','after','damage','other')),
  taken_at timestamptz not null default now(),
  taken_by uuid references auth.users(id) on delete set null
);

create index if not exists appointment_photos_appointment_idx
  on appointment_photos (appointment_id, taken_at desc);

alter table appointment_photos enable row level security;

-- Admins: full access.
drop policy if exists appointment_photos_admin_all on appointment_photos;
create policy appointment_photos_admin_all on appointment_photos
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Techs: read photos on jobs assigned to them.
drop policy if exists appointment_photos_tech_select on appointment_photos;
create policy appointment_photos_tech_select on appointment_photos
  for select to authenticated
  using (
    exists (
      select 1 from appointments a
      where a.id = appointment_photos.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- Techs: insert photos only on jobs assigned to them, and only as themselves.
drop policy if exists appointment_photos_tech_insert on appointment_photos;
create policy appointment_photos_tech_insert on appointment_photos
  for insert to authenticated
  with check (
    taken_by = auth.uid()
    and exists (
      select 1 from appointments a
      where a.id = appointment_photos.appointment_id
        and a.assigned_technician_id = auth.uid()
    )
  );

-- 3. job-photos Storage bucket ----------------------------------------------
-- Path convention: <appointment_id>/<photo_uuid>.<ext>
-- The first path segment is the appointment id, which lets the RLS policies
-- below resolve the assigned technician without an extra join through the
-- appointment_photos row (which may not exist yet at the moment of upload).

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

drop policy if exists job_photos_admin_all on storage.objects;
create policy job_photos_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos' and is_admin(auth.uid()))
  with check (bucket_id = 'job-photos' and is_admin(auth.uid()));

drop policy if exists job_photos_tech_select on storage.objects;
create policy job_photos_tech_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and exists (
      select 1 from appointments a
      where a.id::text = (storage.foldername(name))[1]
        and a.assigned_technician_id = auth.uid()
    )
  );

drop policy if exists job_photos_tech_insert on storage.objects;
create policy job_photos_tech_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and owner = auth.uid()
    and exists (
      select 1 from appointments a
      where a.id::text = (storage.foldername(name))[1]
        and a.assigned_technician_id = auth.uid()
    )
  );
