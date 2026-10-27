import type { SupabaseMgmt, VercelClient } from "./api-clients.mjs";
export type Deps = {
  files: {
    readFile(p: string): Promise<string>;
    writeFile(p: string, data: string, mode?: number): Promise<void>;
    listMigrationFiles(): Promise<string[]>;
    readMigration(file: string): Promise<string>;
  };
  mgmt: (token: string) => SupabaseMgmt;
  vercel: (token: string, teamId?: string) => VercelClient;
  createAdmin: (url: string, secretKey: string) => any;
  log: (msg: string) => void;
  generate?: (bytes: number) => string;
};
export function applyMigrations(deps: Deps, mgmt: SupabaseMgmt, ref: string): Promise<string[]>;
export function runClinicSetup(
  deps: Deps,
  filePath: string,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; errors: string[]; warnings: string[]; dryRun?: boolean; clinicId?: string; applied?: string[] }>;
export function runMigrateAll(
  deps: Deps,
  filePaths: string[],
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; results: Array<{ clinic: string; ok: boolean; applied?: string[]; dryRun?: boolean }> }>;
