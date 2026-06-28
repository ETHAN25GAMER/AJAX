// Published legal/contact details. Set the env vars in production; the
// fallbacks are placeholders and MUST be replaced before going live.
//
// Contact details for privacy requests under the DPDP Act 2023 — publish a
// reachable point of contact for data principals to exercise their rights.

import { BRAND } from "@/lib/brand";

export const LEGAL = {
  companyName: BRAND.company,
  /** DPDP Act contact for privacy requests. */
  dpoName: process.env.DPO_NAME ?? "Data Protection Officer",
  dpoEmail: process.env.DPO_EMAIL ?? "dpo@greenshield.example",
  /** Last time the privacy notice was reviewed. */
  privacyUpdated: "2 June 2026",
  /** Chat-log retention window — keep in sync with RETENTION_CONV_MONTHS. */
  chatRetentionMonths: 6
} as const;
