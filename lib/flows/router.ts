import { anthropic, MODEL_FAST } from "@/lib/claude/client";
import type { FlowState } from "./types";

// The ONLY place a model touches the customer path — and it never writes
// customer-facing prose. When free text arrives at an MCQ node, the router
// maps it to one of the options the customer can see, sends them back to the
// main menu, or hands them to a human. Anything else (model error, garbage
// output, timeout) FAILS OPEN: the webhook re-presents the current MCQ, so a
// broken LLM can never block a conversation.

export type RouteVerdict =
  | { action: "select"; optionId: string }
  | { action: "menu" }
  | { action: "escalate" }
  | { action: "represent" }; // fail-open default

// Greeting / menu keywords resolve without a model call — these are the
// overwhelmingly common free-text messages.
const MENU_WORDS = new Set([
  "hi", "hii", "hiii", "hello", "hey", "yo", "menu", "start", "restart",
  "namaste", "hola", "good morning", "good afternoon", "good evening", "back"
]);

export function keywordRoute(text: string): RouteVerdict | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (MENU_WORDS.has(t)) return { action: "menu" };
  return null;
}

export async function routeFreeText(state: FlowState, text: string): Promise<RouteVerdict> {
  const options = state.options ?? [];
  if (options.length === 0) return { action: "represent" };

  try {
    const client = anthropic();
    const resp = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 200,
      system:
        "You route a pest-control customer's typed WhatsApp message onto a fixed menu. " +
        "Never answer the customer; only classify. Choose select_option when the text " +
        "clearly means one of the visible options (e.g. 'the second one', 'rats', " +
        "'tuesday morning slot'). Choose main_menu when they want something different " +
        "that the menu covers (booking, rescheduling, prices). Choose human when they " +
        "are upset, report an emergency/bite/complaint, or explicitly ask for a person. " +
        "Choose unclear otherwise.",
      tools: [
        {
          name: "route_reply",
          description: "Classify the customer's message against the visible options.",
          input_schema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["select_option", "main_menu", "human", "unclear"]
              },
              option_id: {
                type: "string",
                description: "Required when action=select_option — one of the listed ids."
              }
            },
            required: ["action"]
          }
        }
      ],
      tool_choice: { type: "tool", name: "route_reply" },
      messages: [
        {
          role: "user",
          content:
            `Current question shown to the customer (flow "${state.flow}", step "${state.node}"):\n` +
            options.map((o) => `- id: ${o.id} | label: ${o.title}`).join("\n") +
            `\n\nCustomer typed: "${text.slice(0, 500)}"`
        }
      ]
    });

    const toolUse = resp.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use"
    );
    const input = (toolUse?.input ?? {}) as { action?: string; option_id?: string };

    if (input.action === "select_option" && typeof input.option_id === "string") {
      // Trust but verify — the id must be one the customer was actually shown.
      if (options.some((o) => o.id === input.option_id)) {
        return { action: "select", optionId: input.option_id };
      }
      return { action: "represent" };
    }
    if (input.action === "main_menu") return { action: "menu" };
    if (input.action === "human") return { action: "escalate" };
    return { action: "represent" };
  } catch (err) {
    console.error("[flow router] failed open", err);
    return { action: "represent" };
  }
}
