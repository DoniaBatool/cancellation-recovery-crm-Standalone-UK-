import { vi } from "vitest";
import type { EngineDeps } from "@/lib/engine/context";
import type { Notifier, OfferOutContext } from "@/lib/engine/notifier";
import { memoryDb } from "./memory-db";

export const NOW = new Date("2026-10-26T10:00:00Z"); // Monday, GMT (BST ended 25 Oct)
export const SLOT = "2026-10-26T15:00:00Z";

export function patientRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    clinic_id: "c1",
    patient_name: `Pat ${id}`,
    email: `${id}@example.com`,
    phone: "+447700900001",
    is_active: true,
    sms_opt_out: false,
    max_notice_hours: 0,
    preferred_procedures: [],
    preferred_days: [],
    preferred_times: [],
    preferred_doctors: [],
    last_contacted_at: null,
    ...over,
  };
}

export type WorldOptions = {
  patients?: ReturnType<typeof patientRow>[];
  config?: Record<string, unknown>;
  pipeline?: Record<string, unknown>;
  event?: Record<string, unknown>;
  offers?: Record<string, unknown>[];
  now?: Date;
  channels?: ("email" | "sms")[];
};

export function makeWorld(opts: WorldOptions = {}) {
  const store = memoryDb({
    clinics: [{ id: "c1", is_active: true, pms_type: "dentally", created_at: "2026-01-01T00:00:00Z", name: "Smile Dentals", timezone: "Europe/London", address: "1 High St", contact_email: "desk@example.com", contact_phone: "020 0000 0000" }],
    clinic_config: [
      {
        clinic_id: "c1",
        price_cleaning: 60, price_consultation: 50, price_filling: 120, price_extraction: 150, price_crown: 650, price_implant: 2000, price_whitening: 300, price_default: 100,
        engine_enabled: true,
        shadow_mode: false,
        slack_enabled: false,
        offer_channels: ["sms", "email"],
        offer_strategy: "sequential",
        batch_size: 3,
        offer_expiry_minutes: 30,
        max_offers_per_slot: 5,
        min_lead_minutes: 60,
        max_horizon_hours: 72,
        approval_window_minutes: 30,
        quiet_hours_start: "20:00:00",
        quiet_hours_end: "08:00:00",
        doctors: [{ id: "d1", name: "Dr Ali Khan", email: "ali@example.com" }],
        ...opts.config,
      },
    ],
    cancellation_events: [
      { id: "e1", clinic_id: "c1", slot_datetime: SLOT, slot_duration_minutes: 30, procedure_type: "cleaning", doctor_id: "d1", doctor_name: "Dr Ali Khan", ...opts.event },
    ],
    recovery_pipeline: [
      { id: "p1", clinic_id: "c1", cancellation_event_id: "e1", stage: "cancellation_detected", procedure_price: 150, waitlist_patient_id: null, approval_token: null, approval_token_expires_at: null, notes: null, ...opts.pipeline },
    ],
    waitlist: opts.patients ?? [patientRow("a"), patientRow("b"), patientRow("c")],
    waitlist_offers: opts.offers ?? [],
    recovery_pipeline_history: [],
    engine_state: [],
  });

  const sentOffers: OfferOutContext[] = [];
  const notifier = {
    channels: opts.channels ?? ["email"],
    offerOut: vi.fn(async (ctx: OfferOutContext) => {
      sentOffers.push(ctx);
      return ctx.channels;
    }),
    receptionApproval: vi.fn(async () => ({ via: "email" as const })),
    confirmation: vi.fn(async () => "Confirmation email: patient sent, doctor sent, reception sent."),
    slotExpired: vi.fn(async () => {}),
    approvalResolved: vi.fn(async () => {}),
  } satisfies Notifier;

  let n = 0;
  const deps: EngineDeps = { db: store.db, notifier, now: opts.now ?? NOW, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };
  const pipeline = () => store.tables.recovery_pipeline![0]!;
  const offers = () => store.tables.waitlist_offers!;
  const history = () => store.tables.recovery_pipeline_history!.map((h) => String(h.note));
  return { ...store, deps, notifier, sentOffers, pipeline, offers, history };
}
