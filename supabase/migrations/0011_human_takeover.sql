-- PestLLM: human takeover / shared team inbox.
-- Lets an admin pause the AI on a single conversation, reply into the live
-- WhatsApp thread from the console, and resume the AI. Everything here is
-- idempotent.

-- 1. Takeover state on conversations -----------------------------------------
-- agent_paused gates the webhook: while true, inbound customer messages are
-- recorded but runAgent() is NOT called (see app/api/whatsapp/webhook/route.ts).
-- paused_by / paused_at are for attribution and display in the console.

alter table conversations
  add column if not exists agent_paused boolean not null default false;

alter table conversations
  add column if not exists paused_by uuid references auth.users(id) on delete set null;

alter table conversations
  add column if not exists paused_at timestamptz;

-- 2. Realtime ----------------------------------------------------------------
-- The conversations inbox subscribes to postgres_changes so inbound messages
-- and other admins' pause/resume/reply actions appear live (same pattern as
-- escalations + appointments in 0002). Realtime is opt-in per table; guard the
-- add so re-running the migration doesn't error if it's already published.

do $$ begin
  alter publication supabase_realtime add table conversations;
exception when duplicate_object then null;
end $$;

-- 3. Deliberately NOT changed -------------------------------------------------
-- * No RLS change: conversations already has conversations_admin_all (0002),
--   which grants admins full select/update — exactly what the inbox needs. The
--   service-role webhook/cron paths bypass RLS as before.
-- * No per-message author column: staff replies are stored in state_json as
--   ordinary assistant turns so the AI's context stays coherent when the agent
--   resumes. Attribution lives at the conversation level (paused_by). Adding a
--   shadow messages table purely to label "staff vs AI" isn't worth it yet.
