import { bookingErrorMessage, getOrCreateCustomer, supabase } from "@/lib/supabase/client";
import { parseBusinessTime } from "@/lib/time";
import { pickTechnician } from "@/lib/auto-assign";
import type { ServiceTier } from "@/lib/supabase/types";

type Args = {
  customer_phone: string;
  name: string;
  address: string;
  pest_type: string;
  slot_start: string;
  service_tier: ServiceTier;
};

const DURATION_MIN: Record<ServiceTier, number> = { standard: 60, plus: 90, specialist: 120 };

export async function createAppointment(args: Args) {
  const db = supabase();
  const customer = await getOrCreateCustomer(args.customer_phone);

  // Update customer details from this booking.
  await db
    .from("customers")
    .update({ name: args.name, address: args.address })
    .eq("id", customer.id);

  const start = parseBusinessTime(args.slot_start);
  const end = new Date(start.getTime() + DURATION_MIN[args.service_tier] * 60_000);
  const code = generateCode();
  const assignedTechnicianId = await pickTechnician(start.toISOString(), db);

  const row = await db
    .from("appointments")
    .insert({
      customer_id: customer.id,
      confirmation_code: code,
      pest_type: args.pest_type,
      service_tier: args.service_tier,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      status: "booked",
      assigned_technician_id: assignedTechnicianId
    })
    .select("*")
    .single();

  if (row.error) return { error: bookingErrorMessage(row.error) };

  return {
    confirmation_code: code,
    slot_start: row.data.slot_start,
    slot_end: row.data.slot_end,
    service_tier: row.data.service_tier,
    address: args.address
  };
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
