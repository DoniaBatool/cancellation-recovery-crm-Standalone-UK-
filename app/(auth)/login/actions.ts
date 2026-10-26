"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";
import { fieldErrors, formDataToObject, loginSchema, safeNextPath } from "@/lib/validation";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // One message for every failure: never reveal whether the email exists.
  if (error) return { error: "That email and password don't match. Please try again." };

  redirect(safeNextPath(parsed.data.next));
}
