-- PestLLM Phase 5: column-level guard for technician updates to appointments.
--
-- WHY: appointments_tech_update RLS lets a tech UPDATE any column on a job
-- assigned to them (the policy is row-level, not column-level). The Server
-- Actions in app/(tech)/tech/jobs/[id]/actions.ts only touch a safe subset
-- (status, tech_notes, completed_at, tracking_state), but a tech with the
-- anon key and their JWT could call Supabase directly and rewrite pricing,
-- slot times, the linked customer, etc. This trigger enforces the column
-- allowlist at the database level so the policy and the UI are no longer
-- the sole defense.
--
-- NOT ENFORCED: admins (full access) and service-role calls (webhook, cron,
-- public tracking API). Both bypass the column check.

create or replace function appointments_tech_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  uid_role text;
begin
  -- Service role calls have a null auth.uid() — let them through.
  if uid is null then
    return new;
  end if;

  select role into uid_role from profiles where id = uid;

  -- Admins (and anyone who isn't a tech, defensively) bypass column locks.
  if uid_role is distinct from 'technician' then
    return new;
  end if;

  -- Tech path: every column outside the allowlist must be unchanged.
  if new.customer_id            is distinct from old.customer_id
     or new.confirmation_code   is distinct from old.confirmation_code
     or new.pest_type           is distinct from old.pest_type
     or new.service_tier        is distinct from old.service_tier
     or new.slot_start          is distinct from old.slot_start
     or new.slot_end            is distinct from old.slot_end
     or new.price_quoted        is distinct from old.price_quoted
     or new.assigned_technician_id is distinct from old.assigned_technician_id
     or new.created_at          is distinct from old.created_at
  then
    raise exception
      'Technicians can only update status, tech_notes, completed_at, tracking_state on their own appointments'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_tech_column_guard_trg on appointments;
create trigger appointments_tech_column_guard_trg
  before update on appointments
  for each row execute function appointments_tech_column_guard();
