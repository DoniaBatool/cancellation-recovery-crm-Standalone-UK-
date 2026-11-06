export const ROLES: string[];
export function slugify(name: string): string;
export function generatePassword(): string;
export function createClinic(
  db: any,
  opts: { name?: string; slug?: string; email?: string; phone?: string; address?: string; timezone?: string },
): Promise<{ id: string; slug: string }>;
export function addManager(
  db: any,
  opts: { clinic?: string; email?: string; role?: string; password?: string; withPassword?: boolean },
  env?: { appUrl?: string },
): Promise<string>;
