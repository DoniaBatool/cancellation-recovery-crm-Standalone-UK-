import { PROCEDURES, type Procedure } from "@/lib/constants";

// Procedure prices. Source: SYSTEM_BUILD_GUIDE.md §6.3.
//   getProcedurePrice(config, procedure) -> config.price_<procedure>, or price_default
//   when the procedure is unknown or missing. Whole pounds.

export type PriceConfig = {
  price_cleaning: number;
  price_consultation: number;
  price_filling: number;
  price_extraction: number;
  price_crown: number;
  price_implant: number;
  price_whitening: number;
  price_default: number;
};

export function isProcedure(value: unknown): value is Procedure {
  return typeof value === "string" && (PROCEDURES as readonly string[]).includes(value);
}

export function getProcedurePrice(config: PriceConfig, procedure: string | null | undefined): number {
  if (!isProcedure(procedure)) return config.price_default;
  return config[`price_${procedure}`];
}

/** Capitalised label for display, e.g. "cleaning" -> "Cleaning". Unknown or missing -> "Not specified". */
export function procedureLabel(procedure: string | null | undefined): string {
  if (!procedure) return "Not specified";
  return procedure.charAt(0).toUpperCase() + procedure.slice(1);
}
