import { supabase } from "@/lib/supabase/client";

type Args = { confirmation_code: string; reason?: string };

export async function cancelAppointment(args: Args) {
  const db = supabase();
  const updated = await db
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("confirmation_code", args.confirmation_code)
    .select("confirmation_code, status, slot_start")
    .maybeSingle();

  if (updated.error) return { error: updated.error.message };
  if (!updated.data) return { error: "Confirmation code not found" };
  return { ...updated.data, reason: args.reason ?? null };
}
