"use server";

import { revalidatePath } from "next/cache";
import { getEngineDeps } from "@/lib/engine/runtime";
import { respondToOffer } from "@/lib/engine/respond";
import type { OfferState } from "@/lib/offers";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { isIpRateLimited } from "@/lib/rate-limit-request";

// The patient's answer from /confirm/[token]. No login: the token in the link is the credential.
// Source: SYSTEM_BUILD_GUIDE.md §8.1 (server action respond).

export type RespondState = { state: OfferState } | { error: string } | null;

export async function respondAction(token: string, _prev: RespondState, formData: FormData): Promise<RespondState> {
  const answer = formData.get("answer");
  if (answer !== "accepted" && answer !== "declined") return { error: "Please choose Yes or No." };

  if (await isIpRateLimited(RATE_LIMITS.confirmAnswer)) {
    return { error: "Too many attempts. Please wait a few minutes, or call the practice." };
  }

  const deps = getEngineDeps();
  if (!deps) return { error: "Something went wrong on our side. Please call the practice." };

  try {
    const { state } = await respondToOffer(deps, token, answer, "link");
    revalidatePath("/crm");
    return { state };
  } catch (error) {
    console.error("respondAction failed:", error instanceof Error ? error.message : error);
    return { error: "Something went wrong. Please try again, or call the practice." };
  }
}
