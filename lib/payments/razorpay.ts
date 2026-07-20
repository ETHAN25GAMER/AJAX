import crypto from "node:crypto";

// Razorpay Payment Links — the India-native path to UPI/card/netbanking
// collection over WhatsApp. Two uses today:
//   * booking deposits (create_appointment, when RAZORPAY_DEPOSIT_AMOUNT is set)
//   * AMC renewal collection (request_amc_renewal, when the contract has a price)
//
// The whole integration is optional: when the env keys are absent every entry
// point degrades to the previous behaviour (no link, manual collection).

const API_BASE = "https://api.razorpay.com/v1";

export type PaymentPurpose = "deposit" | "amc_renewal";

export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export type CreatedPaymentLink = {
  /** Razorpay payment-link id (plink_…) — stored as payments.provider_ref. */
  id: string;
  /** Customer-facing short URL. */
  shortUrl: string;
};

// Create a hosted payment link. `amount` is in INR rupees (converted to paise
// here); `reference` lands in the link's notes so the webhook can route the
// paid event back to our payments row.
export async function createPaymentLink(opts: {
  amount: number;
  description: string;
  customerName: string | null;
  customerPhone: string;
  purpose: PaymentPurpose;
  reference: string; // our payments.id
}): Promise<CreatedPaymentLink> {
  const res = await fetch(`${API_BASE}/payment_links`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: Math.round(opts.amount * 100),
      currency: "INR",
      description: opts.description,
      customer: {
        ...(opts.customerName ? { name: opts.customerName } : {}),
        contact: opts.customerPhone
      },
      notify: { sms: false, email: false }, // WhatsApp is our channel
      notes: { purpose: opts.purpose, reference: opts.reference }
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Razorpay payment link failed (${res.status}): ${errBody}`);
  }
  const data = (await res.json()) as { id: string; short_url: string };
  return { id: data.id, shortUrl: data.short_url };
}

// Verify Razorpay's webhook signature: HMAC-SHA256 of the raw body with the
// webhook secret, hex-encoded in the x-razorpay-signature header. Timing-safe,
// mirroring verifyMetaSignature in lib/whatsapp/inbound.ts.
export function verifyRazorpaySignature(opts: {
  signature: string | null;
  rawBody: string;
}): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !opts.signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(opts.rawBody).digest("hex");
  const a = Buffer.from(opts.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
