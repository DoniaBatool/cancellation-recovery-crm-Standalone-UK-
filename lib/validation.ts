import { z } from "zod";
import {
  MAX_NOTICE_HOURS,
  NOTICE_OPTIONS,
  OFFER_CHANNELS,
  OFFER_STRATEGIES,
  PROCEDURES,
  TIMES_OF_DAY,
  WEEKDAYS,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// Phone normalisation (guide §6.6)
// ---------------------------------------------------------------------------

/**
 * Normalise a phone number to E.164, assuming UK numbers when there is no
 * country prefix. Returns null when the input is not a plausible phone number.
 *
 *   strip spaces ( ) - ; must match ^\+?\d{7,15}$
 *   "+..." keep · "00..." -> "+..." · "0..." -> "+44..." · else "+" + digits
 */
export function normalizeUkPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s()-]/g, "");
  if (!/^\+?\d{7,15}$/.test(cleaned)) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith("0")) return `+44${cleaned.slice(1)}`;
  return `+${cleaned}`;
}

// ---------------------------------------------------------------------------
// Safe redirects (guide §15: `next` must start with "/" and not "//")
// ---------------------------------------------------------------------------

export function safeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  // Browsers treat a backslash like a slash, so "/\evil.com" is an open redirect.
  if (next.includes("\\")) return fallback;
  // No control characters (header injection) and no scheme smuggling.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}

// ---------------------------------------------------------------------------
// Form helpers (guide §3.3 rule 2)
// ---------------------------------------------------------------------------

/** Turn FormData into a plain object. Repeated keys become arrays. */
export function formDataToObject(formData: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue; // React server action internals
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}

/** First error message per field, for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth schemas (guide §9.1)
// ---------------------------------------------------------------------------

const emailField = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter a valid email address."));

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export const setPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The two passwords do not match.",
  });

// ---------------------------------------------------------------------------
// Shared form field helpers
// ---------------------------------------------------------------------------

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Checkbox: a ticked box posts "on"; an unticked box posts nothing. */
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** A list from repeated form fields. One value arrives as a string, none as undefined. */
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(item));

const optionalEmail = z.preprocess(
  blank,
  z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")).optional(),
);

const phoneOf = (missing: string) =>
  z.string({ error: missing }).transform((value, ctx) => {
    const phone = normalizeUkPhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return z.NEVER;
    }
    return phone;
  });

const phoneValue = phoneOf("Enter a valid phone number.");

const optionalPhone = z.preprocess(blank, phoneValue.optional());

const optionalText = (max: number) =>
  z.preprocess(blank, z.string().trim().max(max, `Use at most ${max} characters.`).optional());

const procedureList = listOf(z.enum(PROCEDURES));
const dayList = listOf(z.enum(WEEKDAYS));
const timeList = listOf(z.enum(TIMES_OF_DAY));
const nameList = listOf(z.string().trim().min(1).max(120));

const noticeHours = z.coerce
  .number("Enter a number of hours.")
  .int("Use a whole number of hours.")
  .min(0, "Use 0 or more hours.")
  .max(MAX_NOTICE_HOURS, `Use at most ${MAX_NOTICE_HOURS} hours.`);

// ---------------------------------------------------------------------------
// Waitlist (guide §9.4)
// ---------------------------------------------------------------------------

export const waitlistPatientFormSchema = z
  .object({
    id: z.preprocess(blank, z.uuid().optional()),
    patient_name: z.string().trim().min(1, "Enter the patient's name.").max(120, "Use at most 120 characters."),
    email: optionalEmail,
    phone: optionalPhone,
    preferred_procedures: procedureList,
    preferred_days: dayList,
    preferred_times: timeList,
    preferred_doctors: nameList,
    max_notice_hours: noticeHours,
    existing_patient: checkbox,
    notes: optionalText(1000),
  })
  .refine((v) => v.email || v.phone, {
    path: ["phone"],
    message: "Add a phone number or an email address.",
  });

export type WaitlistPatientForm = z.output<typeof waitlistPatientFormSchema>;

// ---------------------------------------------------------------------------
// Public sign-up (guide §9.9)
// ---------------------------------------------------------------------------

const NOTICE_HOURS_ALLOWED: number[] = NOTICE_OPTIONS.map((o) => o.hours);

export const publicJoinSchema = z.object({
  patient_name: z.string().trim().min(1, "Enter your name.").max(120, "Use at most 120 characters."),
  phone: z.preprocess(blank, phoneOf("Enter your mobile number.")),
  email: z.preprocess(
    blank,
    z.string({ error: "Enter your email address." }).trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  ),
  preferred_procedures: procedureList,
  preferred_days: dayList,
  preferred_times: timeList,
  preferred_doctors: nameList,
  max_notice_hours: z.preprocess(
    blank,
    z.coerce
      .number({ error: "Choose how much notice you need." })
      .refine((n) => NOTICE_HOURS_ALLOWED.includes(n), "Choose how much notice you need."),
  ),
  existing_patient: checkbox,
  consent: z.preprocess((v) => v === "on" || v === "true" || v === true, z.literal(true, { error: "Please tick the box to agree." })),
  /** Honeypot: real people never see or fill this field. */
  website: z.string().optional(),
});

export type PublicJoinForm = z.output<typeof publicJoinSchema>;

// ---------------------------------------------------------------------------
// Settings (guide §9.7)
// ---------------------------------------------------------------------------

const price = z.coerce
  .number("Enter a price in pounds.")
  .int("Use whole pounds.")
  .min(0, "Use 0 or more.")
  .max(100000, "That price looks too high.");

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format, for example 20:00.");

export const doctorSchema = z.object({
  id: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1, "Every dentist needs a name.").max(120),
  email: optionalEmail,
});

export type Doctor = { id: string; name: string; email?: string };

const doctorsJson = z.preprocess((v) => {
  if (typeof v !== "string" || v.trim() === "") return [];
  try {
    return JSON.parse(v);
  } catch {
    return "invalid";
  }
}, z.array(doctorSchema).max(30, "Add at most 30 dentists."));

export const clinicConfigSchema = z.object({
  contact_email: optionalEmail,
  price_cleaning: price,
  price_consultation: price,
  price_filling: price,
  price_extraction: price,
  price_crown: price,
  price_implant: price,
  price_whitening: price,
  price_default: price,
  doctors: doctorsJson,
  engine_enabled: checkbox,
  shadow_mode: checkbox,
  slack_enabled: checkbox,
  offer_channels: listOf(z.enum(OFFER_CHANNELS)).pipe(z.array(z.enum(OFFER_CHANNELS)).min(1, "Choose at least one channel.")),
  offer_expiry_minutes: z.coerce.number().int().min(5, "Use 5 to 1440 minutes.").max(1440, "Use 5 to 1440 minutes."),
  offer_strategy: z.enum(OFFER_STRATEGIES),
  batch_size: z.coerce.number().int().min(2, "Use 2 to 10.").max(10, "Use 2 to 10."),
  max_offers_per_slot: z.coerce.number().int().min(1, "Use 1 to 20.").max(20, "Use 1 to 20."),
  min_lead_minutes: z.coerce.number().int().min(0, "Use 0 or more.").max(10080, "Use at most 10080 (one week)."),
  max_horizon_hours: z.coerce.number().int().min(1, "Use 1 or more.").max(2160, "Use at most 2160 (90 days)."),
  approval_window_minutes: z.coerce.number().int().min(1, "Use 1 or more.").max(1440, "Use at most 1440."),
  quiet_hours_start: clockTime,
  quiet_hours_end: clockTime,
});

export type ClinicConfigForm = z.output<typeof clinicConfigSchema>;

/** Dentist ids default to a slug of the name so they are stable keys (guide §9.7). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/^dr\.?\s+/, "dr-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Give every dentist a unique, non-empty id. */
export function normaliseDoctors(input: z.output<typeof doctorSchema>[]): Doctor[] {
  const used = new Set<string>();
  return input.map((d) => {
    const base = (d.id && d.id.trim()) || slugify(d.name) || "dentist";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return d.email ? { id, name: d.name, email: d.email } : { id, name: d.name };
  });
}

// ---------------------------------------------------------------------------
// Manual cancellation (guide §7 E2, "Add cancellation")
// ---------------------------------------------------------------------------

export const manualCancellationSchema = z.object({
  slot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  slot_time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."),
  slot_duration_minutes: z.coerce.number().int().min(5, "Use 5 to 480 minutes.").max(480, "Use 5 to 480 minutes."),
  procedure_type: z.preprocess(blank, z.enum(PROCEDURES).optional()),
  doctor_id: optionalText(60),
  cancelled_patient_name: optionalText(120),
  cancellation_reason: optionalText(300),
});

export type ManualCancellationForm = z.output<typeof manualCancellationSchema>;

// ---------------------------------------------------------------------------
// Team (guide §6.8)
// ---------------------------------------------------------------------------

export const inviteSchema = z.object({
  email: emailField,
  role: z.enum(["admin", "staff"], { error: "Choose a role." }),
});

export const memberRoleSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["admin", "staff"], { error: "Choose a role." }),
});

export const memberTargetSchema = z.object({ user_id: z.uuid() });

export const pipelineTargetSchema = z.object({
  pipeline_id: z.uuid(),
  reason: optionalText(300),
});
