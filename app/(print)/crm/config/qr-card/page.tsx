import type { Metadata } from "next";
import { getAppUrl } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { joinUrl, qrSvg, shortUrl } from "@/lib/waitlist-qr";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Print QR card", robots: { index: false } };

// Printable A5/A6 card for reception (guide §9.11). No app shell, so it prints clean.
export default async function QrCardPage() {
  const { clinic } = await requireSession();
  const url = joinUrl(getAppUrl(), clinic.slug);
  const svg = await qrSvg(url);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-6 px-6 py-8 text-center">
      <style>{`@page { size: A5; margin: 12mm; }`}</style>
      <PrintButton />
      <section className="flex w-full flex-col items-center gap-4 rounded-lg border bg-white p-8">
        <p className="text-lg font-semibold text-primary">{clinic.name}</p>
        <h1 className="text-2xl font-semibold leading-tight text-foreground">
          Want an earlier appointment?
          <br />
          Scan to join our short-notice list
        </h1>
        <div
          role="img"
          aria-label={`QR code for ${shortUrl(url)}`}
          className="h-64 w-64 [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="break-all text-base font-medium text-foreground">{shortUrl(url)}</p>
      </section>
    </main>
  );
}
