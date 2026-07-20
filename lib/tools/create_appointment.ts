import { bookingErrorMessage, getOrCreateCustomer, supabase } from "@/lib/supabase/client";
import { parseBusinessTime, VISIT_DURATION_MIN } from "@/lib/time";
import { pickTechnician } from "@/lib/auto-assign";
import { createRecordedPaymentLink, depositAmount } from "@/lib/payments/links";

type Args = {
  customer_phone: string;
  name: string;
  address: string;
  pest_type: string;
  slot_start: string;
};

export async function createAppointment(args: Args) {
  const db = supabase();
  const customer = await getOrCreateCustomer(args.customer_phone);

  // Update customer details from this booking.
  await db
    .from("customers")
    .update({ name: args.name, address: args.address })
    .eq("id", customer.id);

  const start = parseBusinessTime(args.slot_start);
  const end = new Date(start.getTime() + VISIT_DURATION_MIN * 60_000);
  const code = generateCode();
  const assignedTechnicianId = await pickTechnician(start.toISOString(), db);

  const row = await db
    .from("appointments")
    .insert({
      customer_id: customer.id,
      confirmation_code: code,
      pest_type: args.pest_type,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      status: "booked",
      assigned_technician_id: assignedTechnicianId
    })
    .select("*")
    .single();

  if (row.error) return { error: bookingErrorMessage(row.error) };

  // Optional booking deposit (cuts no-shows). Null when Razorpay/deposits
  // aren't configured or the link fails — the booking stands either way.
  const deposit = depositAmount();
  const depositLink = deposit
    ? await createRecordedPaymentLink({
        customerId: customer.id,
        customerName: args.name,
        customerPhone: args.customer_phone,
        appointmentId: row.data.id,
        purpose: "deposit",
        amount: deposit,
        description: `Booking deposit — ${args.pest_type} (${code})`
      })
    : null;

  return {
    confirmation_code: code,
    slot_start: row.data.slot_start,
    slot_end: row.data.slot_end,
    address: args.address,
    ...(depositLink
      ? {
          deposit_link: depositLink.url,
          deposit_amount_inr: depositLink.amount,
          deposit_note:
            "Share this secure link with the customer to pay the booking deposit. The visit is confirmed either way; the deposit just holds priority."
        }
      : {})
  };
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
