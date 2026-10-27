import { describe, expect, it } from "vitest";
import { loadOfferView } from "@/lib/engine/offer-view";
import { makeWorld, patientRow } from "./helpers/engine-world";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const offer = { id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", offer_token: TOKEN, response: "pending", offer_expires_at: "2026-10-26T10:30:00Z" };

describe("loadOfferView", () => {
  it("returns only what the patient may see", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offer], patients: [patientRow("a", { patient_name: "Sarah Khan" })] });
    const view = await loadOfferView(w.deps, TOKEN);
    expect(view).toMatchObject({
      state: "open",
      firstName: "Sarah",
      clinic: { name: "Smile Dentals", address: "1 High St", phone: "020 0000 0000" },
      procedure: "cleaning",
      doctorName: "Dr Ali Khan",
      differentDentist: false,
      expiresIso: "2026-10-26T10:30:00Z",
    });
    expect(JSON.stringify(view)).not.toContain("example.com");
  });

  it("flags a dentist who is not one of the patient's preferred dentists", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offer], patients: [patientRow("a", { preferred_doctors: ["Dr Sara Lee"] })] });
    expect((await loadOfferView(w.deps, TOKEN))?.differentDentist).toBe(true);
    const same = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offer], patients: [patientRow("a", { preferred_doctors: ["dr. ali khan"] })] });
    expect((await loadOfferView(same.deps, TOKEN))?.differentDentist).toBe(false);
  });

  it("reflects the state: expired, unavailable", async () => {
    const expired = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [{ ...offer, offer_expires_at: "2026-10-26T09:00:00Z" }] });
    expect((await loadOfferView(expired.deps, TOKEN))?.state).toBe("expired");
    const gone = makeWorld({ pipeline: { stage: "slot_recovered" }, offers: [offer] });
    expect((await loadOfferView(gone.deps, TOKEN))?.state).toBe("slot_unavailable");
  });

  it("returns null for a bad or unknown token", async () => {
    const w = makeWorld({ offers: [offer] });
    expect(await loadOfferView(w.deps, "bad")).toBeNull();
    expect(await loadOfferView(w.deps, "22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});
