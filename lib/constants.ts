// Shared constants. Source: SYSTEM_BUILD_GUIDE.md §6.1, §6.3, §6.8, §6.9.

export const STAGES = [
  "cancellation_detected",
  "offer_sent",
  "waiting_staff_approval",
  "slot_recovered",
  "expired_manual",
] as const;

export type Stage = (typeof STAGES)[number];

/** Long labels (history, emails, detail views). */
export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export const STAGE_LABELS: Record<Stage, string> = {
  cancellation_detected: "Cancellation detected",
  offer_sent: "Offer sent",
  waiting_staff_approval: "Patient said YES — awaiting front-desk approval",
  slot_recovered: "Slot recovered",
  expired_manual: "Expired / manual",
};

/** Short labels (board column headers). */
export const STAGE_SHORT_LABELS: Record<Stage, string> = {
  cancellation_detected: "Detected",
  offer_sent: "Offer sent",
  waiting_staff_approval: "Awaiting approval",
  slot_recovered: "Recovered",
  expired_manual: "Expired / manual",
};

export type Tone = "neutral" | "info" | "warning" | "success" | "destructive";

/** muted grey, blue (link), amber (warning), green (success), red (destructive). */
export const STAGE_TONES: Record<Stage, Tone> = {
  cancellation_detected: "neutral",
  offer_sent: "info",
  waiting_staff_approval: "warning",
  slot_recovered: "success",
  expired_manual: "destructive",
};

/** Tooltip text for board columns (guide §9.3). */
export const STAGE_HINTS: Partial<Record<Stage, string>> = {
  waiting_staff_approval:
    "The patient accepted the offer. Approve to confirm; then book it in Dentally.",
};

/**
 * Allowed stage moves. Only transitionStage() (Phase 2, lib/pipeline.ts) may
 * change recovery_pipeline.stage, and it checks this table.
 */
export const ALLOWED_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  cancellation_detected: ["offer_sent", "waiting_staff_approval", "slot_recovered", "expired_manual"],
  // offer_sent -> offer_sent means "offer the next patient".
  offer_sent: ["offer_sent", "waiting_staff_approval", "slot_recovered", "expired_manual"],
  // waiting_staff_approval -> offer_sent means "reception declined, try next".
  waiting_staff_approval: ["offer_sent", "slot_recovered", "expired_manual"],
  slot_recovered: [],
  expired_manual: [],
};

/** Which timestamp column is set when entering a stage. */
export const STAGE_TIMESTAMP: Partial<Record<Stage, string>> = {
  offer_sent: "offer_sent_at",
  waiting_staff_approval: "approval_requested_at",
  slot_recovered: "confirmed_at",
  expired_manual: "expired_at",
};

export const PROCEDURES = [
  "cleaning",
  "consultation",
  "filling",
  "extraction",
  "crown",
  "implant",
  "whitening",
] as const;

export type Procedure = (typeof PROCEDURES)[number];

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** morning < 12:00 <= afternoon < 17:00 <= evening (clinic timezone). */
export const TIMES_OF_DAY = ["morning", "afternoon", "evening"] as const;

export const ROLES = ["owner", "admin", "staff"] as const;
export type Role = (typeof ROLES)[number];

/** The database stores role as plain text (with a CHECK), so narrow it before using it as a Role. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Who triggered a history row (guide §5.1, recovery_pipeline_history.triggered_by). */
export const ACTORS = ["system", "engine", "front_desk", "patient", "manual"] as const;
export type Actor = (typeof ACTORS)[number];

export const ACTOR_LABELS: Record<Actor, string> = {
  system: "System",
  engine: "Engine",
  front_desk: "Front desk",
  patient: "Patient",
  manual: "Manual",
};

export function isActor(value: unknown): value is Actor {
  return typeof value === "string" && (ACTORS as readonly string[]).includes(value);
}

/** Minimum-notice choices on the public sign-up form (guide §9.9). Value = hours. */
export const NOTICE_OPTIONS = [
  { label: "Same day", hours: 0 },
  { label: "2 hours", hours: 2 },
  { label: "24 hours", hours: 24 },
  { label: "48 hours", hours: 48 },
] as const;

/** Upper bound for a patient's minimum notice (guide §9.4: 0–336 hours). */
export const MAX_NOTICE_HOURS = 336;

export const OFFER_CHANNELS = ["sms", "email", "whatsapp"] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export const OFFER_STRATEGIES = ["sequential", "batch"] as const;

/** Rolling ranges including today (guide §6.9). */
export const RANGES = ["week", "month", "quarter"] as const;
export type Range = (typeof RANGES)[number];

export const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, quarter: 90 };
export const RANGE_LABELS: Record<Range, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

export const DEFAULT_RANGE: Range = "week";

export function parseRange(value: string | string[] | undefined | null): Range {
  const v = Array.isArray(value) ? value[0] : value;
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as Range) : DEFAULT_RANGE;
}

export const DEFAULT_TIMEZONE = "Europe/London";
