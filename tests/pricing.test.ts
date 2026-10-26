import { describe, expect, it } from "vitest";
import { getProcedurePrice, isProcedure, procedureLabel, type PriceConfig } from "@/lib/pricing";

const config: PriceConfig = {
  price_cleaning: 60,
  price_consultation: 50,
  price_filling: 120,
  price_extraction: 150,
  price_crown: 600,
  price_implant: 2000,
  price_whitening: 300,
  price_default: 99,
};

describe("getProcedurePrice", () => {
  it("returns the price for each known procedure", () => {
    expect(getProcedurePrice(config, "cleaning")).toBe(60);
    expect(getProcedurePrice(config, "implant")).toBe(2000);
    expect(getProcedurePrice(config, "whitening")).toBe(300);
  });

  it.each([null, undefined, "", "root_canal", "CLEANING"])("falls back to the default for %p", (value) => {
    expect(getProcedurePrice(config, value)).toBe(99);
  });
});

describe("isProcedure", () => {
  it("accepts known procedures only", () => {
    expect(isProcedure("filling")).toBe(true);
    expect(isProcedure("nonsense")).toBe(false);
    expect(isProcedure(5)).toBe(false);
  });
});

describe("procedureLabel", () => {
  it("capitalises and handles missing values", () => {
    expect(procedureLabel("crown")).toBe("Crown");
    expect(procedureLabel(null)).toBe("Not specified");
    expect(procedureLabel("")).toBe("Not specified");
  });
});
