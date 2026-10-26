import { describe, expect, it } from "vitest";
import { joinUrl, qrPng, qrSvg, shortUrl } from "@/lib/waitlist-qr";

describe("join url", () => {
  it("builds the sign-up link and drops trailing slashes", () => {
    expect(joinUrl("https://app.example.com/", "smile-dental")).toBe("https://app.example.com/join/smile-dental");
    expect(joinUrl("http://localhost:3000", "a b")).toBe("http://localhost:3000/join/a%20b");
  });

  it("strips the scheme for the printed short link", () => {
    expect(shortUrl("https://app.example.com/join/x")).toBe("app.example.com/join/x");
  });
});

describe("QR output", () => {
  it("returns a PNG", async () => {
    const png = await qrPng("https://app.example.com/join/x", 200);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("returns SVG markup", async () => {
    expect(await qrSvg("https://app.example.com/join/x")).toContain("<svg");
  });
});
