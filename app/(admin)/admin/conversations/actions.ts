"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { logMessageEvents } from "@/lib/supabase/client";
import { sendWhatsApp } from "@/lib/whatsapp/outbound";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Pause the agent on one conversation: the webhook records inbound messages but
// stops replying (app/api/whatsapp/webhook/route.ts). Attribution via paused_by.
export async function pauseAgent(conversationId: string): Promise<ActionResult> {
  const session = await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const { error } = await sb
    .from("conversations")
    .update({
      agent_paused: true,
      paused_by: session.userId,
      paused_at: new Date().toISOString()
    })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/conversations");
  return { ok: true };
}

export async function resumeAgent(conversationId: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const { error } = await sb
    .from("conversations")
    .update({ agent_paused: false, paused_by: null, paused_at: null })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/conversations");
  return { ok: true };
}

// Send a staff reply into the live WhatsApp thread and append it to the
// transcript as an assistant turn. Sent via the plain (transactional) path: a
// human is replying to a customer who just messaged, so it's inside Meta's 24h
// window and is not subject to the promotional opt-out gate.
export async function sendStaffReply(
  conversationId: string,
  text: string
): Promise<ActionResult> {
  await requireRole("admin");
  const body = text.trim();
  if (!body) return { ok: false, error: "Message is empty." };

  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("conversations")
    .select("id, customer_id, state_json, agent_paused, customers(phone)")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Conversation not found." };
  if (!data.agent_paused) {
    return { ok: false, error: "Take over the conversation before replying." };
  }

  // Supabase types the embedded relation as an array; the FK is one customer.
  const customer = (data.customers as unknown) as { phone: string | null } | null;
  const phone = customer?.phone;
  if (!phone) return { ok: false, error: "Customer has no phone on file." };

  try {
    await sendWhatsApp(phone, body);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "WhatsApp send failed." };
  }

  const history = Array.isArray(data.state_json) ? (data.state_json as unknown[]) : [];
  const updated = [...history, { role: "assistant", content: [{ type: "text", text: body }] }];
  const upd = await sb
    .from("conversations")
    .update({ state_json: updated, last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (upd.error) return { ok: false, error: upd.error.message };

  // SLA log (service role — RLS has no authenticated insert path on purpose).
  const customerId = (data as unknown as { customer_id?: string }).customer_id;
  if (customerId) {
    await logMessageEvents(customerId, [{ direction: "outbound_staff", at: new Date() }]);
  }

  revalidatePath("/admin/conversations");
  return { ok: true };
}
