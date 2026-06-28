import { NextResponse } from "next/server";
import { after } from "next/server";
import { handleVerification, parseInbound, verifyMetaSignature } from "@/lib/whatsapp/inbound";
import {
  applyOptIntent,
  detectOptIntent,
  OPT_IN_REPLY,
  OPT_OUT_REPLY
} from "@/lib/whatsapp/opt-out";
import { sendWhatsApp } from "@/lib/whatsapp/outbound";
import {
  getOrCreateCustomer,
  loadConversationHistory,
  saveConversationHistory
} from "@/lib/supabase/client";
import { runAgent } from "@/lib/claude/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    try {
      console.log("[whatsapp DEBUG] raw inbound =>", JSON.stringify(body)?.slice(0, 500));
      const msg = await parseInbound(body as Parameters<typeof parseInbound>[0]);
      console.log("[whatsapp DEBUG] parseInbound =>", JSON.stringify(msg));
      if (!msg?.phone) return;

      const customer = await getOrCreateCustomer(msg.phone);

      // Honour STOP/START before anything else — record the choice and confirm,
      // without running the agent.
      const intent = detectOptIntent(msg.text);
      if (intent) {
        await applyOptIntent(customer.id, intent);
        await sendWhatsApp(msg.whatsappFrom, intent === "opt_out" ? OPT_OUT_REPLY : OPT_IN_REPLY);
        return;
      }

      const history = await loadConversationHistory(customer.id);

      const { replyText, updatedHistory } = await runAgent({
        history: history as never,
        userText: msg.text,
        mediaUrls: msg.mediaUrls,
        ctx: { customerPhone: msg.phone }
      });

      console.log("[whatsapp DEBUG] agent reply for", msg.whatsappFrom, "=>", JSON.stringify(replyText)?.slice(0, 300));

      await saveConversationHistory(customer.id, updatedHistory);
      const sendResult = await sendWhatsApp(msg.whatsappFrom, replyText);
      console.log("[whatsapp DEBUG] graph send result =>", JSON.stringify(sendResult)?.slice(0, 300));
    } catch (err) {
      console.error("[whatsapp webhook] agent failed", err);
    }
  });

  return new NextResponse("", { status: 200 });
}
