import type { TemplateComponent } from "./outbound";

// Language code of the approved templates (must match the Meta submission).
export const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG ?? "en";

// Approved WhatsApp template names. ANY message sent outside Meta's 24-hour
// customer-service window must use a pre-approved template — free-form text is
// rejected (error 131047 / 132001). Every send below fires on a schedule or
// day-of, so it can't rely on the window being open.
//
// Names default to our reference templates and are env-overridable so each
// client maps to the templates approved in their own WhatsApp Business account.
// The param order in the comments MUST match the {{n}} placeholders in the
// approved template body — see docs/onboarding/whatsapp-templates.md.
export const TEMPLATES = {
  /** Day-before reminder. Body: 1=first name, 2=date & time, 3=confirmation code. */
  reminder: process.env.WHATSAPP_TEMPLATE_REMINDER ?? "appointment_reminder_v1",
  /**
   * Day-before reminder with quick-reply buttons [Confirm] [Reschedule]
   * [Cancel]. Body params as `reminder`; the three button payloads are set at
   * send time (rem:confirm:<id> / rem:resched:<id> / rem:cancel:<id>) and a
   * tap OPENS the 24h service window, enabling the follow-up slot list.
   * Unset/unapproved → the reminders cron falls back to the text `reminder`.
   */
  reminderButtons: process.env.WHATSAPP_TEMPLATE_REMINDER_BUTTONS ?? "",
  /** Tech en-route. Body: 1=first name, 2=technician name. URL button: dynamic suffix = tracking token. */
  enRoute: process.env.WHATSAPP_TEMPLATE_EN_ROUTE ?? "technician_en_route_v1",
  /** Internal alert to the escalation phone. Body: 1=urgency, 2=customer phone, 3=summary. */
  escalation: process.env.WHATSAPP_TEMPLATE_ESCALATION ?? "internal_escalation_v1",
  /** AMC renewal reminder. Body: 1=first name, 2=pest_type/plan name, 3=renews_at (friendly date). */
  amcRenewal: process.env.WHATSAPP_TEMPLATE_AMC_RENEWAL ?? "amc_renewal_v1",
  /** AMC renewal follow-up. Body: 1=first name, 2=pest_type/plan name, 3=renews_at. */
  amcRenewalFollowup: process.env.WHATSAPP_TEMPLATE_AMC_RENEWAL_FOLLOWUP ?? "amc_renewal_followup_v1",
  /** AMC upsell to non-AMC customers. Body: 1=first name, 2=plan label, 3=pricing label. */
  amcUpsell: process.env.WHATSAPP_TEMPLATE_AMC_UPSELL ?? "amc_upsell_v1"
} as const;

// First name from a possibly-null full name, with a friendly fallback.
export function firstName(name: string | null | undefined): string {
  const t = name?.trim();
  return t ? t.split(/\s+/)[0] : "there";
}

// Build a single body component from positional text params ({{1}}, {{2}}, …).
export function textBody(...params: string[]): TemplateComponent[] {
  return [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }];
}

// Body params plus quick-reply button payloads (one per button, in order).
// Each payload comes back verbatim as message.type "button" when tapped — the
// flow engine routes on it (e.g. "rem:confirm:<appointment id>").
export function bodyWithQuickReplies(
  bodyParams: string[],
  payloads: string[]
): TemplateComponent[] {
  return [
    { type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) },
    ...payloads.map(
      (payload, i): TemplateComponent => ({
        type: "button",
        sub_type: "quick_reply",
        index: String(i),
        parameters: [{ type: "payload", payload }]
      })
    )
  ];
}

// Body params plus a dynamic URL button. The template's button must be a
// "Visit website" → Dynamic URL whose base is the client's app domain ending in
// `/track/{{1}}`; `urlSuffix` fills that {{1}} (here, the tracking token).
export function bodyWithUrlButton(bodyParams: string[], urlSuffix: string): TemplateComponent[] {
  return [
    { type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlSuffix }] }
  ];
}
