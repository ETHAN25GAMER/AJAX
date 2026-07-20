# WhatsApp Flows setup

Two **endpoint-less** Flows ship with the app (no encrypted data-exchange
endpoint to host — answers come back through the normal webhook as an
`nfm_reply`, parsed in [lib/whatsapp/inbound.ts](../../../lib/whatsapp/inbound.ts)).

| Flow | JSON | Purpose |
|---|---|---|
| Booking intake | [booking-intake.json](booking-intake.json) | One native form (name, address, size, pest, window) instead of six chat turns. Completion is flattened into a message the agent handles through its normal booking tools. |
| Post-visit CSAT | [post-visit-csat.json](post-visit-csat.json) | 1–5 rating + optional comment after a job is marked complete. Stored in `feedback`; 4+ gets the Google-review nudge, ≤3 files an escalation. |

## Publishing (per client, in Meta)

1. WhatsApp Manager → your business → **Flows** → **Create Flow**.
2. Paste the JSON from this folder into the Flow editor; fix any validation
   warnings the editor raises (Meta occasionally tightens component schemas).
3. **Publish** the Flow and copy its **Flow ID**.
4. Set the env vars:
   - `WHATSAPP_FLOW_CSAT_ID` — enables the Flow-based rating ask on job
     completion (without it, the app falls back to a plain "reply 1–5" text).
   - `GOOGLE_REVIEW_URL` — your Google review short-link for 4+ ratings.
5. The booking-intake Flow is designed for entry points you control (e.g. a
   click-to-WhatsApp ad or a template button). Send it with
   `sendFlowToCustomer` ([lib/whatsapp/outbound.ts](../../../lib/whatsapp/outbound.ts));
   completions route automatically.

> Free-form interactive sends (including Flows) require Meta's 24-hour service
> window to be open. Outside the window, attach the Flow to an approved
> template button instead. The CSAT ask fires right after a completed visit;
> if the window is closed the send fails quietly and no rating is requested.
