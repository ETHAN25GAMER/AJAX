/**
 * Showcase every customer-facing screen of the MCQ flows on WhatsApp.
 *
 * Renders each prompt node (with sample data where a step depends on earlier
 * answers) and sends them in order, so the whole journey can be seen without
 * tapping through. Action nodes with side effects (book, cancel, escalate) are
 * NOT run; the read-only quote step is included. Ends by re-sending the real
 * main menu and persisting flow_state there, so the thread stays usable.
 *
 * Run with: npx tsx --env-file=.env.local scripts/send-flow-showcase.ts <+E164 phone>
 */
import {
  getOrCreateCustomer,
  loadConversationForInbound,
  saveFlowConversation
} from "@/lib/supabase/client";
import { FLOWS, flowEngine } from "@/lib/flows/definitions";
import { deliverSends } from "@/lib/flows/deliver";
import { assistantTurnsFor } from "@/lib/flows/transcript";
import type { FlowContext, Send } from "@/lib/flows/types";

async function promptSend(
  ctx: FlowContext,
  flowId: string,
  nodeId: string,
  data: Record<string, unknown>
): Promise<Send> {
  const node = FLOWS[flowId as keyof typeof FLOWS].nodes[nodeId];
  if (!node || node.kind !== "prompt") throw new Error(`${flowId}.${nodeId} is not a prompt node`);
  const p = await node.prompt(ctx, data);
  return p.send;
}

async function quoteSends(ctx: FlowContext): Promise<Send[]> {
  // The quote action node is read-only (pricing lookup) — safe to run.
  const node = FLOWS.booking.nodes.quote;
  if (node.kind !== "action") return [];
  const r = await node.run(ctx, { _tapped: "bk:size:medium", pest_type: "cockroaches" });
  return r.sends;
}

async function main() {
  const phone = process.argv[2];
  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    throw new Error("Usage: send-flow-showcase.ts <+E164 phone>");
  }

  const customer = await getOrCreateCustomer(phone);
  const ctx: FlowContext = { customerPhone: phone, customerId: customer.id as string };

  const sample = {
    pest_type: "cockroaches",
    quote_label: "₹1620–₹2070",
    slot_label: "Tue 21 Jul 9am-10:30am",
    name: "Ethan",
    address: "14B Rustom Baug, Marine Lines",
    saved_name: "Ethan",
    saved_address: "14B Rustom Baug, Marine Lines",
    appt_label: "Tue, 21 Jul 09:00 · cockroaches",
    upcoming: [
      { code: "DEMO01", label: "Tue, 21 Jul 09:00 · cockroaches" },
      { code: "DEMO02", label: "Thu, 23 Jul 13:00 · rats" }
    ]
  };

  const sends: Send[] = [];
  const say = (body: string) => sends.push({ kind: "text", body });

  say("📋 *FLOW SHOWCASE* — every screen of the WhatsApp booking assistant, in order. (Buttons here are for preview; the live menu comes at the end.)");

  say("*1️⃣ BOOKING FLOW*");
  sends.push(await promptSend(ctx, "booking", "menu", {}));
  sends.push(await promptSend(ctx, "booking", "pest", {}));
  sends.push(await promptSend(ctx, "booking", "size", sample));
  sends.push(...(await quoteSends(ctx)));
  sends.push(await promptSend(ctx, "booking", "quoteChoice", sample));
  sends.push(await promptSend(ctx, "booking", "slots", sample));
  sends.push(await promptSend(ctx, "booking", "savedDetails", sample));
  sends.push(await promptSend(ctx, "booking", "name", sample));
  sends.push(await promptSend(ctx, "booking", "address", sample));
  sends.push(await promptSend(ctx, "booking", "confirm", sample));
  say("→ On confirm, the booking is created and the customer gets:\n\nYou're booked! ✅\nConfirmation code: *DEMO01*\nTue 21 Jul 9am-10:30am\n14B Rustom Baug, Marine Lines\n\nWe'll remind you the day before, and you'll get a live tracking link when the technician heads your way.");

  say("*2️⃣ MANAGE-BOOKING FLOW*");
  sends.push(await promptSend(ctx, "manage", "pick", sample));
  sends.push(await promptSend(ctx, "manage", "action", sample));
  sends.push(await promptSend(ctx, "manage", "reslots", sample));
  sends.push(await promptSend(ctx, "manage", "cancelConfirm", sample));
  sends.push(await promptSend(ctx, "manage", "noneFound", {}));
  sends.push(await promptSend(ctx, "manage", "askCode", {}));

  say("*3️⃣ REMINDER (day before, template)*\n\nHi Ethan, reminder: your pest control visit is Tue 21 Jul, 9:00 AM. Code: DEMO01.\n▢ Confirm ✓  ▢ Reschedule  ▢ Cancel");

  say("✅ That's every screen. Below is the *live* menu — taps work from here:");

  console.log(`Sending ${sends.length + 1} messages to ${phone}…`);
  await deliverSends(phone, sends);

  // End in a real, usable state: live menu + persisted flow position.
  const menu = await flowEngine().start(ctx, "booking");
  await deliverSends(phone, menu.sends);

  const { history } = await loadConversationForInbound(ctx.customerId);
  await saveFlowConversation(
    ctx.customerId,
    [...history, ...assistantTurnsFor([...sends, ...menu.sends])],
    menu.state
  );

  console.log(`Done — showcase delivered; flow parked at booking.menu.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
