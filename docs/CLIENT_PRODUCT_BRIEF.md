# Ajax — WhatsApp AI Booking Assistant
## What You Get & What We Need From You

---

## What Ajax Does

Ajax is an AI assistant that runs on your WhatsApp business number and handles customer conversations around the clock — no staff needed for routine enquiries. It books jobs, quotes prices, identifies pests from photos, and automatically nudges customers to re-book. Your team gets a web dashboard to manage everything, and technicians get a mobile app for the field.

---

## The Three Parts of the System

### 1. WhatsApp AI Agent
This is what your customers talk to. It handles the full booking lifecycle without any human involvement.

**Booking**
- Takes a customer from first message to confirmed appointment in one conversation
- Checks your real-time availability and proposes slots
- Books, reschedules, and cancels appointments
- Sends the customer a 6-character confirmation code
- Automatically assigns the job to your least-busy technician for that day

**Pricing & Quotes**
- Quotes prices from your exact price list — never makes up numbers
- Handles different tiers (e.g. one-off treatment vs. recurring plan)
- Flags which jobs need an on-site inspection before a firm price can be given

**Pest Identification**
- A customer can send a photo of a pest and Ajax will identify it, estimate severity, and suggest the right service
- Also works from a text description if no photo is available

**Annual Maintenance Contracts (AMC)**
- Checks whether a customer has an active AMC
- Takes renewal requests and flags them for your admin to confirm and collect payment
- Takes new subscription requests from customers who don't yet have a contract

**Escalation**
- Immediately flags urgent situations (bites/stings, structural risk, complaints) to a designated WhatsApp number
- Marks the conversation for your team to follow up — the customer is told a human will respond shortly

**Automated Outreach**
Ajax sends proactive messages on your behalf (all via approved WhatsApp templates):

| Message | When it fires |
|---|---|
| Appointment reminder | 24 hours before every booked job |
| Re-engagement nudge | If a customer goes quiet mid-conversation |
| En-route alert | When a technician starts travel to a job (includes a live tracking link) |
| AMC renewal reminder | X days before a contract renews (you set the lead time) |
| AMC renewal follow-up | 7 days after the reminder if no response |
| AMC upsell | To past customers who don't yet have a contract (max once per 90 days) |

**Opt-out handling**
- Customers can reply **STOP** at any time — Ajax immediately stops all promotional messages and confirms the opt-out
- Transactional messages (booking confirmations, reminders, en-route alerts) continue because the customer has an active service relationship
- Customers can reply **START** to opt back in

---

### 2. Admin Dashboard (Web App)

Your manager or owner logs in from any browser — desktop or mobile.

| Section | What you can do |
|---|---|
| **Appointments** | See all upcoming jobs grouped by day; assign or reassign technicians; filter by status or technician |
| **Dispatch** | Live map of every technician's GPS position, updated in real time as they travel |
| **Conversations** | Read the full WhatsApp message history for any customer |
| **Escalations** | Triage queue of conversations flagged for human attention; mark resolved when done |
| **Pricing** | Edit your price list directly — changes take effect on the next customer conversation |
| **AMC** | View and manage all annual maintenance contracts; see renewal status |
| **KPI Dashboard** | Revenue trends, job counts, technician performance, funnel metrics, AMC overview |
| **Users** | Invite admins and technicians; manage roles |
| **Settings** | Feature flags and system configuration |

All changes sync in real time — if one admin assigns a technician, every other admin sees it immediately without refreshing.

---

### 3. Technician Mobile App (PWA)

Technicians install this on their phone like an app (no App Store required — it works in the browser). It shows only their own jobs.

**What a technician can do on the app:**
- See today's and tomorrow's assigned jobs in a clean list
- Tap a job to see the customer's name, address (with a direct Google Maps link), phone number (tap to call), pest type, and time slot
- **Start travel** — shares their live GPS with the customer via a link (the customer gets a WhatsApp message with the link automatically); GPS updates every 30 seconds
- **Mark job done** or cancel it
- Add private tech notes (visible to admins, not customers)
- Upload before, after, and damage photos directly from their phone camera
- Flag an issue for dispatch (creates an escalation with urgency level)

The customer's tracking page updates live and shows an estimated arrival time. It automatically deactivates once the job is marked complete.

---

## Privacy & Compliance

- Customer conversation history is automatically deleted after 6 months (configurable)
- Customers can opt out of promotional messages at any time by replying STOP
- A DPDP Act-compliant privacy notice is hosted at `/privacy` on the app — this is the notice your customers can refer to
- All data is stored in a Supabase (Postgres) project in the India region (Mumbai)

---

## What We Need From You

To set up Ajax for your business, we need the following. The more complete your answers, the faster we can go live.

---

### 1. Business Information
- Registered company name and brand name
- UEN (business registration number)
- Office address
- Areas / districts you cover
- Operating hours (days and times)
- Do you take bookings on public holidays?

### 2. Your Price List *(most important — please be exact)*
For every pest type you treat, we need:
- The pest name (e.g. cockroaches, rats, termites, bed bugs, mosquitoes…)
- Your price for each service tier:
  - **Standard** — one-off treatment
  - **Plus** — recurring / maintenance plan
  - **Specialist** — complex jobs (if applicable)
- Whether the price is **inclusive or exclusive of GST**, and the GST rate
- Which pest types require an **on-site inspection** before you can quote (e.g. termites, bed bugs)
- What your standard job includes — e.g. "30-day free re-treatment guarantee"
- Roughly how long each job takes (e.g. standard = 60 min, plus = 90 min)

### 3. Policies
- Cancellation and reschedule policy (e.g. "first reschedule free, cancellation within 24h incurs a visit fee")
- How customers pay (e.g. PayNow, cash, card on completion — do you take deposits?)

### 4. Agent Persona
- What should the assistant be called? (e.g. "Asha", "Max")
- Tone — warm and casual, or more formal? Are emoji okay?
- Which languages should it handle? (English, Hindi, regional languages…)
- 2–3 example messages you'd normally send a customer — so we can match your style
- Anything the assistant must **never** say or promise

### 5. Escalation
- Which WhatsApp number should receive urgent alerts when a customer needs a real person? (Must be a WhatsApp-enabled number)
- What response time should Ajax promise customers for high-urgency situations?

### 6. Your Team
For every person who will use the admin dashboard or technician app:

| Name | Email (for login) | Mobile | Role |
|---|---|---|---|
| e.g. Priya Sharma | priya@example.in | +91 98765 43210 | Admin |
| e.g. Ravi Kumar | ravi@example.in | +91 87654 32109 | Technician |

**Admin** — sees all appointments, all conversations, can edit pricing and manage team accounts.
**Technician** — sees only their own assigned jobs on the mobile app.

### 7. WhatsApp / Meta Access
- Is your WhatsApp number currently on **WhatsApp Business API**, the WhatsApp Business app, or a personal number?
  *(We can help migrate if needed — just flag it early as it adds lead time)*
- Who has admin access to your Meta Business Manager? We'll need temporary partner access to set up the webhook and submit message templates.

### 8. Annual Maintenance Contracts (AMC) — if applicable
If you already have customers on recurring contracts, provide a list with:
- Customer name and WhatsApp number
- Pest type covered
- Contract start date and next renewal date
- Monthly or annual price

*(We'll import these so Ajax can handle renewals and reminders immediately.)*

### 9. Legal / Compliance
- Name and email of your privacy contact (or the person who handles data requests)
- Do you already have a privacy policy? If so, please share it — otherwise we'll use our standard DPDP Act notice.
- Pest control licence number (IPCA/state registration, if you have one)

---

## Timeline

| Phase | What happens | Typical time |
|---|---|---|
| You return the information above | We configure Ajax for your business | Day 1–2 |
| WhatsApp template submission | We submit 7 message templates to Meta for approval | 1–48 hours |
| Setup & testing | We test booking, pricing, escalation, and tracking end to end | Day 2–3 |
| Staff onboarding | We walk your admin and technicians through the dashboard and app | 1 hour call |
| Go live | Ajax is live on your WhatsApp number | Day 3–5 |

The main variable is Meta's template approval time. We submit them on day 1 so they're rarely the bottleneck.

---

*Questions? Reply to this message or WhatsApp us directly.*
