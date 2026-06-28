# Havier Pest Control — Beta Setup Notes

All API keys and Supabase credentials stay the same. Only update the client-specific env vars below.

---

## 1. Env vars to update in `.env.local`

```env
# Company identity
COMPANY_NAME=Havier Pest Control

# Escalation — WhatsApp number that receives `escalate_to_human` alerts
TECHNICIAN_ESCALATION_PHONE=919653411753

# Legal / privacy notice (adjust as needed for beta)
DPO_NAME=Havier Rastogi
DPO_EMAIL=privacy@havierpestcontrol.in
```

Leave all other vars (ANTHROPIC_API_KEY, WHATSAPP_*, SUPABASE_*, CRON_SECRET) unchanged.

---

## 2. Run the seed script

Open **Supabase Studio → SQL Editor** and run the full contents of:

```
supabase/seed_havier.sql
```

This:
- Truncates all data tables (customers, appointments, conversations, AMC, escalations, etc.)
- Seeds pricing in INR for cockroaches, rats, lizards, and termites
- Inserts 8 fake AMC customers with staggered monthly contract dates
- Resets deployment tier to `tier2`

> **Auth users are NOT affected.** Supabase Auth users (profiles/technicians) must be re-invited manually.

---

## 3. Invite technicians

From the running app, go to **Admin → Users → Invite** and send email invites to both technicians. After they accept and log in, update their profiles in Supabase Studio:

```sql
-- Set name and phone after they've accepted the invite
-- Replace <uid> with the actual auth.users UUID from the profiles table

update profiles set
  full_name = 'Nirvan',
  phone     = '917738287831',
  role      = 'technician'
where id = '<nirvan-uid>';

update profiles set
  full_name = 'Sourav',
  phone     = '919136274331',
  role      = 'technician'
where id = '<sourav-uid>';
```

---

## 4. Promote admin user

After the owner/manager logs in for the first time:

```sql
update profiles set role = 'admin' where id = '<owner-uid>';
```

---

## 5. Business details summary

| Field | Value |
|---|---|
| Company name | Havier Pest Control |
| Location | Marine Lines, Mumbai – 400064 |
| Service area | Marine Lines, Churchgate, Grant Road, Charni Road, Girgaon, CST |
| Operating hours | Mon–Sat 09:00–18:00 IST |
| Timezone | Asia/Kolkata (IST, UTC+5:30) |
| Currency | INR (₹), inclusive of 18% GST |
| Languages | English, Hindi, Marathi |
| Agent name | Asha |
| Escalation number | +91 96534 11753 |

---

## 6. Technician roster

| Name | WhatsApp | Role |
|---|---|---|
| Nirvan | +91 77382 87831 | Technician |
| Sourav | +91 91362 74331 | Technician |

---

## 7. AMC contracts (8 seeded)

| Customer | Pest | Monthly rate | Commenced | Next renewal |
|---|---|---|---|---|
| Ananya Sharma | Cockroaches | ₹800 | 15 Jan 2026 | 15 Jul 2026 |
| Rajesh Gupta | Rats | ₹1,200 | 1 Feb 2026 | 1 Jul 2026 |
| Priya Mehta | Lizards | ₹600 | 20 Feb 2026 | 20 Jul 2026 |
| Vikram Sharma | Cockroaches | ₹800 | 5 Mar 2026 | 5 Jul 2026 |
| Kavya Nair | Termites | ₹2,000 | 15 Mar 2026 | 15 Jul 2026 |
| Arjun Desai | Cockroaches | ₹800 | 1 Apr 2026 | 1 Jul 2026 |
| Sunita Joshi | Rats | ₹1,200 | 22 Apr 2026 | 22 Jul 2026 |
| Mohammed Khan | Lizards | ₹600 | 10 May 2026 | 10 Jul 2026 |

---

## 8. Pricing summary (INR, 18% GST included)

### Cockroaches
| Tier | Base | Per sqft |
|---|---|---|
| Standard | ₹1,800 | ₹0.50 |
| Plus | ₹2,400 | ₹0.80 |
| Specialist | ₹4,500 | ₹1.50 |

### Rats
| Tier | Base | Per sqft |
|---|---|---|
| Standard | ₹2,200 | ₹0.80 |
| Plus | ₹3,600 | ₹1.20 |
| Specialist | Inspection required | — |

### Lizards
| Tier | Base | Per sqft |
|---|---|---|
| Standard | ₹1,000 | ₹0.25 |
| Plus | ₹1,800 | ₹0.40 |

### Termites
All tiers require on-site inspection before quote.
