import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EngineDeps } from "@/lib/engine/context";
import { ingestCancellation } from "@/lib/engine/intake";
import type { ConfirmationContext, ExpiredContext, Notifier, OfferOutContext, ReceptionContext } from "@/lib/engine/notifier";
import { startOffers } from "@/lib/engine/offer";
import { approveBooking } from "@/lib/engine/approve";
import { respondToOffer } from "@/lib/engine/respond";
import { runTick } from "@/lib/engine/tick";

// End-to-end run of the whole recovery loop against a REAL Supabase project (the dev one).
// Source: SYSTEM_BUILD_GUIDE.md §14 (simulate-flow). Started by `pnpm simulate` (scripts/simulate-flow.mjs).
//
//   1. create a test clinic and 3 waitlist patients
//   2. post a fake cancellation
//   3. assert the offer row exists
//   4. respond NO to the first patient -> the second gets an offer
//   5. respond YES
//   6. approve
//   7. assert slot_recovered + revenue_saved + emails attempted
//
// SIM_FAST=1 runs the same story through the cron path instead: the card is left stuck, the offer is
// aged past its expiry, and runTick() (what the once-a-minute cron calls) does the work.
//
// Nothing is really sent: a recording notifier stands in for email, SMS and Slack. The test clinic is
// deleted at the end (SIM_KEEP=1 keeps it for inspection).

const FAST = process.env.SIM_FAST === "1";
const KEEP = process.env.SIM_KEEP === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");

const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const sent = {
  offers: [] as OfferOutContext[],
  approvals: [] as ReceptionContext[],
  confirmations: [] as ConfirmationContext[],
  expired: [] as ExpiredContext[],
};
const notifier: Notifier = {
  channels: ["email", "sms"],
  async offerOut(c) {
    sent.offers.push(c);
    return ["email", "sms"];
  },
  async receptionApproval(c) {
    sent.approvals.push(c);
    return { via: "email" };
  },
  async confirmation(c) {
    sent.confirmations.push(c);
    return "Simulated confirmation emails recorded.";
  },
  async slotExpired(c) {
    sent.expired.push(c);
  },
};
const deps: EngineDeps = { db, notifier };

const tag = Math.random().toString(36).slice(2, 8);
const state = { clinicId: "", pipelineId: "", patientIds: [] as string[], firstOffered: "", secondOffered: "" };

async function offersFor(pipelineId: string) {
  const { data, error } = await db
    .from("waitlist_offers")
    .select("id, waitlist_patient_id, response, offer_token, offer_expires_at")
    .eq("pipeline_id", pipelineId)
    .order("offered_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

beforeAll(async () => {
  if (FAST) {
    // The tick works on every clinic, so only run it where no real clinic has the engine switched on.
    const { data } = await db.from("clinic_config").select("clinic_id").eq("engine_enabled", true);
    if ((data ?? []).length > 0) {
      throw new Error("Refusing to run --fast: a clinic in this database has the engine ON, and the tick would act on it.");
    }
  }
});

afterAll(async () => {
  if (state.clinicId && !KEEP) {
    await db.from("clinics").delete().eq("id", state.clinicId); // cascades to everything the run created
    const { data } = await db.from("clinics").select("id").eq("id", state.clinicId);
    if ((data ?? []).length > 0) console.warn(`Test clinic ${state.clinicId} could not be deleted; remove it by hand.`);
  }
});

describe(`simulate-flow${FAST ? " --fast (cron path)" : ""}`, () => {
  it("1. creates a test clinic and 3 waitlist patients", async () => {
    const { data: clinic, error } = await db
      .from("clinics")
      .insert({ name: "Simulation Dental", slug: `sim-${tag}`, contact_email: "reception@example.com" })
      .select("id")
      .single();
    expect(error).toBeNull();
    state.clinicId = clinic!.id;

    const { error: cfgError } = await db.from("clinic_config").insert({
      clinic_id: state.clinicId,
      engine_enabled: true,
      shadow_mode: true,
      offer_channels: ["sms", "email"],
      // No quiet hours, so the simulation works at any time of day.
      quiet_hours_start: "00:00",
      quiet_hours_end: "00:00",
    });
    expect(cfgError).toBeNull();

    const patients = [1, 2, 3].map((n) => ({
      clinic_id: state.clinicId,
      patient_name: `Sim Patient ${n}`,
      email: `sim.patient${n}.${tag}@example.com`,
      phone: `+4477009001${String(n).padStart(2, "0")}`,
      max_notice_hours: 0,
      // Older "last contacted" goes first, so the order is predictable.
      last_contacted_at: new Date(Date.now() - (10 - n) * 86_400_000).toISOString(),
    }));
    const { data: rows, error: pError } = await db.from("waitlist").insert(patients).select("id, patient_name").order("patient_name");
    expect(pError).toBeNull();
    state.patientIds = rows!.map((r) => r.id);
    expect(state.patientIds).toHaveLength(3);
  });

  it("2. posts a fake cancellation", async () => {
    const slot = new Date(Date.now() + 6 * 3_600_000);
    const result = await ingestCancellation(db, {
      clinicId: state.clinicId,
      clinicTimezone: "Europe/London",
      config: {
        min_lead_minutes: 60,
        max_horizon_hours: 336,
        engine_enabled: true,
        price_cleaning: 150,
        price_consultation: 80,
        price_filling: 200,
        price_extraction: 180,
        price_crown: 700,
        price_implant: 2500,
        price_whitening: 350,
        price_default: 200,
      },
      slotDatetime: slot,
      slotDurationMinutes: 30,
      procedureType: "cleaning",
      doctorId: null,
      doctorName: null,
      cancelledPatientName: "Sim Cancelled",
      pmsSource: "manual",
      pmsAppointmentId: `sim-${tag}`,
      triggeredBy: "front_desk",
      logNote: "Simulation: cancellation added",
    });
    expect(result.duplicate).toBe(false);
    expect(result.stage).toBe("cancellation_detected");
    expect(result.shouldStartOffers).toBe(true);
    state.pipelineId = result.pipelineId;

    if (FAST) {
      // Leave the card stuck, as if the webhook handler died: the tick must pick it up (self-heal after 2 minutes).
      await db
        .from("recovery_pipeline")
        .update({ detected_at: new Date(Date.now() - 5 * 60_000).toISOString() })
        .eq("id", state.pipelineId);
      const summary = await runTick(deps);
      expect(summary.healed).toBe(1);
    } else {
      const run = await startOffers(deps, state.pipelineId);
      expect(run.status).toBe("offered");
    }
  });

  it("3. an offer row exists for the first patient", async () => {
    const offers = await offersFor(state.pipelineId);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.response).toBe("pending");
    expect(offers[0]!.offer_token).toBeTruthy();
    expect(state.patientIds).toContain(offers[0]!.waitlist_patient_id);
    state.firstOffered = offers[0]!.waitlist_patient_id;
    expect(sent.offers).toHaveLength(1);
    expect(sent.offers[0]!.patient.id).toBe(state.firstOffered);
    expect(sent.offers[0]!.shadowMode).toBe(true);
  });

  it(FAST ? "4. the first offer expires and the cron moves on to the second patient" : "4. NO from the first patient -> the second patient gets an offer", async () => {
    const [first] = await offersFor(state.pipelineId);
    if (FAST) {
      await db.from("waitlist_offers").update({ offer_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", first!.id);
      const summary = await runTick(deps);
      expect(summary.expiredOffers).toBe(1);
      expect(summary.advanced).toBe(1);
    } else {
      const { state: answerState } = await respondToOffer(deps, first!.offer_token!, "declined", "link");
      expect(answerState).toBe("declined");
    }
    const offers = await offersFor(state.pipelineId);
    expect(offers).toHaveLength(2);
    expect(offers[0]!.response).toBe(FAST ? "expired" : "declined");
    expect(offers[1]!.response).toBe("pending");
    expect(offers[1]!.waitlist_patient_id).not.toBe(state.firstOffered);
    state.secondOffered = offers[1]!.waitlist_patient_id;
    expect(sent.offers).toHaveLength(2);
  });

  it("5. YES from the second patient -> waiting for reception", async () => {
    const offers = await offersFor(state.pipelineId);
    const second = offers[1]!;
    const { state: answerState } = await respondToOffer(deps, second.offer_token!, "accepted", "link");
    expect(answerState).toBe("accepted");
    const { data: pipeline } = await db.from("recovery_pipeline").select("stage, approval_token, waitlist_patient_id").eq("id", state.pipelineId).single();
    expect(pipeline!.stage).toBe("waiting_staff_approval");
    expect(pipeline!.approval_token).toBeTruthy();
    expect(pipeline!.waitlist_patient_id).toBe(state.secondOffered);
    expect(sent.approvals).toHaveLength(1);

    // A second tap on the same link must not do anything more.
    const again = await respondToOffer(deps, second.offer_token!, "declined", "link");
    expect(again.state).toBe("accepted");
    expect((await offersFor(state.pipelineId))[1]!.response).toBe("accepted");
  });

  it("6. reception approves", async () => {
    const result = await approveBooking(deps, state.pipelineId, { kind: "slack", label: "Simulation" });
    expect(result.status).toBe("approved");
    const second = await approveBooking(deps, state.pipelineId, { kind: "slack", label: "Simulation" });
    expect(second.status).toBe("already_confirmed");
  });

  it("7. the slot is recovered, revenue is saved and confirmations were attempted", async () => {
    const { data: pipeline } = await db.from("recovery_pipeline").select("stage, revenue_saved, confirmed_at, approved_by").eq("id", state.pipelineId).single();
    expect(pipeline!.stage).toBe("slot_recovered");
    expect(pipeline!.revenue_saved).toBe(150);
    expect(pipeline!.confirmed_at).toBeTruthy();
    expect(pipeline!.approved_by).toBeNull(); // approved "from Slack", so no staff user id
    expect(sent.confirmations).toHaveLength(1);
    expect(sent.confirmations[0]!.patient.id).toBe(state.secondOffered);

    const { data: history } = await db.from("recovery_pipeline_history").select("to_stage").eq("pipeline_id", state.pipelineId);
    const stages = new Set((history ?? []).map((h) => h.to_stage));
    for (const s of ["cancellation_detected", "offer_sent", "waiting_staff_approval", "slot_recovered"]) expect(stages.has(s)).toBe(true);
  });
});
