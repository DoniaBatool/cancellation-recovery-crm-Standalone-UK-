#!/usr/bin/env node
// Manual clinic onboarding (run on your Mac; needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local,
// pointing at the clinic's OWN Supabase project).
//
//   pnpm clinic:create --name "Smile Dental, London" --email reception@smile.co.uk [--phone ..] [--address ..] [--slug ..]
//   pnpm clinic:add-manager --clinic smile-dental-london --email pm@smile.co.uk [--role staff|admin|owner] [--with-password | --password ..]
//
// Most clinics are set up with `pnpm clinic:setup` (it does this for you). Use these two to add a clinic or a login by hand.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { addManager, createClinic } from "./lib/clinic-admin.mjs";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function getDb() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    address: { type: "string" },
    timezone: { type: "string" },
    clinic: { type: "string" },
    password: { type: "string" },
    "with-password": { type: "boolean" },
    role: { type: "string" },
  },
});

try {
  if (command === "create") {
    const clinic = await createClinic(getDb(), values);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "<APP_URL>";
    console.log(`✓ Clinic created\n  id:   ${clinic.id}\n  slug: ${clinic.slug}\n  sign-up link: ${appUrl.replace(/\/+$/, "")}/join/${clinic.slug}`);
    console.log(`Next: pnpm clinic:add-manager --clinic ${clinic.slug} --email <practice manager email> --role owner`);
  } else if (command === "add-manager") {
    const result = await addManager(getDb(), { ...values, withPassword: values["with-password"] }, { appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000" });
    console.log(`✓ ${result}`);
  } else {
    fail("usage: clinic-admin.mjs <create|add-manager> [options] (see the header of scripts/clinic-admin.mjs)");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
