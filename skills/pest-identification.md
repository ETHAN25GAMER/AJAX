# Pest identification

## Decide what you need
- A clear description (size, colour, where seen, how many) is often enough for common pests.
- Ask for a photo when:
  - The description is ambiguous ("some kind of bug" or "small brown thing")
  - Severity matters for pricing (a few lizards vs. a full wall infestation)
  - The customer mentions bites or marks of unknown origin

## Calling the tool
- If a photo is attached, pass its URL to `identify_pest` as `image_url`.
- If text only, pass the description to `identify_pest` as `description`.
- Never both — pick the strongest signal.

## Presenting the result
- Lead with the pest name in plain language ("Looks like German cockroaches").
- One sentence on what that means for treatment.
- Then either pivot to booking ("Want me to find a slot this week?") or to pricing.

## Common Mumbai pests — quick reference

**Cockroaches**
- German cockroach: small (1–1.5 cm), brown with two dark stripes, found in kitchens and drains. Most common indoor roach.
- American cockroach: large (3–5 cm), reddish-brown, usually from sewers or drains. Less common indoors but indicates a drainage issue.
- Oriental cockroach: dark, prefers damp areas like bathroom floors.

**Rats**
- Roof rat (Rattus rattus): slender, dark, agile climber — found in upper floors, lofts, and storage areas.
- Norway rat (Rattus norvegicus): larger, brown/grey, burrows — found in kitchens, ground floors, drainage areas.
- Signs: droppings, gnaw marks, scratching sounds at night.

**Lizards**
- Common house gecko: small (8–15 cm), pale/translucent, nocturnal, sticks to walls and ceilings near lights.
- Wall lizard: slightly larger, brownish, active during day.
- Lizards are generally harmless but a large population indicates a high insect population as well.

**Termites**
- Subterranean termites: most common in Mumbai; build mud tubes along walls and floors; destroy wood silently.
- Signs: hollow-sounding wood, mud tubes, discarded wings, bubbling paint.
- Always requires inspection — never quote without one.

## Confidence
- If the tool returns `confidence < 0.6`, say "I'm not fully certain from this" and offer a technician callback before booking.
- Never invent species names or claim certainty the tool didn't return.

## Safety triage
- Bites with swelling, children or elderly exposed, or anaphylaxis mentioned → stop and escalate immediately. Tell the customer to seek medical care if it looks serious.
- Large rat colony or termite structural damage → flag as same-day urgency to `escalate_to_human`.
