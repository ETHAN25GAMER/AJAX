# Client Onboarding — Master Checklist

How to take a new pest-control client from "signed" to "Ajax is live on their WhatsApp."

Work top to bottom. **Phase 1 (collecting client information) is the one that personalises Ajax** — everything the agent says about *their* business comes from there. The detailed list of what to collect, and where each piece lands in the system, is in **[client-intake.md](client-intake.md)**. Send the client **[intake-form.md](intake-form.md)** to gather it all in one go.

Rough timeline: 1–2 weeks, mostly waiting on the client's information and Meta's WhatsApp approval.

---

## Phase 0 — Deal closed & paperwork
- [ ] Service / pilot agreement signed (SEN ↔ client)
- [ ] **Data-processing agreement signed** — this is what makes SEN a data processor under India's DPDP Act 2023 (see [project compliance notes])
- [ ] Kickoff call scheduled

## Phase 1 — Collect client information  ⭐ personalises Ajax
- [ ] Sent the intake form ([intake-form.md](intake-form.md))
- [ ] Business profile (name, UEN, address, hours, service area)
- [ ] **Full price list** (every pest type × service tier) — most error-prone, get it in writing
- [ ] Service policies (cancellation, guarantee, payment, deposit)
- [ ] Brand voice & persona preferences (agent name, tone, languages)
- [ ] Escalation rules + escalation contact number + technician roster
- [ ] WhatsApp / Meta access
- [ ] Privacy contact name + email, company legal details
- [ ] Pest control licence details (IPCA/state registration)

## Phase 2 — WhatsApp / Meta setup
- [ ] Confirm they're on **WhatsApp Business API** (migrate from personal/Business App if needed)
- [ ] Access to their Meta Business Manager; create a System User + long-lived token
- [ ] Capture `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`
- [ ] Choose a `WHATSAPP_VERIFY_TOKEN` (any random string)
- [ ] Set the webhook URL (`https://<deploy>/api/whatsapp/webhook`) + verify token in Meta
- [ ] Subscribe the app to the **messages** webhook field
### Template verification ⭐ (go-live gate — proactive messages fail without it)
Specs (body text + exact `{{n}}` order) are in **[whatsapp-templates.md](whatsapp-templates.md)**. Do this yourself, in the client's WhatsApp Business Account — don't delegate, or the names/params drift and messages break.

**Prerequisites**
- [ ] You have **admin/partner access** to the client's WABA (Meta Business Manager)
- [ ] A **payment method** is on the WABA (templates are free; conversations are billed)

**Create & submit each template** (WhatsApp Manager → Message Templates → Create)
For every template: exact **name** (lowercase_underscores), correct **category**, **language = `en`** (match `WHATSAPP_TEMPLATE_LANG`), body text with `{{n}}` **in the documented order**, and **sample values** for each variable.
- [ ] `appointment_reminder_v1` — Utility
- [ ] `checkin_nudge_v1` — **Marketing**
- [ ] `technician_en_route_v1` — Utility — **+ dynamic URL button** (next block)
- [ ] `internal_escalation_v1` — Utility
- [ ] `amc_renewal_v1` — Utility
- [ ] `amc_renewal_followup_v1` — Utility
- [ ] `amc_upsell_v1` — **Marketing**

**En-route button (the one fiddly one)**
- [ ] Add button → **Visit website** → URL type **Dynamic**
- [ ] URL = client's app domain + `/track/{{1}}` (e.g. `https://app.<client>.in/track/{{1}}`) — **base must match that client's `NEXT_PUBLIC_APP_URL`** or every link 404s
- [ ] Button label (e.g. "Track live") + a sample value for `{{1}}`

**Approve & reconcile**
- [ ] All templates show **Approved** in WhatsApp Manager (minutes–48h)
- [ ] Names match the code defaults — or set the matching `WHATSAPP_TEMPLATE_*` env vars
- [ ] Handle any rejection: wrong category, a `{{n}}` at the very start/end or two adjacent, promo wording in a Utility template → fix & resubmit
- [ ] **Test-send each** after approval and confirm variables land in the right slots (a param-order mismatch approves fine but garbles live messages)

**Meta account realities (flag early — they have lead times)**
- [ ] **Business verification**, **display-name approval**, **messaging tier limits** (~250 conversations/day on a new number), and who pays **per-conversation billing**

## Phase 3 — Infrastructure
- [ ] Create the client's **Supabase project — confirm the region is ap-south-1 (Mumbai)** (DPDP Act data residency)
- [ ] Set all env vars (full list in [client-intake.md](client-intake.md#env-var-map))
- [ ] Run migrations `0001` → `0007` in order
- [ ] Set `RETENTION_CONV_MONTHS=6`
- [ ] Deploy (Vercel). On this machine, installs/dev need `NODE_OPTIONS=--use-system-ca`
- [ ] Confirm the three crons are active: `reminders`, `nudges`, `retention` ([vercel.json](../../vercel.json))

## Phase 4 — Personalise Ajax  ⭐
- [ ] [skills/persona.md](../../skills/persona.md) — company name, agent name, **hours**, service area, voice, languages
- [ ] [lib/tools/check_availability.ts](../../lib/tools/check_availability.ts) — `WORK_WINDOWS` + `DURATION_MIN` to match their real bookable hours and service durations
- [ ] **Pricing table** — replace the seed prices with the client's real list (via the admin **Pricing** page, or a seed migration)
- [ ] [skills/pricing-and-quotes.md](../../skills/pricing-and-quotes.md) — quoting rules, what needs an inspection
- [ ] [skills/pest-identification.md](../../skills/pest-identification.md) — the species they actually treat
- [ ] [skills/escalation-and-safety.md](../../skills/escalation-and-safety.md) — their escalation triggers; set `TECHNICIAN_ESCALATION_PHONE`
- [ ] [skills/booking-flow.md](../../skills/booking-flow.md) — any booking quirks

## Phase 5 — Compliance config
- [ ] Set `COMPANY_NAME`, `DPO_NAME`, `DPO_EMAIL` ([lib/legal.ts](../../lib/legal.ts))
- [ ] Have **[/privacy](../../app/privacy/page.tsx)** reviewed by an India-qualified adviser; share the link with the client
- [ ] Test the **STOP / START** opt-out end to end
- [ ] Record that Supabase region + Anthropic/Meta DPAs cover any overseas data transfer

## Phase 6 — Accounts
- [ ] Create the admin account; set `role = 'admin'` in `profiles`
- [ ] Create technician accounts; assign them to jobs
- [ ] Test login for both an admin and a technician

## Phase 7 — Test & validate (use a test number first)
- [ ] Booking happy path (enquiry → quote → slot → confirmation code)
- [ ] Pricing quote returns their real prices
- [ ] Escalation fires and pings the technician number
- [ ] Reminder sends + live tracking link works (and dies after the trip)
- [ ] STOP then START behaves correctly
- [ ] All times display in **IST (India Standard Time)**

## Phase 8 — Go live & handoff
- [ ] Switch from the test number to the production WhatsApp number
- [ ] Watch the first real conversations in the admin dashboard
- [ ] Walk the client through: dashboard, editing pricing, how escalations reach them
- [ ] Schedule a 1-week check-in

---

See also: **[client-intake.md](client-intake.md)** (what to collect and where it goes) · **[intake-form.md](intake-form.md)** (send this to the client).
