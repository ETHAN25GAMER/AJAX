import type Anthropic from "@anthropic-ai/sdk";
import { checkAvailability } from "@/lib/tools/check_availability";
import { createAppointment } from "@/lib/tools/create_appointment";
import { rescheduleAppointment } from "@/lib/tools/reschedule_appointment";
import { cancelAppointment } from "@/lib/tools/cancel_appointment";
import { getPricingQuote } from "@/lib/tools/get_pricing_quote";
import { identifyPest } from "@/lib/tools/identify_pest";
import { escalateToHuman } from "@/lib/tools/escalate_to_human";
import { lookupCustomer } from "@/lib/tools/lookup_customer";
import { lookupAmcStatus } from "@/lib/tools/lookup_amc_status";
import { requestAmcRenewal } from "@/lib/tools/request_amc_renewal";
import { requestAmcSubscription } from "@/lib/tools/request_amc_subscription";

export type ToolContext = {
  customerPhone: string;
  // Media from the current inbound message (base64 data: URLs). Lets tools use
  // the customer's photo directly instead of the model re-emitting it as an
  // argument (a data: URL round-tripped through tool-call output is thousands
  // of output tokens).
  mediaUrls?: string[];
};

type Tool = Anthropic.Messages.Tool;

export const TOOLS: Tool[] = [
  {
    name: "check_availability",
    description:
      "Return open appointment slots within a date range. Always call this before proposing specific slots to the customer.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "IST calendar date (YYYY-MM-DD) inclusive" },
        end_date: { type: "string", description: "IST calendar date (YYYY-MM-DD) inclusive" }
      },
      required: ["start_date", "end_date"]
    }
  },
  {
    name: "create_appointment",
    description:
      "Book a new appointment. Only call after the customer has explicitly agreed to a specific slot returned by check_availability.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        address: { type: "string" },
        pest_type: { type: "string", description: "e.g. 'rats', 'german cockroaches', 'unknown'" },
        slot_start: { type: "string", description: "Copy the slot_start value character-for-character from the check_availability result. Do not reformat, reconstruct, or modify it." }
      },
      required: ["name", "address", "pest_type", "slot_start"]
    }
  },
  {
    name: "reschedule_appointment",
    description: "Move an existing booking to a new slot. Requires the confirmation code.",
    input_schema: {
      type: "object",
      properties: {
        confirmation_code: { type: "string", description: "The 6-character code the customer provided or from a prior create_appointment result. Never guess or construct one — ask the customer if you don't have it." },
        new_slot_start: { type: "string", description: "Copy the slot_start value character-for-character from the check_availability result. Do not reformat or reconstruct it." }
      },
      required: ["confirmation_code", "new_slot_start"]
    }
  },
  {
    name: "cancel_appointment",
    description: "Cancel an existing booking. Requires the confirmation code.",
    input_schema: {
      type: "object",
      properties: {
        confirmation_code: { type: "string", description: "The 6-character code the customer provided or from a prior create_appointment result. Never guess or construct one — ask the customer if you don't have it." },
        reason: { type: "string" }
      },
      required: ["confirmation_code"]
    }
  },
  {
    name: "get_pricing_quote",
    description:
      "Look up a price range for a service. Returns a range and whether an on-site inspection is required for a firm quote.",
    input_schema: {
      type: "object",
      properties: {
        pest_type: { type: "string" },
        property_size: {
          type: "string",
          enum: ["small", "medium", "large", "unknown"],
          description: "small ~<1500sqft, medium 1500-3000, large >3000"
        }
      },
      required: ["pest_type"]
    }
  },
  {
    name: "identify_pest",
    description:
      "Identify a pest from the customer's photo or from a text description. If the customer attached a photo to their latest message it is used automatically — call with use_photo=true and no description. Never paste image data or URLs as arguments.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Text description of the pest (omit when using the photo)" },
        use_photo: { type: "boolean", description: "true = identify from the photo attached to the customer's latest message" }
      }
    }
  },
  {
    name: "escalate_to_human",
    description:
      "Flag the conversation for a human technician. Use for safety, complaints, specialist services, or anything outside your scope.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-sentence summary of what the customer needs" },
        urgency: { type: "string", enum: ["low", "normal", "high"] }
      },
      required: ["summary", "urgency"]
    }
  },
  {
    name: "lookup_customer",
    description:
      "Look up a customer's prior visits and stored details by their WhatsApp phone (already in context). Useful for returning customers.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "lookup_amc_status",
    description:
      "Check whether this customer has an Annual Maintenance Contract on file. Returns plan details (pest_type, annual_price, renews_at, status) or has_amc=false. Call this whenever the customer mentions renewal, subscription, annual plan, or maintenance contract.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "request_amc_renewal",
    description:
      "Customer explicitly confirmed they want to renew their existing AMC. Creates an admin escalation and marks the contract pending_renewal. Do NOT tell the customer 'renewed' — say something like 'our team will confirm and finalize payment shortly'.",
    input_schema: {
      type: "object",
      properties: {
        notes: { type: "string", description: "Any adjustments the customer mentioned (price negotiation, change of pest coverage, etc.)" }
      },
      required: []
    }
  },
  {
    name: "request_amc_subscription",
    description:
      "Customer (without an existing AMC) said they want to subscribe to an annual plan. Creates an admin escalation so admin can quote, collect payment, and create the contract. Frame the reply as 'our team will reach out with the exact quote and confirm details'.",
    input_schema: {
      type: "object",
      properties: {
        pest_type: { type: "string", description: "Pest the customer wants the contract to cover" },
        notes: { type: "string", description: "Anything else they mentioned (property size, preferred frequency, etc.)" }
      },
      required: ["pest_type"]
    }
  }
];

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  switch (name) {
    case "check_availability":
      return checkAvailability(input as never);
    case "create_appointment":
      return createAppointment({ ...(input as object), customer_phone: ctx.customerPhone } as never);
    case "reschedule_appointment":
      return rescheduleAppointment(input as never);
    case "cancel_appointment":
      return cancelAppointment(input as never);
    case "get_pricing_quote":
      return getPricingQuote(input as never);
    case "identify_pest": {
      // Attach the customer's actual photo from the inbound message. Also
      // honour a legacy image_url the model may still pass (http(s) only —
      // data: URLs must come from ctx, never from model output).
      const raw = input as { description?: string; use_photo?: boolean; image_url?: string };
      const fromCtx = ctx.mediaUrls?.[0];
      const image_url =
        raw.use_photo || (!raw.description && fromCtx)
          ? fromCtx
          : typeof raw.image_url === "string" && /^https?:\/\//.test(raw.image_url)
            ? raw.image_url
            : undefined;
      return identifyPest({ description: raw.description, image_url });
    }
    case "escalate_to_human":
      return escalateToHuman({ ...(input as object), customer_phone: ctx.customerPhone } as never);
    case "lookup_customer":
      return lookupCustomer({ customer_phone: ctx.customerPhone });
    case "lookup_amc_status":
      return lookupAmcStatus({ customer_phone: ctx.customerPhone });
    case "request_amc_renewal":
      return requestAmcRenewal({ ...(input as object), customer_phone: ctx.customerPhone } as never);
    case "request_amc_subscription":
      return requestAmcSubscription({ ...(input as object), customer_phone: ctx.customerPhone } as never);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
