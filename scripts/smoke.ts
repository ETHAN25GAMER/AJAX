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
import { detectAbandonedBooking } from "@/lib/recovery";

const phone = "+15551234567";

// Pure checks on the abandoned-booking detector (no env needed).
function assertRecoveryDetector() {
  const quoteUse = {
    role: "assistant",
    content: [
      { type: "tool_use", id: "tu_1", name: "get_pricing_quote", input: { pest_type: "rats" } }
    ]
  };
  const quoteResult = {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: JSON.stringify({ pest_type: "rats", price_low: 269, price_high: 344, currency: "USD" })
      }
    ]
  };
  const bookUse = {
    role: "assistant",
    content: [{ type: "tool_use", id: "tu_2", name: "create_appointment", input: {} }]
  };
  const bookResult = {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "tu_2", content: JSON.stringify({ confirmation_code: "ABC123" }) }
    ]
  };

  const abandoned = detectAbandonedBooking([quoteUse, quoteResult]);
  if (!abandoned || abandoned.pestType !== "rats" || !abandoned.priceLabel?.includes("269")) {
    throw new Error(`recovery: quote-without-booking should detect, got ${JSON.stringify(abandoned)}`);
  }
  if (detectAbandonedBooking([quoteUse, quoteResult, bookUse, bookResult]) !== null) {
    throw new Error("recovery: quote followed by successful booking must NOT detect");
  }
  if (detectAbandonedBooking([]) !== null || detectAbandonedBooking("junk") !== null) {
    throw new Error("recovery: empty/garbage history must NOT detect");
  }
  console.log("recovery detector: ok");
}

async function main() {
  assertRecoveryDetector();

  console.log("pricing ants:", await getPricingQuote({ pest_type: "ants", property_size: "medium" }));

  const today = new Date().toISOString().slice(0, 10);
  const inAWeek = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const avail = await checkAvailability({ start_date: today, end_date: inAWeek });
  console.log("availability:", avail);

  const first = (avail as { slots: { slot_start: string }[] }).slots?.[0];
  if (!first) throw new Error("no slots");

  const booked = await createAppointment({
    customer_phone: phone,
    name: "Smoke Test",
    address: "123 Test St",
    pest_type: "ants",
    slot_start: first.slot_start
  });
  console.log("booked:", booked);
  const code = (booked as { confirmation_code: string }).confirmation_code;

  console.log("lookup:", await lookupCustomer({ customer_phone: phone }));

  const avail2 = await checkAvailability({ start_date: today, end_date: inAWeek });
  const next = (avail2 as { slots: { slot_start: string }[] }).slots?.[1];
  if (next) console.log("reschedule:", await rescheduleAppointment({ confirmation_code: code, new_slot_start: next.slot_start }));

  console.log("cancel:", await cancelAppointment({ confirmation_code: code, reason: "smoke" }));

  console.log("identify (text):", await identifyPest({ description: "small brown ants in the kitchen, lined up near the sink" }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
