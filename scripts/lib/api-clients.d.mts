export class ApiCallError extends Error {
  status: number;
}
export function pickKeys(list: unknown): { publishableKey: string; secretKey: string };
export type SupabaseMgmt = {
  getApiKeys(ref: string): Promise<{ publishableKey: string; secretKey: string }>;
  query(ref: string, sql: string): Promise<Array<Record<string, unknown>>>;
  patchAuthConfig(ref: string, payload: Record<string, string>): Promise<unknown>;
};
export function createSupabaseMgmt(opts: { token: string; fetchImpl?: typeof fetch; base?: string }): SupabaseMgmt;
export type VercelClient = {
  pushEnv(projectId: string, vars: Array<{ key: string; value: string; type: string }>): Promise<number>;
};
export function createVercel(opts: { token: string; teamId?: string; fetchImpl?: typeof fetch; base?: string }): VercelClient;
