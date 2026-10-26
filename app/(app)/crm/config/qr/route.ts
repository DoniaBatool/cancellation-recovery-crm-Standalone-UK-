import { getAppUrl } from "@/lib/env";
import { getSessionContext } from "@/lib/session";
import { joinUrl, qrPng } from "@/lib/waitlist-qr";

// GET /crm/config/qr: PNG of the clinic's sign-up link (guide §8.3). Signed-in staff only.
// ?download=1 makes the browser save the file instead of showing it.
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Not signed in", { status: 401 });

  const png = await qrPng(joinUrl(getAppUrl(), ctx.clinic.slug));
  const download = new URL(request.url).searchParams.get("download") === "1";

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      ...(download ? { "Content-Disposition": `attachment; filename="${ctx.clinic.slug}-waitlist-qr.png"` } : {}),
    },
  });
}
