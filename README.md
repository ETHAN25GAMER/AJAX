# PestLLM

WhatsApp-first AI agent for a residential / small-commercial pest control business (brand: **GreenShield Pest Control**; the assistant introduces itself as **"Ajax 1.0"**). Customers message the company's WhatsApp number and Claude runs the whole conversation — pricing, pest ID, booking, annual-maintenance contracts, and human escalation — backed by a staff **admin console** and a **technician PWA** with live GPS tracking.

Built for the India market: all times render in `Asia/Kolkata` (IST, UTC+5:30) and the app ships a DPDP Act-aware privacy notice, opt-out handling, and a data-retention cron.

## Stack

- **Next.js 15** (App Router, Server Actions, route handlers) · React 18 · TypeScript · Tailwind
- **Anthropic Claude** (`claude-opus-4-7`) — tool-use agent
- **Supabase** — Postgres, Auth, Storage (`job-photos`), Realtime; RLS is the real security boundary
- **WhatsApp Cloud API** (Meta Graph `v23.0`) — inbound webhook + outbound text & template messages
- **Vercel** — hosting + cron

## Architecture

```
Customer (WhatsApp)
     │
     ▼
WhatsApp Cloud API  ──►  POST /api/whatsapp/webhook  ──►  runAgent()  (tool-use loop, up to 6 iterations)
(Meta Graph API)          (acks Meta immediately,            │
                           runs the agent in after())        ▼
                                                  Claude (claude-opus-4-7)
                                                  + 6 markdown skills (cached system prompt)
                                                  + 11 function tools
                                                              │
                                                              ▼
                                                  Supabase (Postgres, RLS, Storage, Realtime)
                                                              ▲
                            ┌─────────────────────────────────┤
              Admin console │/admin/*          Technician PWA │/tech/*        Public │/track/[token], /privacy
```

- **Skills** ([skills/*.md](skills/)) — behavior/instructions concatenated into the cached system prompt ([lib/claude/skills.ts](lib/claude/skills.ts)). No code runs.
- **Tools** ([lib/tools/*.ts](lib/tools/)) — code Claude can call; schemas + dispatcher in [lib/claude/tools.ts](lib/claude/tools.ts).

### The 6 skills
`persona` · `booking-flow` · `pricing-and-quotes` · `pest-identification` · `escalation-and-safety` · `amc`

### The 11 tools
`check_availability` · `create_appointment` · `reschedule_appointment` · `cancel_appointment` · `get_pricing_quote` · `identify_pest` (vision — accepts a WhatsApp photo) · `escalate_to_human` · `lookup_customer` · `lookup_amc_status` · `request_amc_renewal` · `request_amc_subscription`

## Surfaces

| Surface | Path | What it does |
|---|---|---|
| **WhatsApp agent** | `/api/whatsapp/webhook` | The product. Books/reschedules/cancels, quotes, IDs pests from photos, handles AMC, escalates. |
| **Admin console** | `/admin/*` | Overview dashboard, appointments, conversations, dispatch (assign technicians, live positions), escalation triage, pricing editor, user/role management. Supabase Realtime feeds dispatch + escalations. |
| **Technician PWA** | `/tech/*` | Installable mobile app: today's assigned jobs, job detail (notes, before/after photos to the `job-photos` bucket, mark complete), live **en-route / arrived** GPS sharing, escalations, profile. |
| **Customer tracking** | `/track/[token]` | Public, token-gated page showing the technician's recent position + a deep link to Google Maps. Positions are only served if they belong to this job and are < 15 min old ([lib/tracking.ts](lib/tracking.ts)). |
| **Privacy notice** | `/privacy` | DPDP Act notice with configurable company + contact details ([lib/legal.ts](lib/legal.ts)). |

Auth is Supabase Auth + a `profiles` table with role `admin | technician`. [middleware.ts](middleware.ts) refreshes the session and gates `/admin` and `/tech` by role; RLS enforces the real boundary.

## Proactive messaging

Outbound to customers goes through [lib/whatsapp/outbound.ts](lib/whatsapp/outbound.ts), which forces every send to declare a **kind**: `transactional` (booking confirmations, reminders, en-route) always send; `promotional` (nudges, AMC upsell) are suppressed for customers who replied **STOP**. Sends outside Meta's 24-hour window use pre-approved **templates** ([lib/whatsapp/templates.ts](lib/whatsapp/templates.ts)).

### Cron jobs ([vercel.json](vercel.json))

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/reminders` | hourly (`0 * * * *`) | 24h-out appointment reminders |
| `/api/cron/nudges` | every 10 min (`*/10 * * * *`) | one re-engagement nudge for idle threads |
| `/api/cron/retention` | daily 18:00 (`0 18 * * *`) | DPDP Act: purge chat logs older than `RETENTION_CONV_MONTHS` (default 6) |

> ⚠️ `/api/cron/amc` exists (daily AMC renewal reminders, follow-ups, and upsell pitches) but is **not yet scheduled in `vercel.json`** — add it to a daily slot before relying on AMC outreach. All cron routes check `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set.

## Setup

### 1. Install
```powershell
npm install   # or: pnpm install
```
> On this machine, npm/dev need `NODE_OPTIONS="--use-system-ca"` for TLS.

### 2. Supabase
1. Create a project at https://supabase.com.
2. Apply the migrations in [supabase/migrations/](supabase/migrations/) **in filename order** (Supabase Studio SQL editor or `supabase db push`). They build: schema + pricing seed → profiles/RLS → nudge column → technician phase (photos + Storage) → GPS tracking → RLS hardening → tech column guard → opt-out → AMC → deployment tier → indexes + integrity constraints (incl. the DB-level double-booking guard).
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
ANTHROPIC_MODEL=                   # default: claude-fable-5 (set claude-sonnet-4-6 to cut cost ~3x)
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
WHATSAPP_TEMPLATE_NUDGE=
WHATSAPP_TEMPLATE_EN_ROUTE=
WHATSAPP_TEMPLATE_ESCALATION=
WHATSAPP_TEMPLATE_AMC_RENEWAL=
WHATSAPP_TEMPLATE_AMC_RENEWAL_FOLLOWUP=
WHATSAPP_TEMPLATE_AMC_UPSELL=
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
app/api/whatsapp/webhook/route.ts   Meta inbound (GET verify + POST), opt-out, hands off to runAgent
app/api/cron/{reminders,nudges,retention,amc}/route.ts   Scheduled outreach (amc not yet in vercel.json)
app/api/track/[token]/route.ts      Public position read for the customer tracking page
app/(admin)/admin/*                 Staff console (overview, appointments, conversations, dispatch, escalations, pricing, users)
app/(tech)/tech/*                   Technician PWA (today, job detail, escalations, profile)
app/track/[token]/                  Public customer tracking page
app/privacy/                        DPDP Act privacy notice
lib/claude/{agent,skills,tools,client}.ts   Tool-use loop, prompt assembly, tool schemas
lib/tools/*.ts                      One file per tool
lib/whatsapp/{client,inbound,outbound,opt-out,templates}.ts
lib/supabase/{server,client,browser,types}.ts   server=anon SSR, client=service-role, browser=client-side
lib/{time,geo,tracking,legal,utils}.ts
skills/*.md                         Persona + 5 topical skills
supabase/migrations/*.sql           Schema evolution (apply in order)
docs/onboarding/                    Client intake + onboarding notes
```

## Notes / known gaps

- `/api/cron/amc` is implemented but unscheduled (see above).
- Geocoding uses OpenStreetMap **Nominatim** (no API key); ETAs are straight-line haversine estimates ([lib/geo.ts](lib/geo.ts)). `@googlemaps/js-api-loader` is in `package.json` but not currently imported — the tracking page links out to `google.com/maps` rather than embedding a map.
- Default model is `claude-fable-5` (override via `ANTHROPIC_MODEL` — e.g. `claude-sonnet-4-6` for a ~3x cheaper bill). `identify_pest` uses `MODEL_FAST` (default `claude-haiku-4-5`, override via `ANTHROPIC_MODEL_VISION`). For local dev without an Anthropic key, point `ANTHROPIC_BASE_URL` at a LiteLLM proxy in front of Ollama — config in [litellm-config.yaml](litellm-config.yaml).
- Two migrations share the `0002_` prefix (`0002_nudge.sql`, `0002_profiles_and_rls.sql`) — apply both.
- Payments/deposits and a voice channel remain out of scope.
```
