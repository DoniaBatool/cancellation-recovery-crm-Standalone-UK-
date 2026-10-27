import { loadPipeline, type EngineDeps } from "@/lib/engine/context";
import { getOfferState, isValidToken, type OfferState } from "@/lib/offers";
import { normaliseDoctorName } from "@/lib/waitlist-matching";

// What the patient sees on /confirm/[token]. Source: SYSTEM_BUILD_GUIDE.md §9.10.
// Only first name, slot, dentist and clinic details are returned: nothing about other patients.

export type OfferView = {
  state: OfferState;
  firstName: string;
  clinic: { name: string; address: string | null; phone: string | null; timezone: string };
  slotIso: string;
  procedure: string | null;
  doctorName: string | null;
  /** Set when the slot dentist is not one of the patient's preferred dentists. */
  differentDentist: boolean;
  expiresIso: string | null;
};

export async function loadOfferView(deps: EngineDeps, token: string): Promise<OfferView | null> {
  if (!isValidToken(token)) return null;
  const now = deps.now ?? new Date();

  const { data: offer } = await deps.db.from("waitlist_offers").select("*").eq("offer_token", token).maybeSingle();
  if (!offer) return null;
  const loaded = await loadPipeline(deps.db, offer.pipeline_id);
  if (!loaded) return null;
  const { data: patient } = await deps.db
    .from("waitlist")
    .select("patient_name, preferred_doctors")
    .eq("id", offer.waitlist_patient_id)
    .maybeSingle();
  if (!patient) return null;

  const slotDoctor = loaded.event.doctor_name ? normaliseDoctorName(loaded.event.doctor_name) : null;
  const preferred = patient.preferred_doctors.map(normaliseDoctorName).filter(Boolean);

  return {
    state: getOfferState(offer, loaded.pipeline, now),
    firstName: patient.patient_name.trim().split(/\s+/)[0] ?? patient.patient_name,
    clinic: {
      name: loaded.clinic.name,
      address: loaded.clinic.address,
      phone: loaded.clinic.contact_phone,
      timezone: loaded.clinic.timezone,
    },
    slotIso: loaded.event.slot_datetime,
    procedure: loaded.event.procedure_type,
    doctorName: loaded.event.doctor_name,
    differentDentist: Boolean(slotDoctor && preferred.length > 0 && !preferred.includes(slotDoctor)),
    expiresIso: offer.offer_expires_at,
  };
}
