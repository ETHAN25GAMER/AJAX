import { supabase } from "@/lib/supabase/client";
import {
  createPaymentLink,
  razorpayConfigured,
  type PaymentPurpose
} from "./razorpay";

// Create a Razorpay payment link AND its payments row in one call. Returns
// null when Razorpay isn't configured or the link fails — callers treat a
// missing link as "collect manually", never as an error the customer sees.
export async function createRecordedPaymentLink(opts: {
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  appointmentId?: string;
  purpose: PaymentPurpose;
  amount: number;
  description: string;
}): Promise<{ url: string; amount: number } | null> {
  if (!razorpayConfigured() || !(opts.amount > 0)) return null;

  const db = supabase();
  const row = await db
    .from("payments")
    .insert({
      customer_id: opts.customerId,
      appointment_id: opts.appointmentId ?? null,
      purpose: opts.purpose,
      amount: opts.amount,
      status: "created"
    })
    .select("id")
    .single();
  if (row.error) {
    console.error("[payments] row insert failed", row.error.message);
    return null;
  }

  try {
    const link = await createPaymentLink({
      amount: opts.amount,
      description: opts.description,
      customerName: opts.customerName,
      customerPhone: opts.customerPhone,
      purpose: opts.purpose,
      reference: row.data.id
    });
    await db
      .from("payments")
      .update({ provider_ref: link.id, link_url: link.shortUrl })
      .eq("id", row.data.id);
    return { url: link.shortUrl, amount: opts.amount };
  } catch (err) {
    console.error("[payments] link creation failed", err);
    // Don't leave a link-less shell behind.
    await db.from("payments").delete().eq("id", row.data.id);
    return null;
  }
}

// Flat booking-deposit amount in INR. Unset/invalid = deposits disabled.
export function depositAmount(): number | null {
  const raw = process.env.RAZORPAY_DEPOSIT_AMOUNT;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
