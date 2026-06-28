-- PestLLM Phase 5: RLS hardening.
-- Replace the `is_admin(auth.uid())` function calls (or `(true)` workarounds)
-- in admin policies with inline `exists (select 1 from profiles ...)` checks.
--
-- WHY: Supabase Realtime's broadcast filter silently drops events whose RLS
-- policy calls a function. Inline subqueries work; function calls don't. The
-- previous workaround was `using (true)` on admin policies, which is fine for
-- realtime delivery but is a footgun (an authenticated user with no profile
-- row could still pass). The inline-exists pattern is correct and works with
-- the broadcast filter.
--
-- NOT TOUCHED: profiles_self_select / profiles_admin_update.
--   - profiles isn't in the realtime publication, so the broadcast issue
--     doesn't apply.
--   - A subquery `exists (select 1 from profiles where ...)` from inside a
--     profiles policy would trip RLS recursively, since the inner select on
--     profiles itself goes through profiles_self_select. is_admin is
--     security-definer and bypasses RLS, so it's the safer choice here.

-- 1. customers --------------------------------------------------------------

drop policy if exists customers_admin_all on customers;
create policy customers_admin_all on customers
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 2. conversations ----------------------------------------------------------

drop policy if exists conversations_admin_all on conversations;
create policy conversations_admin_all on conversations
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 3. appointments  (realtime-critical) --------------------------------------

drop policy if exists appointments_admin_all on appointments;
create policy appointments_admin_all on appointments
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 4. pricing ----------------------------------------------------------------

drop policy if exists pricing_admin_all on pricing;
create policy pricing_admin_all on pricing
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 5. escalations  (realtime-critical) ---------------------------------------

drop policy if exists escalations_admin_all on escalations;
create policy escalations_admin_all on escalations
  for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 6. Wake the Realtime broker on the affected tables ------------------------
-- Policy changes can leave the broker holding a stale filter; drop+re-add
-- forces a re-evaluation so admin clients start receiving events again.

do $$
begin
  alter publication supabase_realtime drop table appointments;
exception when others then null;
end $$;
alter publication supabase_realtime add table appointments;

do $$
begin
  alter publication supabase_realtime drop table escalations;
exception when others then null;
end $$;
alter publication supabase_realtime add table escalations;
