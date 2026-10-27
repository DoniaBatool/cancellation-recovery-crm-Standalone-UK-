import { DEFAULT_TIMEZONE } from "@/lib/constants";

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Display a slot in the clinic timezone, e.g. "Tue 14 Oct, 14:30". */
export function formatSlot(value: DateInput, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** Display a time of day in the clinic timezone, e.g. "14:30". */
export function formatTime(value: DateInput, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(toDate(value));
}

/** Whole pounds as GBP, e.g. 1250 -> "£1,250". */
export function formatGBP(pounds: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pounds);
}

/** 0.4286 -> "43%". */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Weekday and time only, e.g. "Tue 14:30" (used in short subject lines). */
export function formatDayTime(value: DateInput, timeZone: string = DEFAULT_TIMEZONE): string {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(toDate(value));
  return `${weekday} ${formatTime(value, timeZone)}`;
}
