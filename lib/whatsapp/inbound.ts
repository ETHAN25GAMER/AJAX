import crypto from "node:crypto";
import { graphUrl, whatsappConfig } from "./client";

export type InboundMessage = {
  id: string | null;      // Meta message id (wamid.…) — used for idempotency
  phone: string;          // E.164 with leading "+"
  whatsappFrom: string;   // Same as phone — kept for API parity with replies
  text: string;
  mediaUrls: string[];    // base64 data: URLs (image already fetched via Graph with bearer auth)
  // Completed WhatsApp Flow (interactive nfm_reply): the parsed response_json
  // plus the flow_token we sent with the flow, so the webhook can route it.
  flowResponse: { token: string | null; fields: Record<string, unknown> } | null;
  // Present when the message originated from a click-to-WhatsApp ad — Meta
  // attaches the ad's identity. Used for first-touch acquisition attribution.
  referral: {
    source_type: string | null;
    source_id: string | null;
    source_url: string | null;
    headline: string | null;
  } | null;
  // A tap on one of OUR options: interactive button_reply / list_reply, or a
  // template quick-reply button (whose payload we set at send time). The id is
  // ours, so the flow engine routes on it exactly — no interpretation needed.
  interactiveReply: { id: string; title: string } | null;
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        messages?: Array<WhatsAppInboundMessage>;
        contacts?: Array<{ wa_id?: string }>;
        statuses?: unknown;
      };
    }>;
  }>;
};

type WhatsAppInboundMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  audio?: { id?: string };
  document?: { id?: string; caption?: string };
  sticker?: { id?: string };
  interactive?: {
    type?: string;
    nfm_reply?: { name?: string; body?: string; response_json?: string };
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  // Template quick-reply button tap (payload set by us at send time).
  button?: { payload?: string; text?: string };
  referral?: {
    source_type?: string;
    source_id?: string;
    source_url?: string;
    headline?: string;
  };
};

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;

// Meta batches webhooks: one POST can carry several entries, each with several
// changes, each with several messages (rapid double-texts from one customer,
// or messages from different customers delivered together). Parse them all —
// handling only entry[0].changes[0].messages[0] silently drops the rest.
export async function parseInboundMessages(body: WhatsAppWebhookBody): Promise<InboundMessage[]> {
  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const parsed = await parseOneMessage(message);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

async function parseOneMessage(message: WhatsAppInboundMessage): Promise<InboundMessage | null> {
  if (!message.from) return null;

  const phone = message.from.startsWith("+") ? message.from : `+${message.from}`;

  let text = "";
  const mediaIds: string[] = [];
  let caption: string | undefined;
  let flowResponse: InboundMessage["flowResponse"] = null;
  let interactiveReply: InboundMessage["interactiveReply"] = null;

  if (message.type === "text") {
    text = message.text?.body ?? "";
  } else if (
    message.type === "interactive" &&
    (message.interactive?.type === "button_reply" || message.interactive?.type === "list_reply")
  ) {
    // A tap on an in-chat button/list we sent. The id routes deterministically.
    const reply =
      message.interactive.type === "button_reply"
        ? message.interactive.button_reply
        : message.interactive.list_reply;
    if (reply?.id) {
      interactiveReply = { id: reply.id, title: reply.title ?? "" };
      text = reply.title ?? ""; // transcript-friendly fallback
    }
  } else if (message.type === "button" && message.button?.payload) {
    // Template quick-reply tap (e.g. the reminder's Confirm/Reschedule/Cancel).
    interactiveReply = { id: message.button.payload, title: message.button.text ?? "" };
    text = message.button.text ?? "";
  } else if (message.type === "interactive" && message.interactive?.type === "nfm_reply") {
    // A completed WhatsApp Flow. response_json carries the collected answers;
    // flow_token (echoed from the send) rides inside it as well.
    const raw = message.interactive.nfm_reply?.response_json;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const token = typeof parsed.flow_token === "string" ? parsed.flow_token : null;
        delete parsed.flow_token;
        flowResponse = { token, fields: parsed };
      } catch (err) {
        console.error("[whatsapp inbound] nfm_reply parse failed", err);
      }
    }
  } else {
    for (const t of MEDIA_TYPES) {
      const part = (message as Record<string, { id?: string; caption?: string } | undefined>)[t];
      if (part?.id) {
        mediaIds.push(part.id);
        caption = caption ?? part.caption;
      }
    }
    if (caption) text = caption;
  }

  const mediaUrls: string[] = [];
  for (const id of mediaIds) {
    try {
      const url = await resolveMediaUrl(id);
      if (url) mediaUrls.push(url);
    } catch (err) {
      console.error("[whatsapp inbound] media resolve failed", id, err);
    }
  }

  const referral = message.referral
    ? {
        source_type: message.referral.source_type ?? null,
        source_id: message.referral.source_id ?? null,
        source_url: message.referral.source_url ?? null,
        headline: message.referral.headline ?? null
      }
    : null;

  return {
    id: message.id ?? null,
    phone,
    whatsappFrom: phone,
    text,
    mediaUrls,
    flowResponse,
    referral,
    interactiveReply
  };
}

async function resolveMediaUrl(mediaId: string): Promise<string | null> {
  const cfg = whatsappConfig();
  const meta = await fetch(graphUrl(mediaId, cfg.graphVersion), {
    headers: { Authorization: `Bearer ${cfg.accessToken}` }
  });
  if (!meta.ok) return null;
  const info = (await meta.json()) as { url?: string; mime_type?: string };
  if (!info.url) return null;

  // Meta's media URLs require the same bearer token to download. Fetch the bytes
  // server-side and hand back a data: URL so downstream consumers (Claude vision)
  // can use the image without re-authenticating.
  const blob = await fetch(info.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
  if (!blob.ok) return null;
  const mime = info.mime_type || blob.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await blob.arrayBuffer());
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export function verifyMetaSignature(opts: {
  signature: string | null;
  rawBody: string;
}): boolean {
  if (!opts.signature) return false;
  const cfg = whatsappConfig();
  const expected =
    "sha256=" + crypto.createHmac("sha256", cfg.appSecret).update(opts.rawBody).digest("hex");
  const a = Buffer.from(opts.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function handleVerification(searchParams: URLSearchParams): { ok: boolean; challenge?: string } {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode !== "subscribe") return { ok: false };
  const cfg = whatsappConfig();
  if (token !== cfg.verifyToken) return { ok: false };
  return { ok: true, challenge: challenge ?? "" };
}
