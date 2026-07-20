import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { verifyRazorpaySignature } from "@/lib/payments/razorpay";
import { sendWhatsAppToCustomer } from "@/lib/whatsapp/outbound";
import { firstName } from "@/lib/whatsapp/templates";

export const runtime = "nodejs";
export const maxDuration = 30;

// Razorpay webhook: flip our payments row to 'paid' when a payment link is
// settled, thank the customer on WhatsApp, and (for AMC renewals) file an
// escalation so admin finalizes the contract. Configure the webhook in the
// Razorpay dashboard for the `payment_link.paid` event with
// RAZORPAY_WEBHOOK_SECRET as the secret.
//
// Razorpay retries deliveries, so this handler is idempotent: the status
// transition is guarded on status='created' and repeat events no-op.

type RazorpayWebhookBody = {
  event?: string;
  payload?: {
    payment_link?: {
      entity?: {
        id?: string;
        notes?: { purpose?: string; reference?: string };
      };
    };
  };
};

export async function POST(req: Request) {
  const rawBody = await req.text();

  const ok = verifyRazorpaySignature({
    signature: req.headers.get("x-razorpay-signature"),
    rawBody
  });
  if (!ok) return new NextResponse("Invalid signature", { status: 403 });

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Only paid events matter; acknowledge everything else so Razorpay stops
  // retrying events we deliberately ignore.
  if (body.event !== "payment_link.paid") {
    return NextResponse.json({ ignored: body.event ?? "unknown" });
  }

  const linkId = body.payload?.payment_link?.entity?.id;
  if (!linkId) return new NextResponse("Missing payment link id", { status: 400 });

  const db = supabase();

  // Guarded transition: only 'created' → 'paid'. A redelivered event matches
  // zero rows and we're done.
  const updated = await db
    .from("payments")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("provider_ref", linkId)
    .eq("status", "created")
    .select("id, customer_id, purpose, amount")
    .maybeSingle();

  if (updated.error) {
    console.error("[payments webhook] update failed", updated.error.message);
    return new NextResponse("DB error", { status: 500 });
  }
  if (!updated.data) return NextResponse.json({ ok: true, already: true });

  const payment = updated.data;

  const customer = await db
    .from("customers")
    .select("id, phone, name, opted_out")
    .eq("id", payment.customer_id)
    .maybeSingle();

  if (customer.data?.phone) {
    const label = payment.purpose === "deposit" ? "booking deposit" : "AMC renewal payment";
    await sendWhatsAppToCustomer(
      { phone: customer.data.phone, opted_out: customer.data.opted_out },
      `Thanks ${firstName(customer.data.name)} — we've received your ${label} of ₹${payment.amount}. You're all set!`,
      { kind: "transactional" }
    ).catch((err) => console.error("[payments webhook] confirmation send failed", err));
  }

  // AMC renewals still need a human to push the renewal date forward.
  if (payment.purpose === "amc_renewal") {
    const esc = await db.from("escalations").insert({
      customer_id: payment.customer_id,
      summary: `AMC renewal payment of ₹${payment.amount} received — finalize the renewal (push renews_at forward, set status active).`,
      urgency: "normal"
    });
    if (esc.error) console.error("[payments webhook] escalation insert failed", esc.error.message);
  }

  return NextResponse.json({ ok: true });
}
