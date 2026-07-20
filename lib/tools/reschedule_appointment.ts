import { bookingErrorMessage, supabase } from "@/lib/supabase/client";
import { parseBusinessTime, VISIT_DURATION_MIN } from "@/lib/time";

type Args = {
  confirmation_code: string;
  new_slot_start: string;
};

export async function rescheduleAppointment(args: Args) {
  const db = supabase();
  const existing = await db
    .from("appointments")
    .select("*")
    .eq("confirmation_code", args.confirmation_code)
    .maybeSingle();

  if (existing.error) return { error: existing.error.message };
  if (!existing.data) return { error: "Confirmation code not found" };
  if (existing.data.status !== "booked") return { error: `Appointment is ${existing.data.status}` };

  const start = parseBusinessTime(args.new_slot_start);
  const end = new Date(start.getTime() + VISIT_DURATION_MIN * 60_000);

  const updated = await db
    .from("appointments")
    .update({ slot_start: start.toISOString(), slot_end: end.toISOString() })
    .eq("id", existing.data.id)
    .select("*")
    .single();

  if (updated.error) return { error: bookingErrorMessage(updated.error) };
  return {
    confirmation_code: updated.data.confirmation_code,
    slot_start: updated.data.slot_start,
    slot_end: updated.data.slot_end
  };
}
