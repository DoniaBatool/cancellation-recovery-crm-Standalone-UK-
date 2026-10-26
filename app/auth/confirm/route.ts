import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation";

// Email links (password reset, team invite) land here. We exchange the token hash for a
// session, then send the person on to a same-origin `next` path (guide §9.1).
const OTP_TYPES: readonly EmailOtpType[] = ["recovery", "invite", "magiclink", "signup", "email", "email_change"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const failure = request.nextUrl.clone();
  failure.pathname = "/login";
  failure.search = "?notice=link_expired";

  if (!tokenHash || !type || !OTP_TYPES.includes(type)) return NextResponse.redirect(failure);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(failure);

  const success = request.nextUrl.clone();
  success.pathname = next;
  success.search = "";
  return NextResponse.redirect(success);
}
