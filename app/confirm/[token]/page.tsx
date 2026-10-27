import type { Metadata } from "next";
import { CalendarCheck, MapPin, Phone } from "lucide-react";
import { getEngineDeps } from "@/lib/engine/runtime";
import { loadOfferView } from "@/lib/engine/offer-view";
import { formatSlot, formatTime } from "@/lib/format";
import { procedureLabel } from "@/lib/pricing";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { isIpRateLimited } from "@/lib/rate-limit-request";
import { OfferActions, StateMessage } from "./offer-actions";

// Public offer page, no login, mobile first. Source: SYSTEM_BUILD_GUIDE.md §9.10.
// The token in the link is the patient's only credential, so the page is never indexed.
export const metadata: Metadata = { title: "Your appointment offer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await isIpRateLimited(RATE_LIMITS.confirmView);
  const deps = getEngineDeps();
  const view = deps && !limited ? await loadOfferView(deps, token) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center gap-2 text-primary">
        <CalendarCheck className="h-6 w-6" aria-hidden="true" />
        <span className="text-lg font-semibold">{view?.clinic.name ?? "Your dental practice"}</span>
      </header>

      {!view ? (
        <StateMessage state="slot_unavailable" />
      ) : view.state !== "open" ? (
        <StateMessage state={view.state} />
      ) : (
        <>
          <section className="flex flex-col gap-4 rounded-lg border bg-card p-5">
            <h1 className="text-2xl font-semibold tracking-tight">Hi {view.firstName}, a slot just opened for you</h1>
            <dl className="flex flex-col gap-3">
              <div>
                <dt className="text-sm text-muted-foreground">When</dt>
                <dd className="text-lg font-semibold">{formatSlot(view.slotIso, view.clinic.timezone)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Treatment</dt>
                <dd className="font-medium">{procedureLabel(view.procedure)}</dd>
              </div>
              {view.doctorName ? (
                <div>
                  <dt className="text-sm text-muted-foreground">Dentist</dt>
                  <dd className="font-medium">{view.doctorName}</dd>
                </div>
              ) : null}
            </dl>
            {view.differentDentist && view.doctorName ? (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">This slot is with {view.doctorName}, not your usual dentist.</p>
            ) : null}
            {view.expiresIso ? (
              <p className="text-sm text-muted-foreground">Held for you until {formatTime(view.expiresIso, view.clinic.timezone)}.</p>
            ) : null}
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {view.clinic.address ? (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {view.clinic.address}
                </p>
              ) : null}
              {view.clinic.phone ? (
                <a href={`tel:${view.clinic.phone.replace(/\s+/g, "")}`} className="flex min-h-11 items-center gap-2 text-link underline-offset-4 hover:underline">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {view.clinic.phone}
                </a>
              ) : null}
            </div>
          </section>
          <OfferActions token={token} />
        </>
      )}
    </main>
  );
}
