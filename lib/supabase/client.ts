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

export async function saveConversationHistory(customerId: string, history: unknown) {
  const db = supabase();
  // Clearing nudged_at lets the nudge cron re-engage on future silence windows.
  await db
    .from("conversations")
    .upsert(
      {
        customer_id: customerId,
        state_json: history,
        last_message_at: new Date().toISOString(),
        nudged_at: null
      },
      { onConflict: "customer_id" }
    );
}
