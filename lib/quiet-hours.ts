// Quiet hours. Source: SYSTEM_BUILD_GUIDE.md §7 E4 step 2. Pure: pass `now` in.
// Times are "HH:MM" or "HH:MM:SS" (Postgres TIME) in the clinic timezone.

import { addDaysToDate, dateInZone, localToUtc, minutesOfDayInZone } from "@/lib/time";

function toMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 24 * 60 ? minutes : null;
}

/**
 * When `now` is inside quiet hours, the instant they end; otherwise null.
 * Windows may cross midnight (20:00 to 08:00). Equal start and end means no quiet hours.
 */
export function quietHoursResume(now: Date, start: string, end: string, timeZone: string): Date | null {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || s === e) return null;

  const m = minutesOfDayInZone(now, timeZone);
  const crossesMidnight = s > e;
  const inside = crossesMidnight ? m >= s || m < e : m >= s && m < e;
  if (!inside) return null;

  // The end falls today when we are before it (after midnight, or a same-day window), else tomorrow.
  const today = dateInZone(now, timeZone);
  const endsToday = crossesMidnight ? m < e : true;
  const date = endsToday ? today : addDaysToDate(today, 1);
  const hh = String(Math.floor(e / 60)).padStart(2, "0");
  const mm = String(e % 60).padStart(2, "0");
  return localToUtc(date, `${hh}:${mm}`, timeZone);
}
