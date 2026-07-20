import type { SupabaseClient } from "@supabase/supabase-js";

// Segment resolution for broadcast campaigns.
//
// A SegmentSpec is a small, declarative filter over the customer base. It is
// resolved to a concrete customer-id snapshot when the campaign is created —
// campaigns never re-evaluate their audience after launch.
//
// Resolution is a few bounded queries composed in memory (the same two-step
// pattern as the AMC upsell pass — PostgREST doesn't compose NOT EXISTS
// cleanly, and at this deployment's scale a hundred-KB fetch beats a view).

export type SegmentSpec = {
  /** Substring match on the customer's stored address (case-insensitive). */
  area?: string;
  /** Customer has had at least one appointment for this pest type. */
  pest_type?: string;
  /** Last completed visit is OLDER than this many months (win-back audiences). */
  last_visit_before_months?: number;
  /** Only customers with an active AMC (true) / without any AMC (false). */
  has_amc?: boolean;
  /** Customer carries this CRM tag (customers.tags, exact match). */
  tag?: string;
};

export type ResolvedSegment = {
  customerIds: string[];
};

const CUSTOMER_FETCH_LIMIT = 2000;
const APPOINTMENT_FETCH_LIMIT = 5000;

export async function resolveSegment(
  db: SupabaseClient,
  spec: SegmentSpec
): Promise<ResolvedSegment | { error: string }> {
  // Base: reachable customers. Opted-out customers are excluded up front so the
  // preview count is honest — the promotional send gate would skip them anyway.
  let customerQuery = db
    .from("customers")
    .select("id, address, opted_out")
    .eq("opted_out", false)
    .not("phone", "is", null)
    .limit(CUSTOMER_FETCH_LIMIT);

  if (spec.area?.trim()) {
    customerQuery = customerQuery.ilike("address", `%${spec.area.trim()}%`);
  }
  if (spec.tag?.trim()) {
    customerQuery = customerQuery.contains("tags", [spec.tag.trim()]);
  }

  const customers = await customerQuery;
  if (customers.error) return { error: customers.error.message };

  let ids = new Set((customers.data ?? []).map((c) => c.id as string));
  if (ids.size === 0) return { customerIds: [] };

  // Appointment-history filters share one fetch.
  const needsAppointments =
    spec.pest_type?.trim() || typeof spec.last_visit_before_months === "number";

  if (needsAppointments) {
    const appts = await db
      .from("appointments")
      .select("customer_id, pest_type, slot_start, status")
      .eq("status", "completed")
      .limit(APPOINTMENT_FETCH_LIMIT);
    if (appts.error) return { error: appts.error.message };

    const pestWanted = spec.pest_type?.trim().toLowerCase();
    const byCustomer = new Map<string, { pests: Set<string>; lastVisit: number }>();
    for (const a of appts.data ?? []) {
      const cid = a.customer_id as string;
      if (!ids.has(cid)) continue;
      const entry = byCustomer.get(cid) ?? { pests: new Set<string>(), lastVisit: 0 };
      entry.pests.add(String(a.pest_type ?? "").toLowerCase());
      entry.lastVisit = Math.max(entry.lastVisit, new Date(a.slot_start as string).getTime());
      byCustomer.set(cid, entry);
    }

    const cutoff =
      typeof spec.last_visit_before_months === "number"
        ? Date.now() - spec.last_visit_before_months * 30 * 86_400_000
        : null;

    ids = new Set(
      [...ids].filter((id) => {
        const history = byCustomer.get(id);
        if (!history) return false; // both filters require visit history
        if (pestWanted && !history.pests.has(pestWanted)) return false;
        if (cutoff !== null && history.lastVisit >= cutoff) return false;
        return true;
      })
    );
    if (ids.size === 0) return { customerIds: [] };
  }

  if (typeof spec.has_amc === "boolean") {
    const amc = await db.from("amc").select("customer_id").in("customer_id", [...ids]);
    if (amc.error) return { error: amc.error.message };
    const amcSet = new Set((amc.data ?? []).map((r) => r.customer_id as string));
    ids = new Set([...ids].filter((id) => (spec.has_amc ? amcSet.has(id) : !amcSet.has(id))));
  }

  return { customerIds: [...ids] };
}

// Human-readable one-liner for list rows and audits.
export function describeSegment(spec: SegmentSpec): string {
  const parts: string[] = [];
  if (spec.tag?.trim()) parts.push(`tag "${spec.tag.trim()}"`);
  if (spec.area?.trim()) parts.push(`area ~ "${spec.area.trim()}"`);
  if (spec.pest_type?.trim()) parts.push(`had ${spec.pest_type.trim()}`);
  if (typeof spec.last_visit_before_months === "number") {
    parts.push(`no visit in ${spec.last_visit_before_months}mo`);
  }
  if (typeof spec.has_amc === "boolean") parts.push(spec.has_amc ? "has AMC" : "no AMC");
  return parts.length > 0 ? parts.join(" · ") : "all reachable customers";
}
