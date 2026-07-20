/**
 * Manually open the MCQ booking flow for one customer, mirroring the webhook's
 * engine.start path: send the main menu, append the transcript turns, and
 * persist flow_state so subsequent taps route through the webhook exactly like
 * a normal conversation.
 *
 * Run with: npx tsx --env-file=.env.local scripts/send-flow-start.ts <+E164 phone>
 */
import {
  getOrCreateCustomer,
  loadConversationForInbound,
  saveFlowConversation
} from "@/lib/supabase/client";
import { flowEngine } from "@/lib/flows/definitions";
import { deliverSends } from "@/lib/flows/deliver";
import { assistantTurnsFor } from "@/lib/flows/transcript";

async function main() {
  const phone = process.argv[2];
  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    throw new Error("Usage: send-flow-start.ts <+E164 phone>, e.g. +919653411753");
  }

  const customer = await getOrCreateCustomer(phone);
  console.log(`Customer: ${phone}${customer.name ? ` (${customer.name})` : ""} — id ${customer.id}`);

  const ctx = { customerPhone: phone, customerId: customer.id as string };
  const { sends, state } = await flowEngine().start(ctx, "booking");

  await deliverSends(phone, sends);

  const { history } = await loadConversationForInbound(ctx.customerId);
  await saveFlowConversation(ctx.customerId, [...history, ...assistantTurnsFor(sends)], state);

  console.log(`Sent ${sends.length} message(s); flow parked at ${state ? `${state.flow}.${state.node}` : "end"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
