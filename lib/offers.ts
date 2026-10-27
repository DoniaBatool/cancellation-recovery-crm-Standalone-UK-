// Offer state. Source: SYSTEM_BUILD_GUIDE.md §6.4. Pure: pass `now` in.

import type { Stage } from "@/lib/constants";

export type OfferState = "open" | "accepted" | "declined" | "expired" | "slot_unavailable";

export type OfferLike = {
  response: string;
  offer_expires_at: string | null;
};

export type PipelineLike = { stage: Stage | string };

export function getOfferState(offer: OfferLike, pipeline: PipelineLike, now: Date): OfferState {
  if (offer.response === "accepted") return "accepted";
  if (offer.response === "declined") return "declined";
  if (pipeline.stage === "slot_recovered" || pipeline.stage === "expired_manual") return "slot_unavailable";
  if (offer.response === "expired") return "expired";
  if (offer.offer_expires_at && new Date(offer.offer_expires_at).getTime() < now.getTime()) return "expired";
  return "open";
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Offer and approval tokens are random UUIDs; anything else is rejected before a database lookup. */
export function isValidToken(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}
