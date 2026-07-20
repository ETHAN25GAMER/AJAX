// Abandoned-booking detection for the recovery cron.
//
// A thread is an "abandoned booking" when the customer showed real booking
// intent — the agent ran get_pricing_quote or check_availability — but no
// create_appointment succeeded afterwards. Those threads get one personalized
// recovery message (app/api/cron/abandoned-bookings/route.ts) instead of the
// generic nudge; the nudge cron defers to this detector so a thread is never
// messaged by both.
//
// Pure functions over the stored Anthropic MessageParam[] shape — no I/O — so
// they can be exercised directly (same reasoning style as lib/tracking.ts).

export type AbandonedBooking = {
  pestType: string | null;
  priceLabel: string | null; // e.g. "₹269–₹344" — null when no price was quoted
};

// MCQ-era signal: the customer entered the booking flow, got past choosing a
// pest, and went quiet. flow_state is the source of truth now that agent
// tool_results no longer appear in new transcripts.
const BOOKING_PROGRESS_NODES = new Set([
  "size", "quote", "quoteChoice", "slots", "storeSlot",
  "details", "savedDetails", "useSaved", "name", "address", "confirm"
]);

export function detectAbandonedFlowBooking(flowState: unknown): AbandonedBooking | null {
  if (!flowState || typeof flowState !== "object") return null;
  const s = flowState as { flow?: unknown; node?: unknown; data?: Record<string, unknown> };
  if (s.flow !== "booking" || typeof s.node !== "string") return null;
  if (!BOOKING_PROGRESS_NODES.has(s.node)) return null;
  const data = s.data ?? {};
  return {
    pestType: typeof data.pest_type === "string" ? data.pest_type : null,
    priceLabel: typeof data.quote_label === "string" ? data.quote_label : null
  };
}

type Block = {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
};

const INTENT_TOOLS = new Set(["get_pricing_quote", "check_availability"]);

export function detectAbandonedBooking(state: unknown): AbandonedBooking | null {
  if (!Array.isArray(state)) return null;

  let lastIntentIndex = -1;
  let pestType: string | null = null;
  let priceLabel: string | null = null;
  let lastBookedIndex = -1;

  // Single forward pass: remember the latest intent signal, and the latest
  // create_appointment that actually returned a confirmation code (the tool
  // returns { error } on failure — a failed booking is still abandoned intent).
  const pendingBookingIds = new Set<string>();

  for (let i = 0; i < state.length; i++) {
    const msg = state[i] as { role?: string; content?: unknown };
    if (!msg || typeof msg !== "object" || !Array.isArray(msg.content)) continue;

    for (const raw of msg.content) {
      const b = raw as Block;
      if (!b || typeof b !== "object") continue;

      if (b.type === "tool_use" && typeof b.name === "string") {
        if (INTENT_TOOLS.has(b.name)) {
          lastIntentIndex = i;
          const input = b.input as { pest_type?: unknown } | undefined;
          if (typeof input?.pest_type === "string" && input.pest_type.trim()) {
            pestType = input.pest_type.trim();
          }
        } else if (b.name === "create_appointment" && typeof b.id === "string") {
          pendingBookingIds.add(b.id);
        }
      }

      if (b.type === "tool_result") {
        const payload = parseResult(b.content);
        if (
          typeof b.tool_use_id === "string" &&
          pendingBookingIds.has(b.tool_use_id) &&
          typeof payload?.confirmation_code === "string"
        ) {
          lastBookedIndex = i;
        }
        // Capture the quoted range from the most recent pricing result.
        if (typeof payload?.price_low === "number" && typeof payload?.price_high === "number") {
          priceLabel = formatPriceRange(payload.price_low, payload.price_high, payload.currency);
          if (typeof payload.pest_type === "string" && payload.pest_type.trim()) {
            pestType = payload.pest_type.trim();
          }
        }
      }
    }
  }

  if (lastIntentIndex === -1) return null;
  if (lastBookedIndex >= lastIntentIndex) return null; // they booked — nothing to recover
  return { pestType, priceLabel };
}

// Tool results are stored as JSON.stringify'd strings (lib/claude/agent.ts).
function parseResult(content: unknown): {
  confirmation_code?: unknown;
  price_low?: unknown;
  price_high?: unknown;
  currency?: unknown;
  pest_type?: unknown;
} | null {
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatPriceRange(low: number, high: number, currency: unknown): string {
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency ?? ""} `;
  return `${symbol}${low}–${symbol}${high}`;
}
