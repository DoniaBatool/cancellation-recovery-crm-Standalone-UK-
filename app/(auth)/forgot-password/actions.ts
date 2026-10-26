"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import type { FormState } from "@/lib/form-state";
import { fieldErrors, formDataToObject, forgotPasswordSchema } from "@/lib/validation";

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const redirectTo = `${getAppUrl()}/auth/confirm?next=${encodeURIComponent("/set-password")}`;

  // The result is ignored on purpose: the same reply is shown whether or not the
  // email has an account, so this page can't be used to find out who has one.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });

  return { message: "If that email has an account, we've sent a link to reset the password. Check your inbox." };
}
