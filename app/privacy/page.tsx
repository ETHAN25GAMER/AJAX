import { LEGAL } from "@/lib/legal";
import { BRAND } from "@/lib/brand";

// Customer-facing: tab shows the company, not the staff console name.
export const metadata = { title: { absolute: `Privacy Notice — ${LEGAL.companyName}` } };

// NOTE: This is a working draft to satisfy the DPDP Act 2023 notice obligation and
// to publish a contact point. Have it reviewed by an India-qualified adviser
// before relying on it — especially the data-fiduciary and consent wording.

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {LEGAL.companyName}
        </p>
        <h1 className="mt-3 font-serif text-[40px] leading-[1.05] tracking-tight text-ink">
          Privacy Notice
        </h1>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Last updated {LEGAL.privacyUpdated} · Governed by India&apos;s Digital Personal Data
          Protection Act 2023 (DPDP Act)
        </p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          <Section title="Who we are">
            {LEGAL.companyName} provides pest control services in India. We operate an
            automated WhatsApp assistant (&ldquo;{BRAND.assistant}&rdquo;) to handle enquiries, bookings, and
            follow-ups. This notice explains how we handle your personal data.
          </Section>

          <Section title="What we collect">
            When you message us we collect your WhatsApp phone number, your name, your service
            address, the details of your pest issue, and the contents of your conversation with the
            assistant. We do not ask for, and you should not send, your Aadhaar number or PAN.
          </Section>

          <Section title="Why we use it">
            To respond to your enquiry, quote and schedule services, dispatch a technician, send you
            updates and reminders about visits you have booked, and improve our service. We only use
            your data for these purposes.
          </Section>

          <Section title="Who we share it with">
            We use trusted service providers to operate the assistant — including WhatsApp/Meta
            (messaging) and Anthropic (the AI that powers the assistant). Processing these messages
            may involve transferring data outside India; where it does, we take steps to ensure a
            comparable standard of protection. We do not sell your data.
          </Section>

          <Section title="How long we keep it">
            We keep chat logs for {LEGAL.chatRetentionMonths} months after your last message, after
            which they are automatically deleted. Booking and service records may be kept longer for
            our business and legal needs.
          </Section>

          <Section title="Your choices and rights">
            You can ask us what data we hold about you, correct it, or request that we delete it. To
            stop receiving check-in and follow-up messages, reply <strong>STOP</strong> at any time;
            reply <strong>START</strong> to resume. You can still message us anytime and the
            assistant will respond.
          </Section>

          <Section title="Contact us">
            For any privacy request or question, contact us at:
            <br />
            <span className="text-foreground">{LEGAL.dpoName}</span> ·{" "}
            <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${LEGAL.dpoEmail}`}>
              {LEGAL.dpoEmail}
            </a>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-border pb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {title}
      </h2>
      <p className="mt-3">{children}</p>
    </section>
  );
}
