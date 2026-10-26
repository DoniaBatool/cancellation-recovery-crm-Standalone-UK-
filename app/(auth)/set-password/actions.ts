"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthUser } from "@/lib/session";
import type { FormState } from "@/lib/form-state";
import { fieldErrors, formDataToObject, setPasswordSchema } from "@/lib/validation";

export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Only someone who arrived through a valid reset / invite link has a session here.
  await requireAuthUser();

  const parsed = setPasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "We couldn't save that password. Please try again, or request a new link." };

  redirect("/dashboard");
}
