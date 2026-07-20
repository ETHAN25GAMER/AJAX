# PestLLM — Codebase Overview

> A technical walkthrough of the whole project: what it is, how the pieces fit
> together, and where to look when you need to change something. Written to be
> read top-to-bottom by someone new to the repo. For setup/deploy steps see the
> root [README.md](../README.md).

---

## 1. What this product is

PestLLM is a **WhatsApp-first AI agent for a pest-control business**. The
customer-facing brand is *GreenShield Pest Control*; the assistant introduces
itself as *"Ajax 1.0"*. A customer messages the company's WhatsApp number and an
LLM (Claude, or any Anthropic-compatible model) runs the entire conversation:

- quotes prices,
- identifies pests from a photo,
- books / reschedules / cancels appointments,
- handles Annual Maintenance Contracts (AMC — renewals & new subscriptions),
- escalates to a human when something is unsafe or out of scope.

Behind that chat sit two web apps and several background jobs:

| Who | Surface | Purpose |
|---|---|---|
| **Customer** | WhatsApp + `/track/[token]`, `/privacy` | The conversation; a live technician-tracking page; a privacy notice. |
| **Staff (admin)** | `/admin/*` | Dashboard, appointments, conversations, dispatch, escalation triage, pricing editor, user management, KPI analytics. |
| **Technician** | `/tech/*` | Installable mobile PWA: today's jobs, job detail (photos, complete), live GPS sharing, escalations, profile. |
| **System** | `/api/cron/*` | Scheduled outreach: reminders, nudges, AMC lifecycle, data-retention purge. |

The app targets the **India market**: all times render in `Asia/Kolkata` (IST,
UTC+5:30, no DST) and it ships DPDP-Act-aware privacy, opt-out handling, and a
retention cron.

---

## 2. Tech stack

- **Next.js 15** (App Router, Server Actions, route handlers) · **React 19** · **TypeScript** · **Tailwind**
- **Anthropic SDK** (`@anthropic-ai/sdk`) — tool-use agent; model is env-driven (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`). A separate faster/vision model handles pest photos.
- **Supabase** — Postgres, Auth, Storage (`job-photos` bucket), Realtime. **Row-Level Security (RLS) is the real security boundary.**
- **WhatsApp Cloud API** (Meta Graph `v23.0`) — inbound webhook + outbound text & template messages.
- **Vercel** — hosting + cron scheduling ([vercel.json](../vercel.json)).
- Optional: **LiteLLM** proxy ([litellm-config.yaml](../litellm-config.yaml)) to run against a local Ollama model in dev without an Anthropic key.

---

## 3. The big picture (request flow)

```
Customer (WhatsApp)
     │
     ▼
Meta WhatsApp Cloud API
     │  POST (webhook)
     ▼
app/api/whatsapp/webhook/route.ts
     │  • verify Meta signature (prod)
     │  • ACK Meta immediately (200), then run work in after()
     │  • dedup by message id (wa_messages table)
     │  • handle STOP/START opt-out before the agent
     ▼
lib/claude/agent.ts  →  runAgent()          ← tool-use loop, ≤ 6 iterations
     │  • system prompt = 6 skills + critical rules (cached)
     │  • + per-turn IST "now" anchor (uncached)
     │  • Claude decides: reply, or call a tool
     ▼
lib/claude/tools.ts  →  dispatchTool()       ← 11 tools, one file each in lib/tools/
     │
     ▼
Supabase (Postgres · RLS · Storage · Realtime)
     ▲
     │  Admin console (/admin/*) and Technician PWA (/tech/*) read/write the same DB.
     │  Realtime feeds dispatch + escalations live.
```

Two concepts drive the agent's behaviour, and they are deliberately separate:

- **Skills** = *instructions* ([skills/*.md](../skills/)). Markdown files
  concatenated into the cached system prompt. **No code runs.** They shape how
  the agent talks and when it should reach for a tool.
- **Tools** = *code Claude can call* ([lib/tools/*.ts](../lib/tools/)). Each has a
  JSON schema in [lib/claude/tools.ts](../lib/claude/tools.ts) and a dispatcher
  entry. This is where anything with a side effect (DB writes, sends) lives.

---

## 4a. The MCQ flow engine — `lib/flows/` (the customer path today)

> As of migration `0021`, customers no longer talk to the free-form agent. Every
> conversation is a **deterministic MCQ flow**: any inbound message opens the
> main menu (buttons), taps drive all transitions (**zero LLM calls**), and the
> only typed answers are text nodes (name / address / confirmation code).

- **Engine** ([lib/flows/engine.ts](../lib/flows/engine.ts)) — walks a declarative
  graph: `prompt` nodes send buttons (≤3) or lists (≤10 rows) and park;
  `action` nodes run effects (the booking tools, escalation) and chain. Resolved
  options are **persisted into `flow_state`**, so a tap on an old message still
  means what the customer saw. Stale/unknown taps re-present the current MCQ.
- **Flows** ([lib/flows/definitions/](../lib/flows/definitions/)) — `booking`
  (menu → pest from the live rate card → size → quote → slots → details →
  confirm → booked + deposit link) and `manage` (pick upcoming booking →
  reschedule / cancel). Both reuse the existing `lib/tools/*` functions with the
  same verified-phone context injection.
- **Router** ([lib/flows/router.ts](../lib/flows/router.ts)) — the only LLM in
  the customer path. When free text arrives at an MCQ, a fast-model, JSON-only
  classification maps it to {select an option / main menu / human}. It **fails
  open** (any error → re-present the MCQ) and never writes customer prose.
  Greetings ("hi", "menu") short-circuit via keywords with no model call.
- **Reminder sequence** ([lib/flows/reminder.ts](../lib/flows/reminder.ts)) —
  the 24h reminder template carries [Confirm ✓][Reschedule][Cancel] quick
  replies (`rem:*` payloads); a tap opens the service window and routes
  deterministically (confirm stamps `reminder_confirmed_at`; reschedule opens a
  live slot list bound to that booking).
- **Transcript** ([lib/flows/transcript.ts](../lib/flows/transcript.ts)) — the
  engine appends MessageParam-shaped turns to `state_json`, so the conversations
  UI, human takeover, SLA logging, and retention are unchanged.

## 4b. The legacy agent loop — `lib/claude/agent.ts` (no longer customer-facing)

`runAgent({ history, userText, mediaUrls, ctx })` is the heart of the product.

1. **Assemble the prompt.** The system message has two blocks:
   - the **cached** block: critical rules + the 6 skills (stable, so Anthropic
     prompt-caching keeps it cheap across turns);
   - an **uncached** "now" block giving the current IST date/time so the model can
     resolve "today"/"tomorrow" without invalidating the cache.
2. **Build the user turn** from `userText` + any inbound photos (base64 image
   blocks). Empty messages get a `(empty message)` placeholder.
3. **Loop up to `MAX_TOOL_ITERATIONS = 6`:** call the model; if it stops with
   `tool_use`, run every requested tool via `dispatchTool`, append the results,
   and loop again. Otherwise collect the text and finish.
4. **Persist a trimmed, image-stripped history.** Two important hygiene steps:
   - `stripImages` replaces stored base64 photos with a text stub — otherwise
     every past photo would be re-sent on every future turn and balloon the
     `conversations.state_json` row.
   - `trimHistory` keeps the last ~30 turns but only ever cuts at a genuine user
     turn, so it never strands a `tool_result` without its matching `tool_use`
     (which the API rejects with a 400).

Anthropic-only features (`thinking`, `cache_control`) are gated behind an
`IS_CLAUDE` flag so a compat backend (Kimi/Ollama via LiteLLM) still works.

### The 6 skills ([skills/](../skills/))
`persona` · `escalation-and-safety` (kept near the top so safety isn't
under-weighted) · `booking-flow` · `pricing-and-quotes` · `pest-identification` ·
`amc`. Assembled by [lib/claude/skills.ts](../lib/claude/skills.ts), which also
prepends **CRITICAL RULES** (never fabricate prices/slots/codes; copy `slot_start`
character-for-character; never claim a booking is confirmed before
`create_appointment` returns a code; escalate on any bite/sting/complaint/safety).

### The 11 tools ([lib/tools/](../lib/tools/))

| Tool | What it does |
|---|---|
| `check_availability` | Open slots in a date range (flat 90-min visits). Must be called before proposing slots. |
| `create_appointment` | Books a slot; returns a 6-char confirmation code. Auto-assigns a technician. |
| `reschedule_appointment` | Moves a booking to a new slot (needs the confirmation code). |
| `cancel_appointment` | Cancels a booking (needs the confirmation code). |
| `get_pricing_quote` | Price range from the `pricing` rate card; flags if an on-site inspection is required. |
| `identify_pest` | Vision — identifies the pest from the customer's inbound photo (or a text description). Uses the faster/vision model. |
| `escalate_to_human` | Flags the conversation for staff (safety, complaints, specialist work). |
| `lookup_customer` | Prior visits / stored details by WhatsApp phone (already in context). |
| `lookup_amc_status` | Whether this customer has an AMC on file, with plan details. |
| `request_amc_renewal` | Customer confirmed renewal → admin escalation + `pending_renewal`. |
| `request_amc_subscription` | New customer wants an annual plan → admin escalation to quote & collect payment. |

**Context injection is a deliberate security pattern.** `dispatchTool` injects
`customer_phone` from the verified WhatsApp sender (`ToolContext`) rather than
letting the model pass it — so the agent can't act on behalf of another customer.
Likewise `identify_pest` pulls the photo from `ctx.mediaUrls`, never from
model-emitted image data (a data-URL round-tripped through tool output would cost
thousands of tokens and be spoofable).

---

## 5. WhatsApp integration — `lib/whatsapp/` + the webhook

**Inbound** ([lib/whatsapp/inbound.ts](../lib/whatsapp/inbound.ts)):
- `handleVerification` answers Meta's GET webhook-verification handshake.
- `verifyMetaSignature` validates `X-Hub-Signature-256` (HMAC, timing-safe) — enforced in production.
- `parseInboundMessages` walks the **full** batch (`entry[] → changes[] → messages[]`); Meta can pack several messages into one POST, so handling only the first would silently drop the rest.
- Media (image/video/audio/document/sticker) is resolved from a Graph media id to a **base64 `data:` URL** server-side (the download needs the same bearer token), so downstream consumers (Claude vision) never re-authenticate.

**The webhook** ([app/api/whatsapp/webhook/route.ts](../app/api/whatsapp/webhook/route.ts)):
- **ACKs Meta immediately** with a 200 and does the real work in Next's
  `after()` — so multi-step tool chains never blow Meta's response window.
- **Idempotency:** claims the Meta message id in the `wa_messages` table; a
  unique-violation (`23505`) means a redelivery already ran it → skip.
- **Opt-out first:** STOP/START is detected and applied *before* the agent runs.
- Processes a customer's messages **sequentially** so rapid double-texts don't
  race on the same conversation history.
- On agent crash, it messages the customer a graceful failure line **and** files
  an escalation so a human follows up (never goes silent).

**Outbound** ([lib/whatsapp/outbound.ts](../lib/whatsapp/outbound.ts)) — the
proactive-messaging safety layer. Every send must declare a **kind**:
- `transactional` (booking confirmations, reminders, en-route, CSAT asks) — always sent;
- `promotional` (nudges, recovery, campaigns, AMC upsell) — **suppressed for opted-out customers**.

`sendWhatsAppToCustomer` / `sendTemplateToCustomer` / `sendFlowToCustomer` force
the caller to pass the kind so opt-out filtering can't be bypassed. Sends outside
Meta's 24-hour window must use pre-approved **templates**
([lib/whatsapp/templates.ts](../lib/whatsapp/templates.ts)).

**Human takeover** — an admin can pause the agent on one conversation
(`conversations.agent_paused`), reply into the live thread from the console
([app/(admin)/admin/conversations/actions.ts](../app/(admin)/admin/conversations/actions.ts)),
and resume. While paused, the webhook records inbound messages but never runs the
agent; staff replies are stored as ordinary assistant turns so the AI's context
stays coherent on resume.

**WhatsApp Flows (endpoint-less)** — native in-chat forms
([docs/onboarding/flows/](onboarding/flows/)): a booking-intake Flow whose
completion is flattened into a message the agent handles through its normal
tools, and a post-visit CSAT Flow (1–5 + comment) triggered when a technician
marks a job complete. Completions arrive as `nfm_reply` and route
deterministically in the webhook; a bare "1".."5" text reply also counts as a
rating while a request is outstanding ([lib/feedback.ts](../lib/feedback.ts)).
Ratings of 4+ get a Google-review nudge; ≤2 file a high-urgency escalation.

**Payments (Razorpay, optional)** — [lib/payments/](../lib/payments/) creates
hosted UPI/card payment links for booking deposits (`RAZORPAY_DEPOSIT_AMOUNT`)
and AMC renewals; the tools return the link for the agent to share, and
`/api/payments/webhook` (signature-verified) marks them paid, thanks the
customer, and files the renewal follow-up escalation. Unset env keys disable the
whole integration cleanly.

---

## 6. Scheduled jobs — `app/api/cron/*` ([vercel.json](../vercel.json))

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/reminders` | hourly | 24h-out appointment reminders (once per booking, tracked via `reminder_sent_at`). |
| `/api/cron/nudges` | every 10 min | One re-engagement nudge for idle threads (free-form; always inside the 24h window). Skips human-held threads and booking-intent threads owned by recovery. |
| `/api/cron/abandoned-bookings` | every 15 min | Personalized recovery for threads with a quote/availability check but no booking ([lib/recovery.ts](../lib/recovery.ts)); once per silence window via `recovery_sent_at`. |
| `/api/cron/campaign-dispatch` | every 5 min | Drains queued broadcast-campaign recipients in batches; flips campaigns to `done`. |
| `/api/cron/journeys` | every 15 min | Journey engine: enrolls new trigger matches (only after the journey's `enabled_at` watermark) and advances due steps — template sends, opt-out cancels the sequence. |
| `/api/cron/retention` | daily 18:00 | DPDP: purge chat logs older than `RETENTION_CONV_MONTHS` (default 6) + prune webhook-dedup rows. |
| `/api/cron/amc` | daily 01:00 | AMC renewal reminders, follow-ups, and upsell pitches. |

All cron routes require `Authorization: Bearer $CRON_SECRET` and **fail closed**
in production — if `CRON_SECRET` is unset they return 503 rather than being
publicly triggerable. Vercel attaches the header automatically.

---

## 7. Data model — `supabase/migrations/`

Apply migrations **in filename order**. Core tables (from
[0001_init.sql](../supabase/migrations/0001_init.sql) onward):

- **`customers`** — phone (unique), name, address, notes; later `opted_out`.
- **`conversations`** — one row per customer; `state_json` holds the trimmed
  agent history; `last_message_at` drives nudges.
- **`appointments`** — `confirmation_code` (unique), pest_type, `slot_start/end`, status
  (`booked|cancelled|completed`), `price_quoted`, plus later
  `assigned_technician_id`, `reminder_sent_at`.
- **`pricing`** — flat rate card keyed by `pest_type` (one row per pest since `0020`): `base_price`,
  `per_sqft`, `requires_inspection`. Seeded with ~11 pest/tier rows.
- **`escalations`** — customer_id, summary, urgency, resolved.

Layered on by later migrations:
- **`profiles`** + RLS (`0002_profiles_and_rls`) — role `admin | technician`; the `is_admin()` helper backs most policies.
- **nudge** column (`0002_nudge`).
- **technician phase** (`0003`) — photos + the `job-photos` Storage bucket.
- **GPS tracking** (`0004`) — `technician_positions`, tracking tokens, trip state.
- **RLS hardening** + **tech column guard** (`0005`, `0006`).
- **opt-out** (`0007`).
- **AMC** (`0008_amc`) — annual maintenance contracts (pest_type, annual_price, renews_at, status).
- **deployment tier** (`0009`) — singleton `deployment_settings` row (removed again by `0016`).
- **db refinement** (`0010`) — indexes + integrity constraints, incl. the DB-level double-booking guard.
- **human takeover** (`0011`) — `agent_paused`/`paused_by`/`paused_at` on conversations + Realtime.
- **abandoned recovery** (`0012`) — `recovery_sent_at` marker on conversations.
- **campaigns** (`0013`) — `campaigns` + `campaign_recipients` (broadcast with segmentation).
- **feedback** (`0014`) — `feedback` (CSAT ratings) + `csat_requested_at` on appointments.
- **payments** (`0015`) — `payments` (Razorpay links: deposits + AMC renewals).
- **CRM** (`0017`) — `customers.tags` (GIN-indexed) + `acquisition`/`acquired_at` (click-to-WhatsApp ad attribution, first-touch only).
- **SLA events** (`0018`) — `message_events`: timestamp + direction log (never content), powering responsiveness KPIs; pruned on the retention clock.
- **journeys** (`0019`) — `journeys` + `journey_steps` + `journey_enrollments` (composable automation sequences, template-only steps).
- **service-tier removal** (`0020`) — flat service: pricing collapses to one row per pest, `service_tier` dropped from pricing and appointments; visits are a single 90-min duration (`VISIT_DURATION_MIN` in `lib/time.ts`).
- **MCQ flows** (`0021`) — `conversations.flow_state` (the customer's position in the deterministic flow graph) + `appointments.reminder_confirmed_at` (reminder Confirm tap).

> **Capacity model:** one booking per slot **globally** (three fixed windows/day),
> enforced by a unique index — regardless of how many technicians exist. Raising
> throughput means moving to per-technician slot capacity.

---

## 8. Web surfaces

### Auth & routing
Supabase Auth + a `profiles.role`. [middleware.ts](../middleware.ts) refreshes the
session cookie and gates `/admin` vs `/tech` by role (and bounces logged-in users
off `/login`). It's a UX/redirect layer only — **RLS is the real boundary.**
New sign-ups default to `technician`; promote your first admin with SQL.

### Admin console — `app/(admin)/admin/*`
Overview dashboard, appointments, **conversations** (transcript viewer with
**human takeover**: pause Ajax, reply live, resume — Realtime-fed), **customers**
(CRM master–detail: tags, notes, estimated LTV, unified timeline of bookings /
escalations / payments / ratings, jump-to-conversation), **campaigns**
(broadcast an approved template to a segment: area / pest history / visit age /
AMC status / tag, with live audience preview), **journeys** (composable
automation: trigger → wait → template → …, enable/disable with an enrollment
watermark so history is never blasted), **dispatch** (assign technicians + live
positions via Realtime), **escalation** triage, **pricing** editor, **user/role**
management, and the **KPI** dashboard (feedback, lead-sources, and
responsiveness sections included).

### Technician PWA — `app/(tech)/tech/*`
Installable mobile app ([app/manifest.ts](../app/manifest.ts)): today's assigned
jobs, job detail (notes, before/after photos to `job-photos`, mark complete),
live **en-route / arrived** GPS sharing, escalations, profile.

### Public
- `/track/[token]` — token-gated live-tracking page. [lib/tracking.ts](../lib/tracking.ts)
  only serves a position that **belongs to this appointment** and is **< 15 min
  old** — defense-in-depth so a stale link can't read the tech's location on a
  later, different customer's job. Links out to Google Maps rather than embedding.
- `/privacy` — DPDP Act notice with configurable company/DPO details ([lib/legal.ts](../lib/legal.ts)).

---

## 9. KPI analytics

> Deployment-tier gating (tier2/tier3) was removed in migration `0016` — every
> deployment now gets every feature, including the KPI dashboard.

**KPI queries** ([lib/kpi/queries.ts](../lib/kpi/queries.ts)) compute funnel,
financial, operational, technician, and AMC metrics over an IST date range
(`week|month|quarter`, with previous-period comparison). Since the booking tool
doesn't record `price_quoted` today, revenue is **estimated** from per-tier
average base prices (`computeTierAverages` / `valueOf`) so figures aren't
perpetually zero.

---

## 10. Supporting libraries — `lib/`

- **`lib/supabase/{server,client,browser,types}.ts`** — three clients for three
  contexts: `server` = anon SSR client (respects RLS), `client` = **service-role**
  (webhook/cron/server, bypasses RLS), `browser` = client-side. `types.ts` holds
  shared DB types (`ServiceTier`, `DeploymentTier`, etc.).
- **`lib/time.ts`** — `BUSINESS_TZ = Asia/Kolkata`, `parseBusinessTime` (IST → UTC Date).
- **`lib/geo.ts`** — geocoding via OpenStreetMap **Nominatim** (no API key); ETAs are straight-line **haversine** estimates.
- **`lib/auto-assign.ts`** — `pickTechnician()` used at booking time.
- **`lib/tracking.ts`** — the position-serving gate described in §8.
- **`lib/legal.ts`**, **`lib/brand.ts`**, **`lib/utils.ts`** — privacy/legal text, brand strings, misc helpers.

---

## 11. Repo map (where to look)

```
app/api/whatsapp/webhook/route.ts   Meta inbound (GET verify + POST); opt-out; hands off to runAgent
app/api/cron/{reminders,nudges,retention,amc}/route.ts   Scheduled outreach
app/api/track/[token]/route.ts      Public position read for the tracking page
app/(admin)/admin/*                 Staff console
app/(tech)/tech/*                   Technician PWA
app/track/[token]/ · app/privacy/   Public customer pages
lib/claude/{agent,skills,tools,client}.ts   Tool-use loop, prompt assembly, tool schemas
lib/tools/*.ts                      One file per tool (side effects live here)
lib/whatsapp/{client,inbound,outbound,opt-out,templates}.ts
lib/supabase/{server,client,browser,types}.ts
lib/kpi/queries.ts                  Admin analytics
lib/{time,geo,tracking,legal,tier,brand,auto-assign,utils}.ts
skills/*.md                         Persona + 5 topical skills (system prompt)
supabase/migrations/*.sql           Schema evolution (apply in order)
scripts/*                           Smoke tests, seeding, tier tooling, deploy
docs/                               Client brief, onboarding, this overview
marketing/                          Lead-gen reels + explainer (not part of the app runtime)
```

---

## 12. Known gaps & non-obvious constraints

- **Voice notes aren't understood** — inbound audio is dropped before the agent runs; the customer gets a generic reply.
- **Global (not per-tech) slot capacity** — one booking per slot regardless of technician count (see §7).
- **Revenue is estimated** — `price_quoted` isn't written at booking time, so KPIs approximate from tier averages (§9).
- **Two migrations share the `0002_` prefix** (`0002_nudge.sql`, `0002_profiles_and_rls.sql`) — apply both.
- **Straight-line ETAs / no embedded map** — Nominatim + haversine; tracking links out to Google Maps.
- **Out of scope:** payments/deposits and a voice channel.
- On this dev machine, npm/dev need `NODE_OPTIONS="--use-system-ca"` for TLS.
```