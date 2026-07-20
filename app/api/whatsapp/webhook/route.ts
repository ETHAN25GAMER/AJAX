import { NextResponse } from "next/server";
import { after } from "next/server";
import { handleVerification, parseInboundMessages, verifyMetaSignature } from "@/lib/whatsapp/inbound";
import type { InboundMessage } from "@/lib/whatsapp/inbound";
import {
  applyOptIntent,
  detectOptIntent,
  OPT_IN_REPLY,
  OPT_OUT_REPLY
} from "@/lib/whatsapp/opt-out";
import { sendWhatsApp } from "@/lib/whatsapp/outbound";
import {
  appendInboundWhilePaused,
  getOrCreateCustomer,
  loadConversationForInbound,
  logMessageEvents,
  saveFlowConversation,
  supabase
} from "@/lib/supabase/client";
import {
  csatThanksText,
  escalateLowRating,
  extractFlowRating,
  intakeToUserText,
  parseBareRating,
  recordCsat
} from "@/lib/feedback";
import { flowEngine } from "@/lib/flows/definitions";
import { parseFlowState } from "@/lib/flows/engine";
import { handleReminderTap, isReminderPayload } from "@/lib/flows/reminder";
import { keywordRoute, routeFreeText } from "@/lib/flows/router";
import { assistantTurnsFor, userTurn } from "@/lib/flows/transcript";
import { deliverSends } from "@/lib/flows/deliver";
import type { FlowContext, FlowState, Send } from "@/lib/flows/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAILURE_REPLY =
  "Sorry — I'm having trouble on my end right now. A member of our team will follow up with you shortly.";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = handleVerification(url.searchParams);
  if (!result.ok) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(result.challenge ?? "", { status: 200 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (process.env.NODE_ENV === "production") {
    const signature = req.headers.get("x-hub-signature-256");
    const ok = verifyMetaSignature({ signature, rawBody });
    if (!ok) return new NextResponse("Invalid signature", { status: 403 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Acknowledge to Meta immediately; do agent work in background so the webhook
  // returns inside Meta's response window even on multi-step tool chains.
  after(async () => {
    let messages: InboundMessage[];
    try {
      messages = await parseInboundMessages(body as Parameters<typeof parseInboundMessages>[0]);
    } catch (err) {
      console.error("[whatsapp webhook] parse failed", err);
      return;
    }

    // Sequential on purpose: rapid double-texts from one customer must not run
    // the agent concurrently against the same conversation history.
    for (const msg of messages) {
      try {
        await handleMessage(msg);
      } catch (err) {
        console.error("[whatsapp webhook] agent failed", err);
        await notifyFailure(msg).catch((e) =>
          console.error("[whatsapp webhook] failure fallback also failed", e)
        );
      }
    }
  });

  return new NextResponse("", { status: 200 });
}

async function handleMessage(msg: InboundMessage) {
  if (!msg.phone) return;
  const inboundAt = new Date(); // SLA anchor: when we accepted the message

  // Idempotency: Meta redelivers webhooks it thinks failed. Claim the message
  // id before doing any work; a 23505 means another delivery already ran it.
  if (msg.id) {
    const claimed = await supabase().from("wa_messages").insert({ id: msg.id });
    if (claimed.error) {
      if (claimed.error.code === "23505") return; // duplicate delivery
      throw claimed.error;
    }
  }

  const customer = await getOrCreateCustomer(msg.phone);

  // Click-to-WhatsApp ad attribution — FIRST-TOUCH ONLY. The ad that actually
  // acquired the customer is stamped once; later ad clicks never overwrite it.
  if (msg.referral && !customer.acquisition) {
    await supabase()
      .from("customers")
      .update({ acquisition: msg.referral, acquired_at: new Date().toISOString() })
      .eq("id", customer.id)
      .is("acquisition", null); // race-safe: only the first writer wins
  }

  // Honour STOP/START before anything else — record the choice and confirm,
  // without running the agent.
  const intent = detectOptIntent(msg.text);
  if (intent) {
    await applyOptIntent(customer.id, intent);
    await sendWhatsApp(msg.whatsappFrom, intent === "opt_out" ? OPT_OUT_REPLY : OPT_IN_REPLY);
    return;
  }

  // Completed Meta-Flow forms (nfm_reply) route deterministically.
  let userText = msg.text;
  if (msg.flowResponse) {
    const csat = extractFlowRating(msg.flowResponse.fields);
    if (csat) {
      const result = await recordCsat(customer.id, csat.rating, csat.comment);
      if (result.stored) {
        await escalateLowRating(customer.id, csat.rating);
        await sendWhatsApp(msg.whatsappFrom, csatThanksText(csat.rating));
        await logMessageEvents(customer.id, [
          { direction: "inbound", at: inboundAt },
          { direction: "outbound_agent", at: new Date() }
        ]);
        return;
      }
    }
    // Any other completed Meta-Flow form: keep the answers in the transcript;
    // the MCQ engine below re-anchors the customer at the menu.
    userText = intakeToUserText(msg.flowResponse.fields);
  } else if (!msg.interactiveReply) {
    // Plain-text CSAT fallback: a bare "1".."5" while a rating request is
    // outstanding counts as the rating, not as an answer for the flows.
    const rating = parseBareRating(msg.text);
    if (rating !== null) {
      const result = await recordCsat(customer.id, rating, null);
      if (result.stored) {
        await escalateLowRating(customer.id, rating);
        await sendWhatsApp(msg.whatsappFrom, csatThanksText(rating));
        await logMessageEvents(customer.id, [
          { direction: "inbound", at: inboundAt },
          { direction: "outbound_agent", at: new Date() }
        ]);
        return;
      }
    }
  }

  const { history, agentPaused, flowState: rawFlowState } =
    await loadConversationForInbound(customer.id);

  // A human has taken over this thread from the admin console: record the
  // message so it appears there, but stay silent — flows are suspended until
  // the admin resumes, exactly as the agent was.
  if (agentPaused) {
    await appendInboundWhilePaused(customer.id, userText, msg.mediaUrls);
    // The staff reply (outbound_staff) is logged by sendStaffReply when it comes.
    await logMessageEvents(customer.id, [{ direction: "inbound", at: inboundAt }]);
    return;
  }

  // ---- Deterministic MCQ flow routing (no LLM on the tap path) --------------
  const ctx: FlowContext = { customerPhone: msg.phone, customerId: customer.id };
  const engine = flowEngine();
  const flowState = parseFlowState(rawFlowState);

  let result: { sends: Send[]; state: FlowState | null };
  let transcriptUserText = userText;

  if (msg.interactiveReply && isReminderPayload(msg.interactiveReply.id)) {
    // Reminder template quick-reply: Confirm / Reschedule / Cancel.
    transcriptUserText = msg.interactiveReply.title || msg.interactiveReply.id;
    result = await handleReminderTap(ctx, msg.interactiveReply.id);
  } else if (msg.interactiveReply) {
    transcriptUserText = msg.interactiveReply.title || msg.interactiveReply.id;
    if (flowState) {
      const advanced = await engine.advance(ctx, flowState, {
        kind: "tap",
        id: msg.interactiveReply.id,
        title: msg.interactiveReply.title
      });
      // A tap never needs the router; guard defensively anyway.
      result =
        advanced.outcome === "sent"
          ? { sends: advanced.sends, state: advanced.state }
          : await engine.represent(ctx, advanced.state);
    } else {
      // Tap on a stale message after the flow ended — start over at the menu.
      result = await engine.start(ctx, "booking");
    }
  } else if (userText.trim() === "" && msg.mediaUrls.length > 0) {
    // Photo/media without text: flows can't consume it — say so, re-anchor.
    const anchor = flowState
      ? await engine.represent(ctx, flowState)
      : await engine.start(ctx, "booking");
    transcriptUserText = "[customer sent a photo]";
    result = {
      sends: [
        {
          kind: "text",
          body: "I can't assess photos in chat — pick an option below and our technician will take a look on-site."
        },
        ...anchor.sends
      ],
      state: anchor.state
    };
  } else {
    // Free text. Keyword shortcut first (hi/menu/…), then the flow's own text
    // nodes, then the AI router — which only classifies, never chats.
    const keyword = keywordRoute(userText);
    if (keyword?.action === "menu" || !flowState) {
      result = await engine.start(ctx, "booking");
    } else {
      const advanced = await engine.advance(ctx, flowState, { kind: "text", text: userText });
      if (advanced.outcome === "sent") {
        result = { sends: advanced.sends, state: advanced.state };
      } else {
        const verdict = await routeFreeText(advanced.state, userText);
        if (verdict.action === "select") {
          result = await engine.selectOption(ctx, advanced.state, verdict.optionId);
        } else if (verdict.action === "menu") {
          result = await engine.start(ctx, "booking");
        } else if (verdict.action === "escalate") {
          result = await engine.start(ctx, "booking", "escalate", advanced.state.data);
        } else {
          result = await engine.represent(ctx, advanced.state);
        }
      }
    }
  }

  // ---- Deliver, persist transcript + flow position, log SLA ------------------
  await deliverSends(msg.whatsappFrom, result.sends);

  const updatedHistory = [
    ...history,
    userTurn(transcriptUserText || "(empty message)"),
    ...assistantTurnsFor(result.sends)
  ];
  await saveFlowConversation(customer.id, updatedHistory, result.state);

  await logMessageEvents(customer.id, [
    { direction: "inbound", at: inboundAt },
    ...(result.sends.length > 0
      ? [{ direction: "outbound_agent" as const, at: new Date() }]
      : [])
  ]);
}


// The agent crashed after we accepted the message. Tell the customer instead of
// going silent, and surface it to staff as an escalation so someone follows up.
async function notifyFailure(msg: InboundMessage) {
  if (!msg.whatsappFrom) return;
  await sendWhatsApp(msg.whatsappFrom, FAILURE_REPLY);
  try {
    const customer = await getOrCreateCustomer(msg.phone);
    await supabase().from("escalations").insert({
      customer_id: customer.id,
      summary: "Automated: the WhatsApp agent failed while handling this customer's message. Please follow up manually.",
      urgency: "normal"
    });
  } catch (err) {
    console.error("[whatsapp webhook] failure escalation insert failed", err);
  }
}
