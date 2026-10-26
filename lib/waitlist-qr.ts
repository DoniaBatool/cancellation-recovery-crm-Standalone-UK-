import QRCode from "qrcode";

// Waitlist sign-up link and QR code. Source: SYSTEM_BUILD_GUIDE.md §9.7 and §9.11.
// The QR uses error correction M and dark #0f172a on white.

const QR_DARK = "#0f172a";
const QR_LIGHT = "#ffffff";

/** https://app.example.com/join/smile-dental */
export function joinUrl(appUrl: string, slug: string): string {
  return `${appUrl.replace(/\/+$/, "")}/join/${encodeURIComponent(slug)}`;
}

/** The URL without the scheme, for the short line under the printed QR code. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** PNG bytes for the QR code (download button and preview). */
export async function qrPng(url: string, width = 640): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width,
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
}

/** Inline SVG markup for the QR code (crisp when printed). */
export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
}
