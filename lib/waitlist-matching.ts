// Waitlist matching. Source: SYSTEM_BUILD_GUIDE.md §6.2. Pure: no database, no clock of its own.

import { TIMES_OF_DAY, WEEKDAYS } from "@/lib/constants";

type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** The waitlist columns matching needs (a subset of the `waitlist` row). */
export type Candidate = {
  id: string;
  patient_name: string;
  is_active: boolean;
  sms_opt_out: boolean;
  phone: string | null;
  email: string | null;
  max_notice_hours: number;
  preferred_procedures: string[];
  preferred_days: string[];
  preferred_times: string[];
  preferred_doctors: string[];
  last_contacted_at: string | null;
};

export type Slot = {
  datetime: Date;
  procedure: string | null;
  /** Dentist name (not id). Null when the PMS did not say. */
  doctor: string | null;
  timeZone: string;
};

export type DoctorMatch = "yes" | "no" | "any";

export type Match<T extends Candidate = Candidate> = {
  patient: T;
  score: number;
  preferredDoctorMatch: DoctorMatch;
};

export type MatchOptions = {
  /** Patients already offered this slot (from waitlist_offers for the pipeline). */
  excludePatientIds?: ReadonlySet<string> | readonly string[];
};

/** "Dr. Ali  Khan" and "ali khan" are the same dentist. */
export function normaliseDoctorName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^dr\.?\s+/, "")
    .replace(/\s+/g, " ");
}

/** English weekday name of the instant in `timeZone`, e.g. "Monday". */
export function weekdayInZone(value: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(value);
  return WEEKDAYS.find((d) => d === name) ?? name;
}

/** morning < 12:00 <= afternoon < 17:00 <= evening, in `timeZone`. */
export function timeOfDayInZone(value: Date, timeZone: string): TimeOfDay {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(value),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole and fractional hours from `now` until the slot (negative when the slot has passed). */
export function hoursUntil(slot: Date, now: Date): number {
  return (slot.getTime() - now.getTime()) / 3_600_000;
}

function canBeContacted(c: Candidate): boolean {
  if (!c.is_active) return false;
  const hasEmail = Boolean(c.email);
  const hasSms = Boolean(c.phone) && !c.sms_opt_out;
  return hasEmail || hasSms;
}

export function matchWaitlist<T extends Candidate>(
  candidates: readonly T[],
  slot: Slot,
  now: Date,
  options: MatchOptions = {},
): Match<T>[] {
  const excluded = new Set(options.excludePatientIds ?? []);
  const hours = hoursUntil(slot.datetime, now);
  const weekday = weekdayInZone(slot.datetime, slot.timeZone);
  const timeOfDay = timeOfDayInZone(slot.datetime, slot.timeZone);
  const slotDoctor = slot.doctor ? normaliseDoctorName(slot.doctor) : null;
  const slotProcedure = slot.procedure?.toLowerCase().trim() || null;

  const matches: Match<T>[] = [];

  for (const patient of candidates) {
    if (excluded.has(patient.id)) continue;
    if (!canBeContacted(patient)) continue;
    // max_notice_hours is the minimum notice the patient needs.
    if (hours < patient.max_notice_hours) continue;

    const procedures = patient.preferred_procedures.map((p) => p.toLowerCase());
    const acceptsAny = procedures.length === 0;
    const exact = slotProcedure !== null && procedures.includes(slotProcedure);
    if (!(acceptsAny || slotProcedure === null || exact)) continue;

    let score = exact ? 0.7 : 0.5;
    score += patient.preferred_days.length === 0 ? 0.1 : patient.preferred_days.includes(weekday) ? 0.15 : 0;
    score += patient.preferred_times.length === 0 ? 0.1 : patient.preferred_times.includes(timeOfDay) ? 0.15 : 0;

    let preferredDoctorMatch: DoctorMatch = "any";
    const preferred = patient.preferred_doctors.map(normaliseDoctorName).filter(Boolean);
    if (slotDoctor && preferred.length > 0) {
      if (preferred.includes(slotDoctor)) {
        preferredDoctorMatch = "yes";
        score += 0.1;
      } else {
        preferredDoctorMatch = "no";
        score -= 0.15;
      }
    }

    matches.push({ patient, score: round2(score), preferredDoctorMatch });
  }

  // Best score first; ties go to whoever was contacted least recently (never = first).
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.patient.last_contacted_at ? new Date(a.patient.last_contacted_at).getTime() : -Infinity;
    const bTime = b.patient.last_contacted_at ? new Date(b.patient.last_contacted_at).getTime() : -Infinity;
    return aTime - bTime;
  });

  return matches;
}
