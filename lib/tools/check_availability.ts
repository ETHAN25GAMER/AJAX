import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { supabase } from "@/lib/supabase/client";
import { BUSINESS_TZ } from "@/lib/time";
import type { ServiceTier } from "@/lib/supabase/types";

type Args = {
  start_date: string;
  end_date: string;
  service_type: ServiceTier;
};

const DURATION_MIN: Record<ServiceTier, number> = {
  standard: 60,
  plus: 90,
  specialist: 120
};

// Work windows are Mumbai (IST, UTC+5:30) wall-clock hours.
const WORK_WINDOWS = [
  { start: 9, end: 11 },
  { start: 13, end: 15 },
  { start: 15, end: 17 }
];

const MAX_DAYS = 60; // safety bound on the day loop

export async function checkAvailability(args: Args) {
  const db = supabase();

  // Bound the booked-slots query by the IST-day range so it lines up with
  // the slots we generate below.
  const rangeStart = fromZonedTime(`${args.start_date}T00:00:00`, BUSINESS_TZ);
  const rangeEnd = fromZonedTime(`${args.end_date}T23:59:59`, BUSINESS_TZ);

  const booked = await db
    .from("appointments")
    .select("slot_start, slot_end")
    .eq("status", "booked")
    .gte("slot_start", rangeStart.toISOString())
    .lte("slot_start", rangeEnd.toISOString());

  if (booked.error) return { error: booked.error.message };

  // Compare by instant (epoch ms), not by string, so DB/ISO formatting
  // differences can't cause a double-booking to slip through.
  const taken = new Set<number>(
    (booked.data ?? []).map((r) => new Date(r.slot_start).getTime())
  );
  const duration = DURATION_MIN[args.service_type];
  const slots: { slot_start: string; slot_end: string; label: string }[] = [];

  let day = args.start_date;
  for (let i = 0; i < MAX_DAYS && day <= args.end_date; i++, day = addDay(day)) {
    // Day-of-week in IST: "i" gives 1 (Mon) … 7 (Sun).
    const anchor = fromZonedTime(`${day}T12:00:00`, BUSINESS_TZ);
    if (formatInTimeZone(anchor, BUSINESS_TZ, "i") === "7") continue; // closed Sunday

    for (const w of WORK_WINDOWS) {
      // Skip windows the service can't fit into (no DST in IST, so wall-clock
      // minute arithmetic is exact).
      if (w.start * 60 + duration > w.end * 60) continue;

      const slotStart = fromZonedTime(
        `${day}T${String(w.start).padStart(2, "0")}:00:00`,
        BUSINESS_TZ
      );
      const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
      if (taken.has(slotStart.getTime())) continue;

      slots.push({
        slot_start: slotStart.toISOString(),
        slot_end: slotEnd.toISOString(),
        label: `${formatInTimeZone(slotStart, BUSINESS_TZ, "EEE d MMM")} ${formatHour(slotStart)}-${formatHour(slotEnd)}`
      });
      if (slots.length >= 6) return { slots };
    }
  }
  return { slots };
}

// "YYYY-MM-DD" + 1 calendar day, computed in UTC to avoid any zone drift.
function addDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// IST hour label: "9am", "10:30am", "3pm".
function formatHour(d: Date) {
  const [hStr, mStr] = formatInTimeZone(d, BUSINESS_TZ, "H:mm").split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const am = h < 12;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${am ? "am" : "pm"}`;
}
