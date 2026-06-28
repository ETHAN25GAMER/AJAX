import { graphUrl, whatsappConfig } from "./client";

// Every outbound message to a customer must declare its intent. The opt-out
// flag on customers (set via STOP) blocks promotional only — transactional
// messages (booking confirmations, day-of reminders, en-route tracking) are
// exempt because the customer has an active service relationship and the
// opt-out reply we send explicitly promises those will still arrive.
export type MessageKind = "transactional" | "promotional";

export type CustomerForSend = {
  phone: string;
  opted_out?: boolean | null;
};

export type SendGate = { ok: true } | { ok: false; reason: "opted_out" | "no_phone" };

export function canSendWhatsApp(customer: CustomerForSend, kind: MessageKind): SendGate {
  if (!customer.phone) return { ok: false, reason: "no_phone" };
  if (kind === "promotional" && customer.opted_out) {
    return { ok: false, reason: "opted_out" };
  }
  return { ok: true };
}

// Preferred entry point for any outbound to a customer. Forces the caller to
// declare the message kind so opt-out filtering can't be silently bypassed.
// Returns the gate result so callers can branch / log skips uniformly.
export async function sendWhatsAppToCustomer(
  customer: CustomerForSend,
  body: string,
  opts: { kind: MessageKind }
): Promise<SendGate> {
  const gate = canSendWhatsApp(customer, opts.kind);
  if (!gate.ok) return gate;
  await sendWhatsApp(customer.phone, body);
  return { ok: true };
}

export async function sendWhatsApp(to: string, body: string) {
  const cfg = whatsappConfig();
  const dest = to.replace(/^whatsapp:/, "").replace(/^\+/, "");

  const res = await fetch(graphUrl(`${cfg.phoneNumberId}/messages`, cfg.graphVersion), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: dest,
      type: "text",
      text: { preview_url: false, body }
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

// --- Template messages -----------------------------------------------------
// Required for any send outside Meta's 24h conversation window (renewal
// reminders, upsell pitches, etc.). The named template must be approved in
// Meta Business Manager; sends will fail with code 132001 until then.

export type TemplateParam =
  | { type: "text"; text: string }
  | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: "date_time"; date_time: { fallback_value: string } };

export type TemplateComponent =
  | { type: "body"; parameters: TemplateParam[] }
  | { type: "header"; parameters: TemplateParam[] }
  | { type: "button"; sub_type: "url" | "quick_reply"; index: string; parameters: TemplateParam[] };

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[]
) {
  const cfg = whatsappConfig();
  const dest = to.replace(/^whatsapp:/, "").replace(/^\+/, "");

  const res = await fetch(graphUrl(`${cfg.phoneNumberId}/messages`, cfg.graphVersion), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: dest,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components
      }
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp template send failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

// Preferred entry point for any template send to a customer. Same opt-out gate
// as the text-message wrapper.
export async function sendTemplateToCustomer(
  customer: CustomerForSend,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[],
  opts: { kind: MessageKind }
): Promise<SendGate> {
  const gate = canSendWhatsApp(customer, opts.kind);
  if (!gate.ok) return gate;
  await sendWhatsAppTemplate(customer.phone, templateName, languageCode, components);
  return { ok: true };
}
