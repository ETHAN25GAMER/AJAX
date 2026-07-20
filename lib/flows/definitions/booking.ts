import { supabase } from "@/lib/supabase/client";
import { getPricingQuote } from "@/lib/tools/get_pricing_quote";
import { checkAvailability } from "@/lib/tools/check_availability";
import { createAppointment } from "@/lib/tools/create_appointment";
import { lookupCustomer } from "@/lib/tools/lookup_customer";
import { escalateToHuman } from "@/lib/tools/escalate_to_human";
import { BRAND } from "@/lib/brand";
import type { ActionResult, FlowDef, NextRef, PromptOption } from "../types";

// The appointment-booking flow. Every step is a tap; the only typed answers
// are name and address (text nodes). All pricing/slot/booking effects reuse the
// existing tools with the same verified-phone context injection the agent had.

const END: NextRef = { end: true };

// Option-id conventions (stable, ours): bk:<node>:<value>
const id = (node: string, value: string) => `bk:${node}:${value}`;

export const bookingFlow: FlowDef = {
  id: "booking",
  entry: "menu",
  nodes: {
    // --- Main menu (the flow every conversation opens into) ------------------
    menu: {
      kind: "prompt",
      prompt: async () => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body:
            `Hi! I'm ${BRAND.assistant} from ${BRAND.company}. ` +
            `Tap an option below and I'll sort it out. 👇`,
          buttons: [
            { id: id("menu", "book"), title: "Book a visit" },
            { id: id("menu", "manage"), title: "Manage my booking" },
            { id: id("menu", "human"), title: "Talk to a human" }
          ]
        },
        options: [
          { id: id("menu", "book"), title: "Book a visit", next: "pest" },
          {
            id: id("menu", "manage"),
            title: "Manage my booking",
            next: { goto: { flow: "manage", node: "start" } }
          },
          { id: id("menu", "human"), title: "Talk to a human", next: "escalate" }
        ]
      })
    },

    // --- Pest selection (rows straight from the live rate card) --------------
    pest: {
      kind: "prompt",
      prompt: async () => {
        const db = supabase();
        const { data } = await db
          .from("pricing")
          .select("pest_type, requires_inspection")
          .order("pest_type", { ascending: true })
          .limit(9);
        const rows = (data ?? []).map((p) => ({
          id: id("pest", p.pest_type as string),
          title: capitalize(p.pest_type as string),
          description: p.requires_inspection ? "Free inspection first" : undefined
        }));
        rows.push({ id: id("pest", "other"), title: "Something else", description: undefined });

        const options: PromptOption[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          next: "storePest"
        }));

        return {
          kind: "mcq",
          send: {
            kind: "list",
            body: "What pest are you dealing with?",
            buttonLabel: "Choose pest",
            rows
          },
          options
        };
      }
    },

    // Records which pest row was tapped (id carries it), then asks size.
    storePest: {
      kind: "action",
      run: async (_ctx, data) => {
        // The tapped id was stored by the webhook as data._tapped before advancing.
        const tapped = String(data._tapped ?? "");
        const pest = tapped.startsWith("bk:pest:") ? tapped.slice("bk:pest:".length) : "other";
        return { sends: [], next: "size", data: { pest_type: pest } };
      }
    },

    size: {
      kind: "prompt",
      prompt: async () => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body: "How big is the property?",
          buttons: [
            { id: id("size", "small"), title: "Small (1BHK)" },
            { id: id("size", "medium"), title: "Medium (2-3BHK)" },
            { id: id("size", "large"), title: "Large (4BHK+)" }
          ]
        },
        options: [
          { id: id("size", "small"), title: "Small", next: "quote" },
          { id: id("size", "medium"), title: "Medium", next: "quote" },
          { id: id("size", "large"), title: "Large", next: "quote" }
        ]
      })
    },

    // --- Quote (tool-backed), then the go/no-go MCQ ---------------------------
    quote: {
      kind: "action",
      run: async (_ctx, data): Promise<ActionResult> => {
        const tapped = String(data._tapped ?? "");
        const size = tapped.startsWith("bk:size:")
          ? (tapped.slice("bk:size:".length) as "small" | "medium" | "large")
          : "unknown";
        const pest = String(data.pest_type ?? "other");

        if (pest === "other") {
          // No rate-card row — skip the quote, go straight to slots.
          return { sends: [], next: "slots", data: { property_size: size } };
        }

        const quote = await getPricingQuote({ pest_type: pest, property_size: size });
        if ("error" in quote) {
          return { sends: [], next: "slots", data: { property_size: size } };
        }

        if (quote.requires_inspection) {
          return {
            sends: [
              {
                kind: "text",
                body:
                  `For ${pest} we do a free on-site inspection first — the technician ` +
                  `confirms the exact price before any work starts.`
              }
            ],
            next: "quoteChoice",
            data: { property_size: size, quote_label: "free inspection" }
          };
        }

        const label = `₹${quote.price_low}–₹${quote.price_high}`;
        return {
          sends: [
            {
              kind: "text",
              body:
                `For ${pest} (${size} property) you're looking at ${label}, ` +
                `including our 30-day re-treatment guarantee.`
            }
          ],
          next: "quoteChoice",
          data: { property_size: size, quote_label: label }
        };
      }
    },

    quoteChoice: {
      kind: "prompt",
      prompt: async () => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body: "Want to lock in a visit?",
          buttons: [
            { id: id("go", "slots"), title: "See available slots" },
            { id: id("go", "later"), title: "Not now" },
            { id: id("go", "team"), title: "Ask the team" }
          ]
        },
        options: [
          { id: id("go", "slots"), title: "See available slots", next: "slots" },
          { id: id("go", "later"), title: "Not now", next: "later" },
          { id: id("go", "team"), title: "Ask the team", next: "escalate" }
        ]
      })
    },

    later: {
      kind: "action",
      run: async () => ({
        sends: [
          {
            kind: "text",
            body: "No problem — message me anytime and we'll pick it up from here. 👋"
          }
        ],
        next: END
      })
    },

    // --- Slot selection (live availability) ----------------------------------
    slots: {
      kind: "prompt",
      prompt: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const horizon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
        const avail = await checkAvailability({ start_date: today, end_date: horizon });

        const slots = ("slots" in avail ? avail.slots : []) ?? [];
        const rows = slots.slice(0, 9).map((s) => ({
          id: id("slot", s.slot_start),
          title: s.label.slice(0, 24),
          description: undefined as string | undefined
        }));
        rows.push({ id: id("slot", "none"), title: "None of these work", description: undefined });

        const options: PromptOption[] = [
          ...slots.slice(0, 9).map((s) => ({
            id: id("slot", s.slot_start),
            title: s.label,
            next: "storeSlot" as NextRef
          })),
          { id: id("slot", "none"), title: "None of these work", next: "escalate" }
        ];

        return {
          kind: "mcq",
          send:
            rows.length > 1
              ? {
                  kind: "list",
                  body: "Here are the next available visit slots (90 min each):",
                  buttonLabel: "Pick a slot",
                  rows
                }
              : {
                  kind: "buttons",
                  body: "We're fully booked for the next few days — want the team to call you?",
                  buttons: [{ id: id("slot", "none"), title: "Yes, contact me" }]
                },
          options
        };
      }
    },

    storeSlot: {
      kind: "action",
      run: async (_ctx, data) => {
        const tapped = String(data._tapped ?? "");
        const slot = tapped.startsWith("bk:slot:") ? tapped.slice("bk:slot:".length) : "";
        const title = String(data._tappedTitle ?? "");
        return { sends: [], next: "details", data: { slot_start: slot, slot_label: title } };
      }
    },

    // --- Contact details (saved shortcut, else typed) -------------------------
    details: {
      kind: "action",
      run: async (ctx, _data): Promise<ActionResult> => {
        const known = await lookupCustomer({ customer_phone: ctx.customerPhone });
        if ("found" in known && known.found && known.name && known.address) {
          return {
            sends: [],
            next: "savedDetails",
            data: { saved_name: known.name, saved_address: known.address }
          };
        }
        return { sends: [], next: "name" };
      }
    },

    savedDetails: {
      kind: "prompt",
      prompt: async (_ctx, data) => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body: `Book under the details we have on file?\n\n${data.saved_name}\n${data.saved_address}`,
          buttons: [
            { id: id("saved", "yes"), title: "Use saved details" },
            { id: id("saved", "no"), title: "Enter new details" }
          ]
        },
        options: [
          { id: id("saved", "yes"), title: "Use saved details", next: "useSaved" },
          { id: id("saved", "no"), title: "Enter new details", next: "name" }
        ]
      })
    },

    useSaved: {
      kind: "action",
      run: async (_ctx, data) => ({
        sends: [],
        next: "confirm",
        data: { name: data.saved_name, address: data.saved_address }
      })
    },

    name: {
      kind: "prompt",
      prompt: async () => ({
        kind: "text",
        send: { kind: "text", body: "What name should the booking be under?" },
        field: "name",
        next: "address"
      })
    },

    address: {
      kind: "prompt",
      prompt: async () => ({
        kind: "text",
        send: { kind: "text", body: "And the full address for the visit?" },
        field: "address",
        next: "confirm"
      })
    },

    // --- Confirm + book -------------------------------------------------------
    confirm: {
      kind: "prompt",
      prompt: async (_ctx, data) => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body:
            `Please confirm your booking:\n\n` +
            `🐜 ${capitalize(String(data.pest_type ?? "pest"))} treatment` +
            (data.quote_label ? ` (${data.quote_label})` : "") +
            `\n🗓 ${data.slot_label}\n👤 ${data.name}\n📍 ${data.address}`,
          buttons: [
            { id: id("confirm", "yes"), title: "Confirm booking" },
            { id: id("confirm", "slot"), title: "Change slot" }
          ]
        },
        options: [
          { id: id("confirm", "yes"), title: "Confirm booking", next: "book" },
          { id: id("confirm", "slot"), title: "Change slot", next: "slots" }
        ]
      })
    },

    book: {
      kind: "action",
      run: async (ctx, data): Promise<ActionResult> => {
        const result = await createAppointment({
          customer_phone: ctx.customerPhone,
          name: String(data.name ?? ""),
          address: String(data.address ?? ""),
          pest_type: String(data.pest_type ?? "other"),
          slot_start: String(data.slot_start ?? "")
        });

        if ("error" in result) {
          // Most likely: the slot was just taken. Offer fresh slots.
          return {
            sends: [
              {
                kind: "text",
                body: "That slot was just taken — here are the latest openings:"
              }
            ],
            next: "slots"
          };
        }

        const deposit =
          "deposit_link" in result && result.deposit_link
            ? `\n\nTo hold priority you can pay the ₹${result.deposit_amount_inr} deposit here (optional): ${result.deposit_link}`
            : "";

        return {
          sends: [
            {
              kind: "text",
              body:
                `You're booked! ✅\n\nConfirmation code: *${result.confirmation_code}*\n` +
                `${data.slot_label}\n${data.address}\n\n` +
                `We'll remind you the day before, and you'll get a live tracking link ` +
                `when the technician heads your way.${deposit}`
            }
          ],
          next: END
        };
      }
    },

    // --- Human hand-off -------------------------------------------------------
    escalate: {
      kind: "action",
      run: async (ctx, data): Promise<ActionResult> => {
        const summary =
          `Customer asked for a human via the WhatsApp menu` +
          (data.pest_type ? ` (pest: ${data.pest_type}` : "") +
          (data.quote_label && data.pest_type ? `, quoted ${data.quote_label})` : data.pest_type ? ")" : "");
        await escalateToHuman({
          customer_phone: ctx.customerPhone,
          summary,
          urgency: "normal"
        });
        return {
          sends: [
            {
              kind: "text",
              body:
                "Done — a member of our team will message you here shortly. " +
                "If it's urgent, call us and mention this chat."
            }
          ],
          next: END
        };
      }
    }
  }
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
