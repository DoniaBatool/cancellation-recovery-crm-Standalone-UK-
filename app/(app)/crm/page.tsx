import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { isStage, STAGE_TIMESTAMP, type Stage } from "@/lib/constants";
import { readDoctors } from "@/lib/doctors";
import { procedureLabel } from "@/lib/pricing";
import { getAppUrl } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dateInZone } from "@/lib/time";
import { AddCancellationDialog } from "./add-cancellation-dialog";
import { Board, type BoardCard } from "./board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

const CARD_LIMIT = 200;

export default async function PipelinePage() {
  const { clinic } = await requireSession();
  const supabase = await createSupabaseServerClient();

  const [{ data: config }, { data: pipelines }] = await Promise.all([
    supabase.from("clinic_config").select("doctors").eq("clinic_id", clinic.id).maybeSingle(),
    supabase
      .from("recovery_pipeline")
      .select(
        "id, stage, cancellation_event_id, waitlist_patient_id, procedure_price, revenue_saved, detected_at, created_at, offer_sent_at, approval_requested_at, confirmed_at, expired_at, notes, booked_in_pms_at",
      )
      .eq("clinic_id", clinic.id)
      .order("created_at", { ascending: false })
      .limit(CARD_LIMIT),
  ]);

  const rows = pipelines ?? [];
  const eventIds = [...new Set(rows.map((p) => p.cancellation_event_id))];
  const patientIds = [...new Set(rows.map((p) => p.waitlist_patient_id).filter((id): id is string => Boolean(id)))];
  const pipelineIds = rows.map((p) => p.id);

  const [{ data: events }, { data: patients }, { data: offers }] = await Promise.all([
    eventIds.length
      ? supabase
          .from("cancellation_events")
          .select("id, slot_datetime, procedure_type, doctor_name, cancelled_patient_name")
          .in("id", eventIds)
      : Promise.resolve({ data: [] }),
    patientIds.length
      ? supabase.from("waitlist").select("id, patient_name, phone").in("id", patientIds)
      : Promise.resolve({ data: [] }),
    pipelineIds.length
      ? supabase.from("waitlist_offers").select("pipeline_id, response, offer_expires_at, offer_token").in("pipeline_id", pipelineIds)
      : Promise.resolve({ data: [] }),
  ]);

  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  const patientById = new Map((patients ?? []).map((p) => [p.id, p]));

  const cards: BoardCard[] = [];
  for (const p of rows) {
    const event = eventById.get(p.cancellation_event_id);
    if (!event || !isStage(p.stage)) continue;
    const stage: Stage = p.stage;
    const patient = p.waitlist_patient_id ? patientById.get(p.waitlist_patient_id) : undefined;
    const myOffers = (offers ?? []).filter((o) => o.pipeline_id === p.id);
    const pendingExpiries = myOffers
      .filter((o) => o.response === "pending" && o.offer_expires_at)
      .map((o) => o.offer_expires_at as string)
      .sort();
    const openOffer = myOffers
      .filter((o) => o.response === "pending" && o.offer_token && (!o.offer_expires_at || new Date(o.offer_expires_at).getTime() >= Date.now()))
      .sort((a, b) => String(a.offer_expires_at).localeCompare(String(b.offer_expires_at)))[0];
    const stampColumn = STAGE_TIMESTAMP[stage] as keyof typeof p | undefined;
    const since = (stampColumn ? (p[stampColumn] as string | null) : null) ?? p.detected_at ?? p.created_at;

    cards.push({
      id: p.id,
      stage,
      slotIso: event.slot_datetime,
      procedure: procedureLabel(event.procedure_type),
      doctor: event.doctor_name,
      cancelledPatient: event.cancelled_patient_name,
      patientId: patient?.id ?? null,
      patientName: patient?.patient_name ?? null,
      patientPhone: patient?.phone ?? null,
      value: stage === "slot_recovered" ? (p.revenue_saved ?? p.procedure_price) : p.procedure_price,
      sinceIso: since,
      offerExpiresIso: pendingExpiries[0] ?? null,
      offeredCount: myOffers.length,
      notes: p.notes,
      offerLink: stage === "offer_sent" && openOffer?.offer_token ? `${getAppUrl()}/confirm/${openOffer.offer_token}` : null,
      bookedAtIso: p.booked_in_pms_at,
    });
  }

  // Soonest slot first inside each column.
  cards.sort((a, b) => new Date(a.slotIso).getTime() - new Date(b.slotIso).getTime());

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Each cancelled slot moves left to right until it is filled."
        actions={<AddCancellationDialog doctors={readDoctors(config?.doctors)} today={dateInZone(new Date(), clinic.timezone)} />}
      />
      <Board cards={cards} timezone={clinic.timezone} />
    </>
  );
}
