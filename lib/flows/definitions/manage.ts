import { supabase } from "@/lib/supabase/client";
import { checkAvailability } from "@/lib/tools/check_availability";
import { rescheduleAppointment } from "@/lib/tools/reschedule_appointment";
import { cancelAppointment } from "@/lib/tools/cancel_appointment";
import { formatSlotTime, shortDate } from "@/lib/time";
import type { ActionResult, FlowDef, NextRef, PromptOption } from "../types";

// Manage-my-booking flow: pick an upcoming appointment (looked up by the
// verified phone — no code typing needed), then reschedule or cancel it.
// The reminder template's quick-reply taps jump straight to `reslots` /
// `cancelConfirm` with the confirmation code pre-bound.

const END: NextRef = { end: true };
const id = (node: string, value: string) => `mg:${node}:${value}`;

export const manageFlow: FlowDef = {
  id: "manage",
  entry: "start",
  nodes: {
    start: {
      kind: "action",
      run: async (ctx): Promise<ActionResult> => {
        const db = supabase();
        const { data: customer } = await db
          .from("customers")
          .select("id")
          .eq("phone", ctx.customerPhone)
          .maybeSingle();

        const { data: appts } = customer
          ? await db
              .from("appointments")
              .select("confirmation_code, pest_type, slot_start")
              .eq("customer_id", customer.id)
              .eq("status", "booked")
              .gte("slot_start", new Date().toISOString())
              .order("slot_start", { ascending: true })
              .limit(5)
          : { data: [] as never[] };

        if (!appts || appts.length === 0) {
          return {
            sends: [],
            next: "noneFound"
          };
        }
        // Stash for the picker prompt.
        return {
          sends: [],
          next: "pick",
          data: {
            upcoming: appts.map((a) => ({
              code: a.confirmation_code as string,
              label: `${shortDate(a.slot_start as string)} ${formatSlotTime(a.slot_start as string)} · ${a.pest_type}`
            }))
          }
        };
      }
    },

    noneFound: {
      kind: "prompt",
      prompt: async () => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body: "I couldn't find an upcoming booking under this number.",
          buttons: [
            { id: id("none", "book"), title: "Book a visit" },
            { id: id("none", "code"), title: "I have a code" },
            { id: id("none", "menu"), title: "Main menu" }
          ]
        },
        options: [
          {
            id: id("none", "book"),
            title: "Book a visit",
            next: { goto: { flow: "booking", node: "pest" } }
          },
          { id: id("none", "code"), title: "I have a code", next: "askCode" },
          {
            id: id("none", "menu"),
            title: "Main menu",
            next: { goto: { flow: "booking", node: "menu" } }
          }
        ]
      })
    },

    askCode: {
      kind: "prompt",
      prompt: async () => ({
        kind: "text",
        send: {
          kind: "text",
          body: "Type the 6-character confirmation code from your booking message."
        },
        field: "typed_code",
        next: "checkCode"
      })
    },

    checkCode: {
      kind: "action",
      run: async (_ctx, data): Promise<ActionResult> => {
        const code = String(data.typed_code ?? "").trim().toUpperCase();
        const db = supabase();
        const { data: appt } = await db
          .from("appointments")
          .select("confirmation_code, pest_type, slot_start, status")
          .eq("confirmation_code", code)
          .maybeSingle();

        if (!appt || appt.status !== "booked") {
          return {
            sends: [
              { kind: "text", body: "That code doesn't match an active booking — let's try again." }
            ],
            next: "noneFound"
          };
        }
        return {
          sends: [],
          next: "action",
          data: {
            confirmation_code: appt.confirmation_code,
            appt_label: `${shortDate(appt.slot_start as string)} ${formatSlotTime(appt.slot_start as string)} · ${appt.pest_type}`
          }
        };
      }
    },

    pick: {
      kind: "prompt",
      prompt: async (_ctx, data) => {
        const upcoming = (data.upcoming ?? []) as Array<{ code: string; label: string }>;
        const rows = upcoming.map((a) => ({
          id: id("appt", a.code),
          title: a.label.slice(0, 24),
          description: `Code ${a.code}`
        }));
        const options: PromptOption[] = upcoming.map((a) => ({
          id: id("appt", a.code),
          title: a.label,
          next: "storePick"
        }));
        return {
          kind: "mcq",
          send: {
            kind: "list",
            body: "Which booking?",
            buttonLabel: "Choose booking",
            rows
          },
          options
        };
      }
    },

    storePick: {
      kind: "action",
      run: async (_ctx, data) => {
        const tapped = String(data._tapped ?? "");
        const code = tapped.startsWith("mg:appt:") ? tapped.slice("mg:appt:".length) : "";
        return {
          sends: [],
          next: "action",
          data: { confirmation_code: code, appt_label: String(data._tappedTitle ?? "") }
        };
      }
    },

    action: {
      kind: "prompt",
      prompt: async (_ctx, data) => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body: `${data.appt_label ?? "Your booking"} — what would you like to do?`,
          buttons: [
            { id: id("act", "resched"), title: "Reschedule" },
            { id: id("act", "cancel"), title: "Cancel booking" },
            { id: id("act", "back"), title: "Main menu" }
          ]
        },
        options: [
          { id: id("act", "resched"), title: "Reschedule", next: "reslots" },
          { id: id("act", "cancel"), title: "Cancel booking", next: "cancelConfirm" },
          {
            id: id("act", "back"),
            title: "Main menu",
            next: { goto: { flow: "booking", node: "menu" } }
          }
        ]
      })
    },

    // Entry point for the reminder's [Reschedule] tap (code pre-bound in data).
    reslots: {
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
            next: "doReschedule" as NextRef
          })),
          {
            id: id("slot", "none"),
            title: "None of these work",
            next: { goto: { flow: "booking", node: "escalate" } }
          }
        ];

        return {
          kind: "mcq",
          send: {
            kind: "list",
            body: "Pick a new slot:",
            buttonLabel: "New slot",
            rows
          },
          options
        };
      }
    },

    doReschedule: {
      kind: "action",
      run: async (_ctx, data): Promise<ActionResult> => {
        const tapped = String(data._tapped ?? "");
        const slot = tapped.startsWith("mg:slot:") ? tapped.slice("mg:slot:".length) : "";
        const result = await rescheduleAppointment({
          confirmation_code: String(data.confirmation_code ?? ""),
          new_slot_start: slot
        });
        if ("error" in result) {
          return {
            sends: [
              { kind: "text", body: "That slot was just taken — here are the latest openings:" }
            ],
            next: "reslots"
          };
        }
        return {
          sends: [
            {
              kind: "text",
              body: `Rescheduled ✅ — ${String(data._tappedTitle ?? "your new slot")}. Same confirmation code: *${result.confirmation_code}*.`
            }
          ],
          next: END
        };
      }
    },

    // Entry point for the reminder's [Cancel] tap (code pre-bound in data).
    cancelConfirm: {
      kind: "prompt",
      prompt: async (_ctx, data) => ({
        kind: "mcq",
        send: {
          kind: "buttons",
          body: `Cancel ${data.appt_label ?? "this booking"}? Same-day cancellations may carry a visit fee.`,
          buttons: [
            { id: id("cxl", "yes"), title: "Yes, cancel it" },
            { id: id("cxl", "no"), title: "Keep booking" }
          ]
        },
        options: [
          { id: id("cxl", "yes"), title: "Yes, cancel it", next: "doCancel" },
          { id: id("cxl", "no"), title: "Keep booking", next: "kept" }
        ]
      })
    },

    doCancel: {
      kind: "action",
      run: async (_ctx, data): Promise<ActionResult> => {
        const result = await cancelAppointment({
          confirmation_code: String(data.confirmation_code ?? ""),
          reason: "customer cancelled via WhatsApp menu"
        });
        if ("error" in result) {
          return {
            sends: [
              {
                kind: "text",
                body: "I couldn't cancel that booking automatically — our team will follow up here."
              }
            ],
            next: { goto: { flow: "booking", node: "escalate" } }
          };
        }
        return {
          sends: [
            {
              kind: "text",
              body: "Your booking is cancelled ✅. Message me anytime you need us again."
            }
          ],
          next: END
        };
      }
    },

    kept: {
      kind: "action",
      run: async () => ({
        sends: [{ kind: "text", body: "Great — your booking stands. See you then! 👍" }],
        next: END
      })
    }
  }
};
