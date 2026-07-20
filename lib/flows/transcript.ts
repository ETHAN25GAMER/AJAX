import type { Send } from "./types";

// Transcript turns in the same Anthropic MessageParam shape the agent used, so
// the conversations UI, human takeover, SLA logging, and retention all keep
// working over flow-driven conversations without change.

export type TranscriptTurn = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
};

export function userTurn(text: string): TranscriptTurn {
  return { role: "user", content: [{ type: "text", text }] };
}

// One assistant turn per send, options rendered as a bulleted summary so the
// admin transcript reads like the customer's screen.
export function assistantTurnsFor(sends: Send[]): TranscriptTurn[] {
  return sends.map((s) => {
    let text = s.body;
    if (s.kind === "buttons") {
      text += "\n" + s.buttons.map((b) => `▢ ${b.title}`).join("  ");
    } else if (s.kind === "list") {
      text += "\n" + s.rows.map((r) => `• ${r.title}`).join("\n");
    }
    return { role: "assistant" as const, content: [{ type: "text" as const, text }] };
  });
}
