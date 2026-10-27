// What the engine needs from the outside world (email, Slack, later SMS).
// Source: SYSTEM_BUILD_GUIDE.md §7 E4, E6, E8. The engine only talks to this interface, so the
// decision logic is tested without sending anything. Phase 3c adds the real email/Slack notifier.
// Every method must never throw: a failed send must not undo a stage change.

export type OfferChannel = "email" | "sms";

export type ClinicInfo = {
  id: string;
  name: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
};

export type SlotInfo = {
  datetime: string;
  durationMinutes: number;
  procedure: string | null;
  doctorName: string | null;
};

export type PatientInfo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** True when the patient has opted out of texts. */
  smsOptOut?: boolean;
};

export type OfferOutContext = {
  clinic: ClinicInfo;
  slot: SlotInfo;
  patient: PatientInfo;
  pipelineId: string;
  offerId: string;
  offerToken: string;
  offerExpiresAt: string;
  offerExpiryMinutes: number;
  channels: OfferChannel[];
  /** "yes" | "no" | "any": whether the slot dentist is the patient's preferred one. */
  preferredDoctorMatch: "yes" | "no" | "any";
  shadowMode: boolean;
};

export type ReceptionContext = {
  clinic: ClinicInfo;
  slot: SlotInfo;
  patient: PatientInfo;
  pipelineId: string;
  approvalToken: string;
  approvalWindowMinutes: number;
  price: number | null;
  slackEnabled: boolean;
  /** Set when a Slack message was already posted (for chat.update). */
  slackMessageTs: string | null;
  /** True for the 50%-of-window reminder: email only, no new Slack message. */
  reminder?: boolean;
};

export type ConfirmationContext = {
  clinic: ClinicInfo;
  slot: SlotInfo;
  patient: PatientInfo;
  doctorEmail: string | null;
  /** Whose cancelled appointment this replaces (for the doctor's email), if known. */
  cancelledPatientName?: string | null;
  pipelineId: string;
  price: number | null;
  shadowMode: boolean;
};

/** Reception answered (approved or offered to the next patient): used to close the Slack buttons. */
export type ResolvedContext = {
  clinic: ClinicInfo;
  slackMessageTs: string | null;
  /** e.g. "Approved by Sam" or "Offered to the next patient by Sam". */
  text: string;
  kind: "approved" | "next";
};

export type ExpiredContext = {
  clinic: ClinicInfo;
  slot: SlotInfo;
  pipelineId: string;
  reason: string;
  offeredCount: number;
};

export interface Notifier {
  /** Channels this notifier can really deliver on. Patients with none of them are skipped. */
  readonly channels: readonly OfferChannel[];
  /** Returns the channels that were actually sent (empty = nothing went out). */
  offerOut(context: OfferOutContext): Promise<OfferChannel[]>;
  /** Tells reception a patient said YES. Returns how (Slack or email), or null if neither worked. */
  receptionApproval(context: ReceptionContext): Promise<{ via: "slack" | "email" | null; slackMessageTs?: string | null }>;
  /** Emails patient, doctor and reception after approval. Returns a short summary for the history log. */
  confirmation(context: ConfirmationContext): Promise<string>;
  /** Alerts reception that a slot ended unfilled. */
  slotExpired(context: ExpiredContext): Promise<void>;
  /** Optional: update the Slack message so old buttons never stay live. */
  approvalResolved?(context: ResolvedContext): Promise<void>;
}

/** Sends nothing. Used until the real notifier is configured, and in tests. */
export const silentNotifier: Notifier = {
  channels: [],
  async offerOut() {
    return [];
  },
  async receptionApproval() {
    return { via: null };
  },
  async confirmation() {
    return "Confirmation emails not sent (email is not set up).";
  },
  async slotExpired() {},
};
