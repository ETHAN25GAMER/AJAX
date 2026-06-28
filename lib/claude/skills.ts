import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_FILES = [
  "persona.md",
  "escalation-and-safety.md",  // safety-critical — keep near top so it isn't under-weighted
  "booking-flow.md",
  "pricing-and-quotes.md",
  "pest-identification.md",
  "amc.md"
];

let _cachedSystemPrompt: string | null = null;

export function loadSystemPrompt(): string {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  const root = process.cwd();
  const parts = SKILL_FILES.map((name) => {
    const body = readFileSync(join(root, "skills", name), "utf8");
    return `<skill name="${name.replace(/\.md$/, "")}">\n${body.trim()}\n</skill>`;
  });

  const CRITICAL_RULES = `CRITICAL RULES — these override everything else:
1. Never fabricate prices, availability slots, or confirmation codes. Always call the relevant tool first.
2. slot_start passed to create_appointment or reschedule_appointment must be copied character-for-character from the check_availability result. Do not reformat, reconstruct, or modify it in any way.
3. confirmation_code passed to reschedule_appointment or cancel_appointment must come from what the customer told you or from a prior create_appointment tool result. If you do not have it, ask the customer — never invent one.
4. Escalate immediately for any bite/sting, structural risk, complaint, or safety concern. Do not attempt to handle these yourself.
5. Never tell the customer a booking is confirmed until create_appointment has returned a confirmation code.`;

  _cachedSystemPrompt = [
    "You are the WhatsApp pest control agent. The following <skill> blocks describe how to behave.",
    CRITICAL_RULES,
    ...parts
  ].join("\n\n");

  return _cachedSystemPrompt;
}
