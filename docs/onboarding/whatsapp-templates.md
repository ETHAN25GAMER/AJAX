# WhatsApp Message Templates — submit & approve

WhatsApp only allows **free-form** messages within 24 hours of the customer's last message. Every **proactive** message Ajax sends (reminders, re-engagement, en-route alerts, AMC renewals, internal escalations) fires on a schedule or day-of, so it **must** use a Meta-approved template — otherwise it fails with error `131047` / `132001` and the customer gets nothing.

These templates are created once per client, in **their** WhatsApp Business account (Meta Business Manager → WhatsApp Manager → Message Templates), and usually approve within minutes to a few hours. **Do this in Phase 2 — approval is a go-live gate.**

## How the code uses them
- Template **names** and the **language** are read from env via [lib/whatsapp/templates.ts](../../lib/whatsapp/templates.ts). Defaults match the names below; override per client with the `WHATSAPP_TEMPLATE_*` vars if the client's approved names differ.
- The **body parameter order is fixed by the code.** When you build each template in Meta, the `{{1}}`, `{{2}}`, `{{3}}` placeholders **must appear in the order listed** or customers get the right words in the wrong slots.
- Set `WHATSAPP_TEMPLATE_LANG` to match the language you submit (default `en`).

## The templates

| Default name (env var) | Category | Body `{{n}}` order | Suggested body text |
|---|---|---|---|
| `appointment_reminder_v1` (`WHATSAPP_TEMPLATE_REMINDER`) | Utility | 1 first name · 2 date & time · 3 code | `Hi {{1}}, a reminder of your pest control visit on {{2}}. Booking code: {{3}}. Reply here to reschedule.` |
| `checkin_nudge_v1` (`WHATSAPP_TEMPLATE_NUDGE`) | **Marketing** | 1 first name | `Hi {{1}}, just checking back — we're still here whenever you're ready to pick this up. No rush.` |
| `technician_en_route_v1` (`WHATSAPP_TEMPLATE_EN_ROUTE`) | Utility | **Body:** 1 first name · 2 technician. **+ URL button** (see below) | `Hi {{1}}, your technician {{2}} is on the way. Tap below to follow their arrival live.` |
| `internal_escalation_v1` (`WHATSAPP_TEMPLATE_ESCALATION`) | Utility | 1 urgency · 2 customer phone · 3 summary | `New {{1}} escalation from {{2}}: {{3}}` |
| `amc_renewal_v1` (`WHATSAPP_TEMPLATE_AMC_RENEWAL`) | Utility | 1 first name · 2 plan · 3 renewal date | `Hi {{1}}, your {{2}} maintenance plan is due for renewal on {{3}}. Reply to confirm and we'll handle it.` |
| `amc_renewal_followup_v1` (`WHATSAPP_TEMPLATE_AMC_RENEWAL_FOLLOWUP`) | Utility | 1 first name · 2 plan · 3 renewal date | `Hi {{1}}, following up on your {{2}} plan renewal due {{3}}. Want us to go ahead?` |
| `amc_upsell_v1` (`WHATSAPP_TEMPLATE_AMC_UPSELL`) | **Marketing** | 1 first name · 2 plan label · 3 pricing label | `Hi {{1}}, want year-round protection? Our {{2}} covers you for {{3}}. Reply to hear more.` |

## Notes
- **Marketing vs Utility matters.** Marketing templates (`nudge`, `amc_upsell`) are subject to the customer's STOP opt-out — the code already blocks those for opted-out customers. Utility/transactional templates still send (the opt-out reply explicitly says booked-visit messages keep coming).
- **The en-route template uses a URL button** (not a body link — buttons pass Meta review more reliably). When building it in WhatsApp Manager:
  - Add a button → **Visit website** → URL type **Dynamic**.
  - Set the URL to the client's deployed app domain followed by `/track/{{1}}`, e.g. `https://app.greenshield.sg/track/{{1}}` — the **base must match `NEXT_PUBLIC_APP_URL`** for that client.
  - Button label: e.g. "Track live".
  - Sample value for the button `{{1}}`: any string (e.g. `abc123`).
  - The code fills that `{{1}}` with the tracking **token only** — so the base URL lives in the template, the token comes from the send. Get the base wrong and every tracking link 404s.
- **Languages:** if the client needs Mandarin/Malay/Tamil, submit a localized version of each template under the *same name* with the extra language, and the API will pick it by `WHATSAPP_TEMPLATE_LANG` (or we localize per customer later).
- Keep the wording close to the suggestions — wildly promotional Utility templates get downgraded to Marketing or rejected by Meta.
