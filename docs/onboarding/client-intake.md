# Client Intake — What to Collect & Where It Personalises Ajax

This is the information you need **from the client**. Everything Ajax says about *their* business — its name, hours, prices, policies, voice — comes from here. Get the starred items in **writing**: a wrong price or wrong policy out of the agent is a real liability, not a typo.

To collect it all in one pass, send the client **[intake-form.md](intake-form.md)**.

---

## 1. Business profile  ⭐
| What to collect | Why Ajax needs it | Where it lands |
|---|---|---|
| Legal entity name + brand/trading name | How the agent refers to the company | [skills/persona.md](../../skills/persona.md), `COMPANY_NAME` |
| UEN (business registration no.) | Invoices, legal notice, credibility | privacy notice / contracts |
| Office address + **service area** (radius or districts) | Agent tells customers if they're covered; geocoding | [skills/persona.md](../../skills/persona.md) |
| **Operating hours** + days closed + PH policy | Drives what slots Ajax offers and what it says about hours | [persona.md](../../skills/persona.md) **and** `WORK_WINDOWS` in [check_availability.ts](../../lib/tools/check_availability.ts) |

> ⚠️ Hours live in **two** places — the persona text *and* the bookable `WORK_WINDOWS` array. Update both or the agent will promise hours it can't actually book.

## 2. Services & pricing  ⭐⭐ (highest-risk — get in writing)
| What to collect | Why Ajax needs it | Where it lands |
|---|---|---|
| Full list of pest types they treat | What the agent can quote/book vs escalate | `pricing` table + [pest-identification.md](../../skills/pest-identification.md) |
| **Price per pest × service tier** (standard / plus / specialist) | The agent quotes these directly via `get_pricing_quote` | `pricing` table (admin **Pricing** page) |
| What's included per tier; recurring vs one-off | Accurate quotes and expectations | [pricing-and-quotes.md](../../skills/pricing-and-quotes.md) |
| Which services need an on-site inspection (no firm quote) | Agent says "inspection required" instead of guessing | `pricing.requires_inspection` |
| Typical job duration per service | Correct slot length | `DURATION_MIN` in [check_availability.ts](../../lib/tools/check_availability.ts) |
| GST treatment (prices incl./excl. 18%) | So quotes aren't misleading | pricing notes |

### Recurring contracts (AMC)  ⭐
Annual Maintenance Contracts let the agent send renewal reminders before a contract lapses and pitch annual plans to past customers without one. **Collect these once during onboarding; admin can keep up to date in the admin **AMC** page or via SQL.**

| What to collect | Why Ajax needs it | Where it lands |
|---|---|---|
| **AMC plan(s) offered + annual price per plan** | The agent describes the plan and the upsell template body cites pricing | [skills/amc.md](../../skills/amc.md) + admin's quote during escalation |
| **Default renewal-reminder lead time** (e.g. 30 days before expiry) | Drives when the daily cron fires the first reminder | `amc.lead_days` (per-contract; sets default in the **Add AMC** form) |
| Follow-up policy (do we send a 2nd reminder if no reply?) | One follow-up is the default 7 days after the first; turn off by ignoring it on a per-contract basis | cron behavior |
| **Existing contracts dump** (Excel/CSV from the client) | Seeds the `amc` table on day one so renewals don't get missed | admin **AMC** page → `+ Add AMC`, or bulk-import via Supabase SQL editor |
| What's covered (pest categories, visit cadence, callback rules) | The agent describes the plan accurately on inbound questions | [skills/amc.md](../../skills/amc.md) |
| Cancellation / mid-term refund policy | Agent escalates rather than guessing | [skills/amc.md](../../skills/amc.md) |

**Format for the contracts dump (one row per customer):**

| Column | Notes |
|---|---|
| `customer_phone` | Must already exist in `customers` (the import errors otherwise) |
| `commenced_at` | YYYY-MM-DD, the day they originally signed up |
| `renews_at` | YYYY-MM-DD, the next renewal date |
| `pest_type` | What's covered (e.g. `general pest`, `rats`, `termites`) |
| `annual_price` | INR, e.g. `4800.00` — optional but needed for the upsell pitch context |
| `lead_days` | Optional override; defaults to 30 if omitted |

Three WhatsApp templates need to be **approved in Meta Business Manager** before the cron will deliver anything:
- `amc_renewal_v1` (Utility) — first reminder
- `amc_renewal_followup_v1` (Utility) — 7-day follow-up
- `amc_upsell_v1` (Marketing) — cold pitch to non-AMC customers

Until approval lands, the cron runs but every send fails with Meta error `132001`. Template bodies live in the plan file; copy them into Meta's template editor verbatim so the variable substitution matches what the cron sends.

## 3. Service policies  ⭐
| What to collect | Why Ajax needs it | Where it lands |
|---|---|---|
| Cancellation / reschedule policy | Agent states it during booking changes | [booking-flow.md](../../skills/booking-flow.md) |
| Guarantee / warranty (e.g. 30-day) | The agent can reassure customers | [pricing-and-quotes.md](../../skills/pricing-and-quotes.md) |
| Payment methods (UPI, card, cash) + deposit rules | How the agent handles payment questions | [booking-flow.md](../../skills/booking-flow.md) |

## 4. Brand voice & persona  ⭐
| What to collect | Why Ajax needs it | Where it lands |
|---|---|---|
| Agent name (e.g. "Ajax") + how it introduces itself | Identity of the assistant | [persona.md](../../skills/persona.md) |
| Tone (warm/formal), emoji yes/no, message length | Matches their brand | [persona.md](../../skills/persona.md) |
| **Languages** (English / Hindi / regional languages) | Agent replies in the customer's language | [persona.md](../../skills/persona.md) |
| 2–3 example messages they'd send a customer | Calibrates the voice | [persona.md](../../skills/persona.md) |
| Hard "never say / never do" list | Guardrails | [escalation-and-safety.md](../../skills/escalation-and-safety.md) |

## 5. Escalation & team  ⭐
| What to collect | Why Ajax needs it | Where it lands |
|---|---|---|
| **Escalation WhatsApp number** (who gets pinged) | Where `escalate_to_human` sends alerts | `TECHNICIAN_ESCALATION_PHONE` |
| What must always reach a human (safety, complaints, specialist work) | Escalation triggers | [escalation-and-safety.md](../../skills/escalation-and-safety.md) |
| After-hours / weekend coverage + response times | What wait time the agent promises | [escalation-and-safety.md](../../skills/escalation-and-safety.md) |

### Technician roster  ⭐ (needed to provision accounts)
Each technician gets a login to the job app and can be assigned jobs. Accounts are created by **email invite** from the admin **Users** page, so an email is required per person — name + mobile alone isn't enough.

| Per technician, collect | Why it's needed | Where it lands |
|---|---|---|
| Full name | Shown on dispatch + the customer tracking page | `profiles.full_name` |
| **Email** | The login they're invited with (no email = no account) | Supabase auth invite → `profiles` |
| Mobile number | Dispatch / contact; matched for WhatsApp | `profiles.phone` |
| Role (technician vs admin) | Admins see everything; techs see only their jobs | `profiles.role` |
| IPCA/state pest control registration no. | Compliance record; credibility | `profiles` / records |

> One person should be designated **admin** (usually the owner/manager) — they manage pricing, see all conversations, and handle escalations. Everyone else is **technician**.

## 6. WhatsApp / Meta technical
| What to collect | Why it's needed | Where it lands |
|---|---|---|
| WhatsApp **Business API** number (migrate if on personal) | The line Ajax runs on | Meta config |
| Meta Business Manager access (or System User token) | Send/receive messages | `WHATSAPP_ACCESS_TOKEN` |
| Phone Number ID | Identifies the sending number | `WHATSAPP_PHONE_NUMBER_ID` |
| App Secret | Verifies inbound webhooks | `WHATSAPP_APP_SECRET` |

## 7. Legal / DPDP Act
| What to collect | Why it's needed | Where it lands |
|---|---|---|
| **Privacy contact name + email** | DPDP Act notice obligation; published on /privacy | `DPO_NAME`, `DPO_EMAIL` |
| Existing privacy policy (if any) | Reconcile with the /privacy notice | [/privacy](../../app/privacy/page.tsx) |
| Confirmation customers consent to WhatsApp contact | Consent basis | process / notice |

## 8. Licensing & credibility (India)
| What to collect | Why it's useful | Where it lands |
|---|---|---|
| IPCA/state pest control operator licence no. | Credibility; the agent can cite it | [persona.md](../../skills/persona.md) |
| Logo / brand colours (optional) | Any branded surface (tracking page, /privacy) | UI |

---

<a name="env-var-map"></a>
## Env-var map (what gets set per client)
Server-only secrets and public config the deployment needs:

```
# AI
ANTHROPIC_API_KEY=

# WhatsApp (from Phase 2)
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
# WHATSAPP_GRAPH_VERSION=v23.0   (optional)
TECHNICIAN_ESCALATION_PHONE=

# WhatsApp templates (see whatsapp-templates.md). Only override the names if the
# client's approved templates differ from the code defaults.
WHATSAPP_TEMPLATE_LANG=en
# WHATSAPP_TEMPLATE_REMINDER=appointment_reminder_v1
# WHATSAPP_TEMPLATE_NUDGE=checkin_nudge_v1
# WHATSAPP_TEMPLATE_EN_ROUTE=technician_en_route_v1
# WHATSAPP_TEMPLATE_ESCALATION=internal_escalation_v1
# WHATSAPP_TEMPLATE_AMC_RENEWAL=amc_renewal_v1
# WHATSAPP_TEMPLATE_AMC_RENEWAL_FOLLOWUP=amc_renewal_followup_v1
# WHATSAPP_TEMPLATE_AMC_UPSELL=amc_upsell_v1

# Supabase (India region — ap-south-1, Mumbai)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_APP_URL=

# Cron + retention
CRON_SECRET=
RETENTION_CONV_MONTHS=6

# Legal / DPDP Act (Phase 5)
COMPANY_NAME=
DPO_NAME=
DPO_EMAIL=
```

## The 4 things that matter most
If you collect nothing else perfectly, get these exactly right — they're what the agent says out loud and what creates liability if wrong:
1. **The full price list** (every pest × tier, GST treatment, what needs inspection).
2. **Operating hours & service area** (and remember: update both persona *and* `WORK_WINDOWS`).
3. **Escalation rules + the escalation phone number.**
4. **Brand voice + languages.**
