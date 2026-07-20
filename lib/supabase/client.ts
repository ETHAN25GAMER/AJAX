import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PostgrestError } from "@supabase/supabase-js";

// The appointments_booked_slot_unique_idx index (migration 0010) rejects the
// loser when two bookings race for the same slot. Translate that 23505 into an
// instruction the agent can act on instead of a raw Postgres message.
export function bookingErrorMessage(error: PostgrestError): string {
  if (error.code === "23505" && error.message.includes("appointments_booked_slot_unique_idx")) {
    return "That slot was just booked by someone else. Run check_availability again and offer the customer a different slot.";
  }
  return error.message;
}

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export async function getOrCreateCustomer(phone: string) {
  const db = supabase();
  const existing = await db.from("customers").select("*").eq("phone", phone).maybeSingle();
  if (existing.data) return existing.data;
  const inserted = await db.from("customers").insert({ phone }).select("*").single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function loadConversationHistory(customerId: string) {
  const db = supabase();
  const row = await db
    .from("conversations")
    .select("state_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  const history = (row.data?.state_json as unknown) ?? [];
  return Array.isArray(history) ? history : [];
}

// Inbound path needs the history, the takeover flag, and the MCQ flow position
// in one round-trip so the webhook can route without extra queries.
export async function loadConversationForInbound(
  customerId: string
): Promise<{ history: unknown[]; agentPaused: boolean; flowState: unknown }> {
  const db = supabase();
  const row = await db
    .from("conversations")
    .select("state_json, agent_paused, flow_state")
    .eq("customer_id", customerId)
    .maybeSingle();
  const state = (row.data?.state_json as unknown) ?? [];
  return {
    history: Array.isArray(state) ? state : [],
    agentPaused: row.data?.agent_paused ?? false,
    flowState: row.data?.flow_state ?? null
  };
}

// Persist one flow turn: appended transcript + the customer's new flow position.
// Clearing nudged_at / recovery_sent_at mirrors saveConversationHistory.
export async function saveFlowConversation(
  customerId: string,
  history: unknown,
  flowState: unknown
): Promise<void> {
  const db = supabase();
  await db
    .from("conversations")
    .upsert(
      {
        customer_id: customerId,
        state_json: history,
        flow_state: flowState,
        last_message_at: new Date().toISOString(),
        nudged_at: null,
        recovery_sent_at: null
      },
      { onConflict: "customer_id" }
    );
}

export type MessageDirection = "inbound" | "outbound_agent" | "outbound_staff";

// SLA event log (migration 0018): timestamps + direction only, never content.
// Fire-and-forget from the reply path — analytics must never block or fail a
// customer-facing send, so all errors are swallowed into a console line.
export async function logMessageEvents(
  customerId: string,
  events: Array<{ direction: MessageDirection; at: Date }>
): Promise<void> {
  if (events.length === 0) return;
  try {
    const db = supabase();
    const convo = await db
      .from("conversations")
      .select("id")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!convo.data) return; // first contact raced retention — nothing to anchor to
    const conversationId = convo.data.id as string;
    await db.from("message_events").insert(
      events.map((e) => ({
        conversation_id: conversationId,
        customer_id: customerId,
        direction: e.direction,
        at: e.at.toISOString()
      }))
    );
  } catch (err) {
    console.error("[sla] message event log failed", err);
  }
}

// While an admin has taken over (agent_paused), record the customer's inbound
// message so it shows up in the console, but do NOT run the agent. Stored as a
// plain user turn; photos are reduced to a stub (same rationale as the agent's
// stripImages — never persist base64 into state_json).
export async function appendInboundWhilePaused(
  customerId: string,
  userText: string,
  mediaUrls: string[] = []
): Promise<void> {
  const db = supabase();
  const history = await loadConversationHistory(customerId);
  const parts: string[] = [];
  if (userText) parts.push(userText);
  if (mediaUrls.length > 0) parts.push("[customer sent a photo — view via WhatsApp]");
  const text = parts.join("\n") || "(empty message)";
  const updated = [...history, { role: "user", content: [{ type: "text", text }] }];
  await db
    .from("conversations")
    .upsert(
      { customer_id: customerId, state_json: updated, last_message_at: new Date().toISOString() },
      { onConflict: "customer_id" }
    );
}

export async function saveConversationHistory(customerId: string, history: unknown) {
  const db = supabase();
  // Clearing nudged_at / recovery_sent_at lets the nudge and abandoned-booking
  // crons re-engage on future silence windows.
  await db
    .from("conversations")
    .upsert(
      {
        customer_id: customerId,
        state_json: history,
        last_message_at: new Date().toISOString(),
        nudged_at: null,
        recovery_sent_at: null
      },
      { onConflict: "customer_id" }
    );
}
