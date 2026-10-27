import { describe, expect, it, vi } from "vitest";
import { approveBooking, markBooked, notifyReception, offerToNext } from "@/lib/engine/approve";
import { NOW, makeWorld } from "./helpers/engine-world";

const waiting = {
  stage: "waiting_staff_approval",
  waitlist_patient_id: "a",
  approval_token: "33333333-3333-4333-8333-333333333333",
  approval_token_expires_at: "2026-10-26T10:30:00Z",
};
const offers = [
  { id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "accepted", offer_token: "t1" },
  { id: "o2", pipeline_id: "p1", waitlist_patient_id: "b", response: "pending", offer_token: "t2" },
];
const user = { kind: "user", userId: "u1", label: "reception@clinic.co.uk" } as const;

describe("approveBooking", () => {
  it("moves to slot_recovered, counts the revenue and records who approved", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    expect(await approveBooking(w.deps, "p1", user)).toEqual({ status: "approved", late: false });

    expect(w.pipeline()).toMatchObject({
      stage: "slot_recovered",
      revenue_saved: 150,
      approved_by: "u1",
      approved_at: NOW.toISOString(),
      confirmed_at: NOW.toISOString(),
    });
    expect(w.offers().find((o) => o.id === "o1")?.response).toBe("accepted");
    expect(w.offers().find((o) => o.id === "o2")?.response).toBe("expired");
    expect(w.history()).toContain("Approved by reception@clinic.co.uk.");
  });

  it("sends the confirmations with the dentist's email and logs the summary", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    await approveBooking(w.deps, "p1", user);
    expect(w.notifier.confirmation).toHaveBeenCalledWith(
      expect.objectContaining({ doctorEmail: "ali@example.com", price: 150, patient: expect.objectContaining({ id: "a" }) }),
    );
    expect(w.history().some((h) => h.startsWith("Confirmation email"))).toBe(true);
  });

  it("a failing confirmation never blocks the approval", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    w.notifier.confirmation.mockRejectedValueOnce(new Error("smtp down"));
    expect((await approveBooking(w.deps, "p1", user)).status).toBe("approved");
    expect(w.pipeline().stage).toBe("slot_recovered");
    expect(w.history().some((h) => h.includes("could not be sent"))).toBe(true);
  });

  it("Slack approval leaves approved_by empty and names the Slack user", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    await approveBooking(w.deps, "p1", { kind: "slack", label: "Amy" });
    expect(w.pipeline().approved_by).toBeNull();
    expect(w.history()).toContain("Approved in Slack by Amy.");
  });

  it("a second approval is 'already confirmed' and sends nothing twice", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    await approveBooking(w.deps, "p1", user);
    expect(await approveBooking(w.deps, "p1", user)).toEqual({ status: "already_confirmed" });
    expect(w.notifier.confirmation).toHaveBeenCalledTimes(1);
  });

  it("a late approval still works, with a warning in the history", async () => {
    const w = makeWorld({ pipeline: { ...waiting, approval_token_expires_at: "2026-10-26T09:00:00Z" }, offers });
    expect(await approveBooking(w.deps, "p1", user)).toEqual({ status: "approved", late: true });
    expect(w.history().some((h) => h.includes("Approval was late"))).toBe(true);
  });

  it("refuses a card that is not waiting for approval, or does not exist", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" } });
    await expect(approveBooking(w.deps, "p1", user)).rejects.toMatchObject({ status: 409, code: "not_awaiting_approval" });
    await expect(approveBooking(w.deps, "missing", user)).rejects.toMatchObject({ status: 404 });
  });

  it("creates the accepted offer row if it is missing", async () => {
    const w = makeWorld({ pipeline: waiting, offers: [] });
    await approveBooking(w.deps, "p1", user);
    expect(w.offers()).toHaveLength(1);
    expect(w.offers()[0]).toMatchObject({ waitlist_patient_id: "a", response: "accepted", responded_via: "crm" });
  });
});

describe("offerToNext", () => {
  it("declines the YES and offers the next patient", async () => {
    const w = makeWorld({ pipeline: waiting, offers: [offers[0]!] });
    const run = await offerToNext(w.deps, "p1", user);
    expect(run.status).toBe("offered");
    expect(w.offers().find((o) => o.id === "o1")?.response).toBe("declined");
    expect(w.pipeline()).toMatchObject({ stage: "offer_sent", waitlist_patient_id: "b" });
    expect(w.history().some((h) => h.includes("declined by reception"))).toBe(true);
  });

  it("refuses when the card is not waiting for approval", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" } });
    await expect(offerToNext(w.deps, "p1", user)).rejects.toMatchObject({ status: 409 });
  });
});

describe("notifyReception", () => {
  it("records how reception was told (Slack message id included)", async () => {
    const w = makeWorld({ pipeline: waiting });
    w.notifier.receptionApproval.mockResolvedValueOnce({ via: "slack" as never, slackMessageTs: "1700.01" } as never);
    await notifyReception(w.deps, "p1");
    expect(w.pipeline()).toMatchObject({ front_desk_notified_via: "slack", slack_message_ts: "1700.01" });
  });

  it("falls back to 'crm' when neither Slack nor email worked", async () => {
    const w = makeWorld({ pipeline: waiting });
    w.notifier.receptionApproval.mockResolvedValueOnce({ via: null } as never);
    await notifyReception(w.deps, "p1");
    expect(w.pipeline().front_desk_notified_via).toBe("crm");
    expect(w.history().some((h) => h.includes("could not be emailed"))).toBe(true);
  });

  it("does nothing for a card that is not waiting", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" } });
    await notifyReception(w.deps, "p1");
    expect(w.notifier.receptionApproval).not.toHaveBeenCalled();
  });
});

describe("markBooked", () => {
  it("sets booked_in_pms_at once, only on a recovered card", async () => {
    const w = makeWorld({ pipeline: { stage: "slot_recovered", booked_in_pms_at: null } });
    expect(await markBooked(w.deps, "p1", "amy@clinic.co.uk")).toBe(true);
    expect(w.pipeline().booked_in_pms_at).toBe(NOW.toISOString());
    expect(await markBooked(w.deps, "p1", "amy@clinic.co.uk")).toBe(false);

    const other = makeWorld({ pipeline: { stage: "offer_sent", booked_in_pms_at: null } });
    expect(await markBooked(other.deps, "p1", "amy")).toBe(false);
  });
});

describe("Slack message is closed after any approval path", () => {
  const slackWaiting = { ...waiting, slack_message_ts: "55.5" };

  it("on approve", async () => {
    const w = makeWorld({ pipeline: slackWaiting, offers });
    await approveBooking(w.deps, "p1", user);
    expect(w.notifier.approvalResolved).toHaveBeenCalledWith(expect.objectContaining({ slackMessageTs: "55.5", kind: "approved", text: "✅ Approved by reception@clinic.co.uk" }));
  });

  it("on offer to next", async () => {
    const w = makeWorld({ pipeline: slackWaiting, offers });
    await offerToNext(w.deps, "p1", user);
    expect(w.notifier.approvalResolved).toHaveBeenCalledWith(expect.objectContaining({ kind: "next" }));
  });

  it("not at all when no Slack message was posted, and a failing update never breaks approval", async () => {
    const a = makeWorld({ pipeline: waiting, offers });
    await approveBooking(a.deps, "p1", user);
    expect(a.notifier.approvalResolved).not.toHaveBeenCalled();

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = makeWorld({ pipeline: slackWaiting, offers });
    b.notifier.approvalResolved.mockRejectedValueOnce(new Error("slack down"));
    expect((await approveBooking(b.deps, "p1", user)).status).toBe("approved");
    spy.mockRestore();
  });
});
