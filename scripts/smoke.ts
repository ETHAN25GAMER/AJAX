/**
 * Manual smoke test: exercises each tool against the real Supabase/Anthropic env.
 * Run with: pnpm smoke   (after setting .env.local)
 */
import { checkAvailability } from "@/lib/tools/check_availability";
import { getPricingQuote } from "@/lib/tools/get_pricing_quote";
import { createAppointment } from "@/lib/tools/create_appointment";
import { rescheduleAppointment } from "@/lib/tools/reschedule_appointment";
import { cancelAppointment } from "@/lib/tools/cancel_appointment";
import { lookupCustomer } from "@/lib/tools/lookup_customer";
import { identifyPest } from "@/lib/tools/identify_pest";

const phone = "+15551234567";

async function main() {
  console.log("pricing ants/standard:", await getPricingQuote({ pest_type: "ants", service_tier: "standard", property_size: "medium" }));

  const today = new Date().toISOString().slice(0, 10);
  const inAWeek = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const avail = await checkAvailability({ start_date: today, end_date: inAWeek, service_type: "standard" });
  console.log("availability:", avail);

  const first = (avail as { slots: { slot_start: string }[] }).slots?.[0];
  if (!first) throw new Error("no slots");

  const booked = await createAppointment({
    customer_phone: phone,
    name: "Smoke Test",
    address: "123 Test St",
    pest_type: "ants",
    slot_start: first.slot_start,
    service_tier: "standard"
  });
  console.log("booked:", booked);
  const code = (booked as { confirmation_code: string }).confirmation_code;

  console.log("lookup:", await lookupCustomer({ customer_phone: phone }));

  const avail2 = await checkAvailability({ start_date: today, end_date: inAWeek, service_type: "standard" });
  const next = (avail2 as { slots: { slot_start: string }[] }).slots?.[1];
  if (next) console.log("reschedule:", await rescheduleAppointment({ confirmation_code: code, new_slot_start: next.slot_start }));

  console.log("cancel:", await cancelAppointment({ confirmation_code: code, reason: "smoke" }));

  console.log("identify (text):", await identifyPest({ description: "small brown ants in the kitchen, lined up near the sink" }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
