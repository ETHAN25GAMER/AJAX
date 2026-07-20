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
  | { type: "date_time"; date_time: { fallback_value: string } }
  // Quick-reply button payload — echoed back verbatim when the button is tapped.
  | { type: "payload"; payload: string };

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

// --- Interactive MCQ messages (buttons / lists) ----------------------------
// The building blocks of the deterministic flow engine (lib/flows/). Free-form
// interactive sends require Meta's 24h service window — outside it, use an
// approved template with quick-reply buttons instead. Ids are ours and come
// back verbatim in the reply, so routing needs no interpretation.

export type McqButton = { id: string; title: string }; // title ≤ 20 chars (Meta)
export type McqListRow = { id: string; title: string; description?: string };

export async function sendWhatsAppButtons(
  to: string,
  bodyText: string,
  buttons: McqButton[] // Meta max: 3
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
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) }
          }))
        }
      }
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp buttons send failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

export async function sendWhatsAppList(
  to: string,
  bodyText: string,
  buttonLabel: string, // the button that opens the list, ≤ 20 chars
  rows: McqListRow[] // Meta max: 10
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
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonLabel.slice(0, 20),
          sections: [
            {
              rows: rows.slice(0, 10).map((r) => ({
                id: r.id,
                title: r.title.slice(0, 24),
                ...(r.description ? { description: r.description.slice(0, 72) } : {})
              }))
            }
          ]
        }
      }
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp list send failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

// --- WhatsApp Flows (endpoint-less) ---------------------------------------
// Interactive flow messages open a native form inside WhatsApp; the completed
// answers come back through the normal webhook as an nfm_reply (parsed in
// lib/whatsapp/inbound.ts). Free-form interactive sends require Meta's 24h
// service window to be open — outside it, use an approved template with a
// flow button instead. Flow JSON lives in docs/onboarding/flows/.

export async function sendWhatsAppFlow(
  to: string,
  opts: {
    flowId: string;
    bodyText: string;
    ctaText: string;
    /** Opaque token echoed back in the nfm_reply — route completions with it. */
    flowToken?: string;
    /** First screen id (defaults to the flow's entry screen). */
    screen?: string;
    /** Initial data passed to the first screen. */
    data?: Record<string, unknown>;
  }
) {
  const cfg = whatsappConfig();
  const dest = to.replace(/^whatsapp:/, "").replace(/^\+/, "");

  const actionPayload: Record<string, unknown> = {};
  if (opts.screen) actionPayload.screen = opts.screen;
  if (opts.data) actionPayload.data = opts.data;

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
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: opts.bodyText },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_id: opts.flowId,
            flow_cta: opts.ctaText,
            ...(opts.flowToken ? { flow_token: opts.flowToken } : {}),
            ...(Object.keys(actionPayload).length > 0
              ? { flow_action: "navigate", flow_action_payload: actionPayload }
              : {})
          }
        }
      }
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp flow send failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

// Preferred entry point for any flow send to a customer. Same opt-out gate as
// the text-message wrapper.
export async function sendFlowToCustomer(
  customer: CustomerForSend,
  opts: Parameters<typeof sendWhatsAppFlow>[1],
  sendOpts: { kind: MessageKind }
): Promise<SendGate> {
  const gate = canSendWhatsApp(customer, sendOpts.kind);
  if (!gate.ok) return gate;
  await sendWhatsAppFlow(customer.phone, opts);
  return { ok: true };
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
