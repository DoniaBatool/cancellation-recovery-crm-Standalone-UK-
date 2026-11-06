// Manual clinic onboarding helpers behind `pnpm clinic:create` and `pnpm clinic:add-manager`.
// Pure of process/file access: the database client is passed in, so it is unit tested.
// Ported from PORT_REPORTS_AND_CLINIC_SETUP.md (Part B), adapted to this project's tables.

import { randomBytes } from "node:crypto";

export const ROLES = ["staff", "admin", "owner"];

/** "Smile Dental, London" -> "smile-dental-london" */
export function slugify(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function generatePassword() {
  return randomBytes(12).toString("base64url");
}

/** Inserts the clinic and its default settings row (engine OFF, shadow mode ON by the table defaults). Returns { id, slug }. */
export async function createClinic(db, opts) {
  if (!opts.name || !String(opts.name).trim()) throw new Error("--name is required");
  const slug = opts.slug ? String(opts.slug) : slugify(opts.name);
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new Error(`slug "${slug}" must be lowercase letters, digits and dashes only (pass --slug)`);

  const { data: clinic, error } = await db
    .from("clinics")
    .insert({
      name: String(opts.name).trim(),
      slug,
      contact_email: opts.email ?? null,
      contact_phone: opts.phone ?? null,
      address: opts.address ?? null,
      timezone: opts.timezone ?? "Europe/London",
    })
    .select("id, slug")
    .single();
  if (error || !clinic) {
    throw new Error(error?.code === "23505" ? `slug "${slug}" already exists (pass --slug)` : `Could not create the clinic: ${error?.message ?? "unknown error"}`);
  }

  const { error: configError } = await db.from("clinic_config").insert({ clinic_id: clinic.id });
  if (configError) {
    await db.from("clinics").delete().eq("id", clinic.id);
    throw new Error(`Could not create the clinic settings: ${configError.message}`);
  }
  return clinic;
}

async function findUserIdByEmail(db, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Links (or invites) a login to a clinic. Returns a human-readable result line.
 *   default         -> emails an invite; they choose their own password
 *   withPassword    -> no email; prints a one-time password to share privately
 *   existing login  -> just linked to this clinic, nothing sent
 */
export async function addManager(db, opts, { appUrl = "http://localhost:3000" } = {}) {
  if (!opts.clinic || !opts.email) throw new Error("--clinic <slug> and --email are required");
  const email = String(opts.email).trim().toLowerCase();
  const role = opts.role ?? "staff";
  if (!ROLES.includes(role)) throw new Error("--role must be staff, admin or owner (one owner per clinic)");

  const { data: clinic, error } = await db.from("clinics").select("id, name").eq("slug", opts.clinic).maybeSingle();
  if (error) throw new Error(error.message);
  if (!clinic) throw new Error(`no clinic with slug "${opts.clinic}"`);

  let userId = await findUserIdByEmail(db, email);
  let message = "existing login, linked, nothing sent";
  if (!userId && (opts.password || opts.withPassword)) {
    const password = opts.password ?? generatePassword();
    const { data, error: createError } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(createError.message);
    userId = data.user.id;
    message = `one-time password: ${password}\n  (share it privately and ask them to change it via "Forgot password?")`;
  } else if (!userId) {
    const base = appUrl.replace(/\/+$/, "");
    const { data, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${base}/auth/confirm?next=/set-password` });
    if (inviteError) throw new Error(`${inviteError.message}. Check the Supabase Auth SMTP settings, or use --with-password`);
    userId = data.user.id;
    message = "invite email sent: they click the link and choose a password";
  }

  const { error: linkError } = await db.from("clinic_users").upsert({ user_id: userId, clinic_id: clinic.id, role }, { onConflict: "user_id,clinic_id" });
  if (linkError) {
    throw new Error(
      linkError.code === "23505" ? `${clinic.name} already has an owner. Use --role admin or --role staff.` : `Could not link the login: ${linkError.message}`,
    );
  }
  return `${email} -> ${clinic.name} (${role})\n  ${message}`;
}
