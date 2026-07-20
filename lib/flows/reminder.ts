import { supabase } from "@/lib/supabase/client";
import { formatSlotTime, shortDate } from "@/lib/time";
import { flowEngine } from "./definitions";
import type { FlowContext, FlowState, Send } from "./types";

// Deterministic handling of the reminder template's quick-reply taps.
// Payloads are set at send time (app/api/cron/reminders):
//   rem:confirm:<appointment id> | rem:resched:<appointment id> | rem:cancel:<appointment id>
// A tap opens Meta's 24h service window, so the follow-up slot list is allowed.

export function isReminderPayload(id: string): boolean {
  return id.startsWith("rem:");
}

export async function handleReminderTap(
  ctx: FlowContext,
  payload: string
): Promise<{ sends: Send[]; state: FlowState | null }> {
  const [, action, apptId] = payload.split(":");
  const db = supabase();

  const { data: appt } = await db
    .from("appointments")
    .select("id, customer_id, confirmation_code, pest_type, slot_start, status")
    .eq("id", apptId ?? "")
    .maybeSingle();

  // Unknown id, someone else's booking (payload replay), or no longer booked →
  // fall back to the menu rather than acting on the wrong appointment.
  if (!appt || appt.customer_id !== ctx.customerId || appt.status !== "booked") {
    const menu = await flowEngine().start(ctx, "booking");
    return {
      sends: [
        { kind: "text", body: "That booking isn't active anymore — here's what I can do:" },
        ...menu.sends
      ],
      state: menu.state
    };
  }

  const label = `${shortDate(appt.slot_start)} ${formatSlotTime(appt.slot_start)} · ${appt.pest_type}`;

  if (action === "confirm") {
    await db
      .from("appointments")
      .update({ reminder_confirmed_at: new Date().toISOString() })
      .eq("id", appt.id)
      .eq("status", "booked");
    return {
      sends: [
        {
          kind: "text",
          body: `Confirmed ✅ — see you ${label}. You'll get a live tracking link when the technician heads out.`
        }
      ],
      state: null
    };
  }

  const bound = { confirmation_code: appt.confirmation_code, appt_label: label };
  if (action === "resched") {
    return flowEngine().start(ctx, "manage", "reslots", bound);
  }
  if (action === "cancel") {
    return flowEngine().start(ctx, "manage", "cancelConfirm", bound);
  }

  // Unknown action segment — treat like a stale tap.
  const menu = await flowEngine().start(ctx, "booking");
  return { sends: menu.sends, state: menu.state };
}
