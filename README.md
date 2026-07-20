# PestLLM

WhatsApp-first booking system for a residential / small-commercial pest control business (brand: **GreenShield Pest Control**; the assistant introduces itself as **"Ajax"**). Customers message the company's WhatsApp number and get **deterministic MCQ flows** — tap-driven buttons and lists for quoting, booking, rescheduling, and cancelling — with an AI **router** (never a chatbot) that re-anchors anyone who types free text onto the right menu. Backed by a staff **admin console** and a **technician PWA** with live GPS tracking.

Built for the India market: all times render in `Asia/Kolkata` (IST, UTC+5:30) and the app ships a DPDP Act-aware privacy notice, opt-out handling, and a data-retention cron.

## Stack

- **Next.js 15** (App Router, Server Actions, route handlers) · React 19 · TypeScript · Tailwind
- **Anthropic-compatible LLM** (env-driven via `ANTHROPIC_MODEL`; default `claude-sonnet-4-6`) — tool-use agent
- **Supabase** — Postgres, Auth, Storage (`job-photos`), Realtime; RLS is the real security boundary
- **WhatsApp Cloud API** (Meta Graph `v23.0`) — inbound webhook + outbound text & template messages
- **Vercel** — hosting + cron

## Architecture

```
Customer (WhatsApp)
     │  taps a button / list row  ──►  deterministic transition, ZERO LLM calls
     │  types free text           ──►  fast-model ROUTER (JSON-only classify) → re-present the right MCQ
     ▼
WhatsApp Cloud API  ──►  POST /api/whatsapp/webhook  ──►  lib/flows/engine.ts
(Meta Graph API)          (acks Meta immediately, dedups      │  booking + manage flows
                           by message id, runs in after())    │  reuse the function tools directly
                                                              ▼
                                                  Supabase (Postgres, RLS, Storage, Realtime)
                                                              ▲
                            ┌─────────────────────────────────┤
              Admin console │/admin/*          Technician PWA │/tech/*        Public │/track/[token], /privacy
```

- **Flows** ([lib/flows/](lib/flows/)) — declarative MCQ graphs (`definitions/booking.ts`, `definitions/manage.ts`) run by a deterministic engine. Prompts are buttons (≤3) or lists (≤10 rows); name/address/code are typed **text nodes**. State lives in `conversations.flow_state`.
- **Router** ([lib/flows/router.ts](lib/flows/router.ts)) — the only LLM in the customer path. Free text at an MCQ → classify to {select option, main menu, human}; **fails open** to re-presenting the current MCQ. It never writes customer-facing prose.
- **Tools** ([lib/tools/*.ts](lib/tools/)) — the booking/quote/escalation functions, called directly by flow nodes (same verified-phone context injection as before).
- **Legacy agent** ([lib/claude/agent.ts](lib/claude/agent.ts)) — the free-form tool-use loop remains in the codebase but is no longer wired to customers.

### The flows
**booking** — menu → pest (live rate card) → size → quote (inspection-aware) → slots (live availability) → saved-details shortcut or typed name/address → confirm → booked (+ optional deposit link) · **manage** — pick upcoming booking (by phone, or typed code) → reschedule (slot list) / cancel (confirm) · **reminder sequence** — 24h template with [Confirm ✓][Reschedule][Cancel] quick replies; a tap opens the service window and routes deterministically.

## Surfaces

| Surface | Path | What it does |
|---|---|---|
| **WhatsApp MCQ flows** | `/api/whatsapp/webhook` | The product. Tap-driven booking, quoting, rescheduling, cancelling, and human hand-off; reminder quick-reply handling; post-visit CSAT (Meta-Flow or "reply 1–5"). Free text → AI router → back onto the menu. |
| **Admin console** | `/admin/*` | Overview dashboard, appointments, conversations (**with human takeover** — pause Ajax, reply live into the WhatsApp thread, resume), **customers CRM** (tags, notes, LTV, unified timeline), broadcast campaigns, **journeys** (composable automation sequences), dispatch (assign technicians, live positions), escalation triage, pricing editor, user/role management. Supabase Realtime feeds dispatch, escalations + conversations. |
| **Technician PWA** | `/tech/*` | Installable mobile app: today's assigned jobs, job detail (notes, before/after photos to the `job-photos` bucket, mark complete — which triggers the CSAT ask), live **en-route / arrived** GPS sharing, escalations, profile. |
| **Customer tracking** | `/track/[token]` | Public, token-gated page showing the technician's recent position + a deep link to Google Maps. Positions are only served if they belong to this job and are < 15 min old ([lib/tracking.ts](lib/tracking.ts)). |
| **Payments webhook** | `/api/payments/webhook` | Razorpay `payment_link.paid` events: marks the payment paid, thanks the customer, files the AMC-renewal follow-up escalation. Signature-verified. |
| **Privacy notice** | `/privacy` | DPDP Act notice with configurable company + contact details ([lib/legal.ts](lib/legal.ts)). |

Auth is Supabase Auth + a `profiles` table with role `admin | technician`. [middleware.ts](middleware.ts) refreshes the session and gates `/admin` and `/tech` by role; RLS enforces the real boundary.

## Proactive messaging

Outbound to customers goes through [lib/whatsapp/outbound.ts](lib/whatsapp/outbound.ts), which forces every send to declare a **kind**: `transactional` (booking confirmations, reminders, en-route) always send; `promotional` (nudges, AMC upsell) are suppressed for customers who replied **STOP**. Sends outside Meta's 24-hour window use pre-approved **templates** ([lib/whatsapp/templates.ts](lib/whatsapp/templates.ts)).

### Cron jobs ([vercel.json](vercel.json))

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/reminders` | hourly (`0 * * * *`) | 24h-out appointment reminders (once per booking via `reminder_sent_at`) |
| `/api/cron/nudges` | every 10 min (`*/10 * * * *`) | one re-engagement nudge for idle threads (free-form — always inside the 24h window; skips human-held threads and booking-intent threads owned by recovery) |
| `/api/cron/abandoned-bookings` | every 15 min (`*/15 * * * *`) | personalized recovery for threads with a quote/availability check but no booking ([lib/recovery.ts](lib/recovery.ts); once per silence window via `recovery_sent_at`) |
| `/api/cron/campaign-dispatch` | every 5 min (`*/5 * * * *`) | drains queued broadcast-campaign recipients in batches; flips campaigns to `done` |
| `/api/cron/journeys` | every 15 min (`*/15 * * * *`) | journey engine: enrolls new trigger matches (post-`enabled_at` only) and advances due steps (template sends, opt-out cancels) |
| `/api/cron/retention` | daily 18:00 (`0 18 * * *`) | DPDP Act: purge chat logs older than `RETENTION_CONV_MONTHS` (default 6) + prune webhook-dedup rows |
| `/api/cron/amc` | daily 01:00 (`0 1 * * *`) | AMC renewal reminders, follow-ups, and upsell pitches |

> All cron routes require `Authorization: Bearer $CRON_SECRET`. In production they **fail closed** — if `CRON_SECRET` is unset they refuse to run (503) rather than being publicly triggerable. Vercel attaches the header automatically when the env var is set.

## Setup

### 1. Install
```powershell
npm install   # or: pnpm install
```
> On this machine, npm/dev need `NODE_OPTIONS="--use-system-ca"` for TLS.

### 2. Supabase
1. Create a project at https://supabase.com.
2. Apply the schema — **easiest: paste [supabase/setup_full.sql](supabase/setup_full.sql) into the Studio SQL editor once** (a generated concatenation of every migration; for a DB that already has 0001–0011_webhook_dedup, use [setup_delta_0011_to_0021.sql](supabase/setup_delta_0011_to_0021.sql) instead). Or apply [supabase/migrations/](supabase/migrations/) individually **in filename order** (Supabase Studio SQL editor or `supabase db push`). They build: schema + pricing seed → profiles/RLS → nudge column → technician phase (photos + Storage) → GPS tracking → RLS hardening → tech column guard → opt-out → AMC → deployment tier (later removed by 0016) → indexes + integrity constraints (incl. the DB-level double-booking guard) → webhook dedup + reminder tracking → human takeover → abandoned-booking recovery → campaigns → feedback (CSAT) → payments → tier removal → CRM (tags + ad attribution) → SLA event log → journeys → service-tier removal (flat one-price-per-pest catalog) → MCQ flow state (`flow_state`, `reminder_confirmed_at`).
3. Copy the project URL + **service role** key (Settings → API) into the env vars below, and the URL + **anon** key into the `NEXT_PUBLIC_*` vars.
4. Promote your first user to admin: `update profiles set role='admin' where id='<auth-user-id>';` (new sign-ups default to `technician`).

### 3. WhatsApp Cloud API (Meta direct)
1. Create a Meta App at https://developers.facebook.com → add the **WhatsApp** product.
2. In **WhatsApp → API Setup**, copy the **Phone number ID** (not the phone number) into `WHATSAPP_PHONE_NUMBER_ID` and an access token into `WHATSAPP_ACCESS_TOKEN`. For production, mint a long-lived **System User** token.
3. In **App → Settings → Basic**, copy **App secret** into `WHATSAPP_APP_SECRET` (verifies `X-Hub-Signature-256` in production).
4. Pick any random string for `WHATSAPP_VERIFY_TOKEN`.
5. In **WhatsApp → Configuration → Webhook**, set the Callback URL to `https://<your-domain>/api/whatsapp/webhook` (use ngrok for local dev), paste the same Verify Token, and subscribe to the **`messages`** field.
6. Set `TECHNICIAN_ESCALATION_PHONE` to a WhatsApp-reachable number — escalations are sent as **WhatsApp messages** (the recipient must have messaged the business number in the last 24h, or use an approved template).
7. Submit the message templates named in [lib/whatsapp/templates.ts](lib/whatsapp/templates.ts) in Meta Business Manager (or override the names via env to match your approved templates).

### 4. Anthropic
Get an API key at https://console.anthropic.com → `ANTHROPIC_API_KEY`.

### 5. Run
```powershell
# create .env.local with the vars below, then:
npm run dev
# in another shell, expose it to Meta:
ngrok http 3000
# point the Meta webhook Callback URL at the ngrok https URL and verify
```

## Environment variables

There is no `.env.local.example` checked in — create `.env.local` with:

**Required**
```
ANTHROPIC_API_KEY=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
SUPABASE_URL=                      # service-role client (webhook, cron, server)
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=          # browser / SSR anon client
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

**Operational / optional**
```
ANTHROPIC_BASE_URL=                # set to http://localhost:4000 to route through LiteLLM (dev)
ANTHROPIC_MODEL=                   # default: claude-sonnet-4-6
ANTHROPIC_MODEL_VISION=            # used by identify_pest; default: claude-haiku-4-5
TECHNICIAN_ESCALATION_PHONE=       # where escalations are WhatsApp'd
CRON_SECRET=                       # bearer token guarding /api/cron/*
WHATSAPP_GRAPH_VERSION=v23.0       # default if unset
RETENTION_CONV_MONTHS=6            # chat-log retention window
NEXT_PUBLIC_APP_URL=               # used to build customer tracking links
NEXT_PUBLIC_SITE_URL=
COMPANY_NAME=                      # privacy notice / legal
DPO_NAME=
DPO_EMAIL=
WHATSAPP_TEMPLATE_LANG=en
# template-name overrides (defaults in lib/whatsapp/templates.ts):
WHATSAPP_TEMPLATE_REMINDER=
WHATSAPP_TEMPLATE_REMINDER_BUTTONS=   # quick-reply variant (Confirm/Reschedule/Cancel); unset = text reminder
WHATSAPP_TEMPLATE_EN_ROUTE=
WHATSAPP_TEMPLATE_ESCALATION=
WHATSAPP_TEMPLATE_AMC_RENEWAL=
WHATSAPP_TEMPLATE_AMC_RENEWAL_FOLLOWUP=
WHATSAPP_TEMPLATE_AMC_UPSELL=
# WhatsApp Flows + reviews (docs/onboarding/flows/):
WHATSAPP_FLOW_CSAT_ID=             # published CSAT Flow id; unset = plain "reply 1-5" fallback
GOOGLE_REVIEW_URL=                 # review link sent to customers who rate 4-5
# Razorpay payment links (all optional — unset disables payments entirely):
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=           # verifies /api/payments/webhook (payment_link.paid)
RAZORPAY_DEPOSIT_AMOUNT=           # flat booking deposit in INR; unset = no deposit asks
```

## Deploy to Vercel

```powershell
vercel link
vercel env add ANTHROPIC_API_KEY      # repeat for every var above
vercel deploy --prod
```

After deploy, update the Meta WhatsApp webhook Callback URL to your Vercel production URL and re-verify. The crons in `vercel.json` start firing automatically.

## Verification

From your own phone, message the WhatsApp business number:

1. `Hi` → greeting + open-ended question (persona skill).
2. `I have rats in my garage, how much?` → clarifying question, then `get_pricing_quote`.
3. `Book me Tuesday afternoon` → `check_availability`, slot proposal, then `create_appointment` returns a 6-char confirmation code.
4. Send a photo of an insect → `identify_pest` runs against vision.
5. `My kid was stung by something` → `escalate_to_human` fires; `TECHNICIAN_ESCALATION_PHONE` gets a WhatsApp alert.

Local DB-tool checks (no WhatsApp involved):
```powershell
npm run smoke
```

## File layout

```
app/api/whatsapp/webhook/route.ts   Meta inbound (GET verify + POST), opt-out, Flow/CSAT routing, hands off to runAgent
app/api/cron/{reminders,nudges,abandoned-bookings,campaign-dispatch,journeys,retention,amc}/route.ts   Scheduled outreach (all in vercel.json)
app/api/payments/webhook/route.ts   Razorpay payment_link.paid (signature-verified)
app/api/track/[token]/route.ts      Public position read for the customer tracking page
app/(admin)/admin/*                 Staff console (overview, appointments, conversations + takeover, customers CRM, campaigns, journeys, dispatch, escalations, pricing, users)
app/(tech)/tech/*                   Technician PWA (today, job detail + CSAT trigger, escalations, profile)
app/track/[token]/                  Public customer tracking page
app/privacy/                        DPDP Act privacy notice
lib/claude/{agent,skills,tools,client}.ts   Tool-use loop, prompt assembly, tool schemas
lib/tools/*.ts                      One file per tool
lib/whatsapp/{client,inbound,outbound,opt-out,templates}.ts   inbound parses Flows; outbound adds sendWhatsAppFlow
lib/payments/{razorpay,links}.ts    Razorpay API client + recorded payment links
lib/campaigns/segment.ts            Broadcast segment spec → customer snapshot (area/pest/visit-age/AMC/tag)
lib/{recovery,feedback}.ts          Abandoned-booking detector · CSAT recording
lib/supabase/{server,client,browser,types}.ts   server=anon SSR, client=service-role, browser=client-side
lib/{time,geo,tracking,legal,utils}.ts
skills/*.md                         Persona + 5 topical skills
supabase/migrations/*.sql           Schema evolution (apply in order)
docs/onboarding/                    Client intake + onboarding notes (incl. flows/)
```

## Notes / known gaps

- Geocoding uses OpenStreetMap **Nominatim** (no API key); ETAs are straight-line haversine estimates ([lib/geo.ts](lib/geo.ts)). The tracking page links out to `google.com/maps` rather than embedding a map.
- Default model is `claude-sonnet-4-6` (override via `ANTHROPIC_MODEL`). `identify_pest` uses `MODEL_FAST` (default `claude-haiku-4-5`, override via `ANTHROPIC_MODEL_VISION`). For local dev without an Anthropic key, point `ANTHROPIC_BASE_URL` at a LiteLLM proxy in front of Ollama — config in [litellm-config.yaml](litellm-config.yaml).
- Two migrations share the `0002_` prefix (`0002_nudge.sql`, `0002_profiles_and_rls.sql`) — apply both.
- Capacity is one booking per slot **globally** (three fixed windows/day), regardless of technician count — the DB unique index enforces it. Raising throughput means moving to per-technician slot capacity.
- Voice notes are not understood: audio media is dropped before the agent runs, so the customer gets a generic reply. Payments/deposits and a voice channel remain out of scope.
```
