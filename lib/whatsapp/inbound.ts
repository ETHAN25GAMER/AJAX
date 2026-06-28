import crypto from "node:crypto";
import { graphUrl, whatsappConfig } from "./client";

export type InboundMessage = {
  phone: string;          // E.164 with leading "+"
  whatsappFrom: string;   // Same as phone — kept for API parity with replies
  text: string;
  mediaUrls: string[];    // base64 data: URLs (image already fetched via Graph with bearer auth)
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
};

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;

export async function parseInbound(body: WhatsAppWebhookBody): Promise<InboundMessage | null> {
  const change = body.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  if (!message?.from) return null;

  const phone = message.from.startsWith("+") ? message.from : `+${message.from}`;

  let text = "";
  const mediaIds: string[] = [];
  let caption: string | undefined;

  if (message.type === "text") {
    text = message.text?.body ?? "";
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

  return { phone, whatsappFrom: phone, text, mediaUrls };
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
