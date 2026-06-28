// White-label config. A new client sets these in .env — no code edits needed.
// NEXT_PUBLIC_ prefix so values are also available in client components
// (e.g. track-client.tsx); Next inlines them at build time, per-deployment.
//
// The three non-env per-client artifacts that live alongside these:
//   - skills/persona.md            (the agent's brief — assistant name, hours, area)
//   - supabase/migrations/0001…    (pricing seed)
//   - the .env values below
export const BRAND = {
  // Customer-facing company name (WhatsApp messages, tracking page, privacy notice).
  company: process.env.NEXT_PUBLIC_COMPANY_NAME ?? process.env.COMPANY_NAME ?? "GreenShield Pest Control",
  // The assistant's name — keep in sync with skills/persona.md.
  assistant: process.env.NEXT_PUBLIC_ASSISTANT_NAME ?? "Ajax",
  // Staff console / PWA name (admin + technician UI, browser tabs, install name).
  app: process.env.NEXT_PUBLIC_APP_NAME ?? "PestLLM",
} as const;
