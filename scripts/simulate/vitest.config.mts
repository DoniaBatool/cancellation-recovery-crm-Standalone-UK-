import { defineConfig } from "vitest/config";
import path from "node:path";

// Used only by `pnpm simulate`. Separate from the unit-test config so the simulation never runs in `pnpm test`.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "../.."),
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../..") } },
  test: {
    environment: "node",
    include: ["scripts/simulate/*.sim.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
