# PestLLM — Monthly Cost Sheet

Running-cost estimate for the WhatsApp pest-control AI agent in production.
Prepared for internal planning. **All figures are estimates** — verify against each
provider's current pricing before committing budget.

| | |
|---|---|
| **Prepared** | 2026-06-12 |
| **Exchange rate used** | ~₹86 / US$1 (approximate — FX moves) |
| **Production LLM** | Claude Fable 5 (`claude-fable-5`) — set `ANTHROPIC_MODEL=claude-sonnet-4-6` to cut the AI line ~3× |
| **Local/dev LLM** | Gemma / qwen via local proxy — **₹0** (free) |

---

## TL;DR

A small pest-control business doing ~500 WhatsApp bookings/month should budget
**~₹15,900–23,000/month** all-in on Fable 5. Roughly three-quarters is the AI
(Claude); the rest is hosting (Vercel), database (Supabase), and WhatsApp (Meta).
On Sonnet 4.6 instead, the all-in drops to **~₹7,300–10,100/month**.

**Testing/development costs ₹0** — we only start paying when the bot goes live on
Claude. WhatsApp, Supabase, and Vercel each have free tiers that work for a pilot.

---

## The four cost components

### 1. Claude (the AI agent) — usage-based

Fable 5 token pricing (Sonnet 4.6, the cheaper fallback, in parentheses):

| | Per 1M tokens (US$) | Per 1M tokens (₹) |
|---|---|---|
| Input | $10.00 ($3.00) | ₹860 (₹258) |
| Output | $50.00 ($15.00) | ₹4,300 (₹1,290) |
| Cache read (~0.1× input) | $1.00 ($0.30) | ₹86 (₹26) |
| Cache write (5-min cache, 1.25× input) | $12.50 ($3.75) | ₹1,075 (₹322) |

Cost per WhatsApp conversation on Fable 5, with prompt caching on. Estimates
include adaptive thinking, which is now enabled in the agent loop and bills its
reasoning as output tokens on harder turns:

| Conversation type | US$ | ₹ |
|---|---|---|
| Full booking (~6–8 turns, tool calls) | ~$0.40–0.45 | ~₹35–39 |
| Quick question ("do you treat termites?") | ~$0.07–0.13 | ~₹6–11 |
| **Blended average** | **~$0.32** | **~₹28** |

> ⚠️ **Prompt caching is critical.** It caches the system prompt + tool definitions
> so we don't re-pay for them every turn. Without it, Claude cost runs **3–4× higher**.

Claude cost by monthly volume:

| Conversations/month | US$ (Fable 5) | ₹ (Fable 5) | ₹ (Sonnet 4.6) |
|---|---|---|---|
| 100 | $30–45 | ₹2,600–3,900 | ₹700–1,000 |
| 500 | $140–210 | ₹12,000–18,100 | ₹3,400–5,200 |
| 1,000 | $280–420 | ₹24,100–36,100 | ₹6,900–10,300 |
| 3,000 | $840–1,260 | ₹72,200–108,400 | ₹20,600–31,000 |

### 2. WhatsApp Cloud API (Meta) — per-message, India rates

| Message type | When it's used | Approx. cost |
|---|---|---|
| **Service** | Replying to a customer within 24h of their message | **Free** (most regions) |
| **Utility template** | Booking confirmations, reminders, en-route alerts | ~₹0.10–0.16 each |
| **Marketing template** | Promotions, re-engagement blasts | ~₹0.70–0.80 each |

Our bot is mostly **service** (answering inquiries) plus some **utility** (confirmations),
so for a few hundred bookings/month this stays small: **~₹0–1,000/month**. Heavy
marketing blasts would push it up.

### 3. Supabase (database, auth, file storage)

| Tier | Monthly | Notes |
|---|---|---|
| **Free** | ₹0 | Works for low volume, but **pauses after ~1 week idle** and no daily backups — risky for production |
| **Pro** | $25 (~₹2,150) | No pausing, daily backups, more capacity — **recommended for production** |

### 4. Vercel (hosting the app + webhook)

| Tier | Monthly | Notes |
|---|---|---|
| **Hobby** | ₹0 | **Non-commercial use only** — a paying business technically needs Pro |
| **Pro** | $20 (~₹1,720) | Required for commercial production use |

---

## Total monthly cost — three scenarios

### A. Pilot / validation (low volume, free infra)
| Item | ₹ / month |
|---|---|
| Claude (~100 conversations, Fable 5) | 2,600–3,900 |
| WhatsApp | 0–200 |
| Supabase (Free) | 0 |
| Vercel (Hobby*) | 0 |
| **Total** | **~₹2,600–4,100** |

\* Hobby is non-commercial; acceptable only while validating, not for a live paying service.

### B. Small business production (~500 bookings/month)
| Item | ₹ / month |
|---|---|
| Claude (Fable 5) | 12,000–18,100 |
| WhatsApp | 0–1,000 |
| Supabase (Pro) | 2,150 |
| Vercel (Pro) | 1,720 |
| **Total** | **~₹15,900–23,000** (on Sonnet 4.6: ~₹7,300–10,100) |

### C. Growing business (~1,000 bookings/month)
| Item | ₹ / month |
|---|---|
| Claude (Fable 5) | 24,100–36,100 |
| WhatsApp | 500–2,000 |
| Supabase (Pro) | 2,150 |
| Vercel (Pro) | 1,720 |
| **Total** | **~₹28,500–42,000** (on Sonnet 4.6: ~₹11,300–16,200) |

---

## Levers to reduce cost

- **Stay on free infra while validating** — Supabase Free + Vercel Hobby = ₹0 (accept the pausing / non-commercial caveats until there's paying volume).
- **Keep WhatsApp service-only** — avoid marketing template blasts; service replies are free.
- **Drop to Sonnet 4.6 if quality holds** — `ANTHROPIC_MODEL=claude-sonnet-4-6` is a one-env-var change that cuts the Claude line ~3×; A/B it against Fable on real conversations.
- **Keep prompt caching on** — single biggest lever on the Claude bill (3–4×).
- **Test locally for free** — Gemma/qwen via the local proxy costs ₹0; the Claude bill only starts in production.
- **Tune model effort / conversation length** — shorter, more efficient agent loops directly lower the Claude per-conversation cost.

---

## Important caveats

1. **Estimates, not quotes.** Real Claude cost depends on actual conversation length
   and tool-call count — measure live usage (the API returns token counts) and
   re-baseline after the first month.
2. **Pricing changes.** WhatsApp's India rates in particular are complex and revised
   periodically — confirm current rates with Meta, Supabase, and Vercel before budgeting.
3. **FX risk.** ₹ figures assume ~₹86/US$; the dollar-denominated bills (Claude,
   Supabase, Vercel) move with the exchange rate.
4. **One-time / excluded costs** not in this sheet: domain name, any paid phone number
   for WhatsApp, developer time, and Meta Business verification.
