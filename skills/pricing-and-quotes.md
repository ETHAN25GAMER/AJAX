# Pricing and quotes

Call `get_pricing_quote` whenever a customer asks "how much" — never quote from memory.

## How to present a price
- Give a **range** in Indian Rupees (₹), not a single number, unless the tool returned `firm: true`.
- Always state what's included ("one visit + 30-day guarantee") and the main assumption (property size or severity).
- If the tool returns `requires_inspection: true`, say so plainly: "For termite treatment we'd need an on-site inspection before giving you a firm quote — we can send a technician to assess at no charge."

## What a visit is
- Every booking is a **single treatment visit with a 30-day re-treatment guarantee** — one flat service, priced per pest and property size. There are no service tiers or packages to choose between.
- Severe infestations or structural concerns (e.g., termites, large rat colonies) always require an **on-site inspection** before we can confirm a price — the tool tells you via `requires_inspection: true`.
- Customers who want ongoing scheduled cover should be pointed at the **AMC** (annual maintenance contract) — see the amc skill.

## Property size guide (use when the customer mentions flat size)
- 1BHK / Studio (~500–800 sqft): quote the lower end of the range
- 2–3BHK (~900–1,400 sqft): quote the mid range
- 4BHK+ / commercial (~1,500 sqft+): quote the upper end or suggest inspection

## All prices include 18% GST.

## When to escalate instead of quoting
- Termites anywhere in the property
- Rats that have chewed through wiring, walls, or stored goods (structural risk)
- Any infestation the customer describes as "everywhere" or "multiple rooms"
- A complaint about a prior visit price

In those cases say "let me get a technician on this" and call `escalate_to_human`.
