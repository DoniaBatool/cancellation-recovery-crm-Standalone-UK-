import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { loadSupabasePublicConfig, readProcessEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/validation";
import type { Database } from "@/lib/database.types";

// Next 16 "proxy" (the old middleware). Source: SYSTEM_BUILD_GUIDE.md §9.
//  - refreshes the Supabase session on every request (auth.getClaims())
//  - redirects logged-out users from /crm* and /dashboard* to /login?next=...
//  - redirects logged-in users away from /login

const PROTECTED_PREFIXES = ["/crm", "/dashboard"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { url, publishableKey } = loadSupabasePublicConfig(readProcessEnv());

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (target: URL) => {
    const redirectResponse = NextResponse.redirect(target);
    // Keep any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
    return redirectResponse;
  };

  if (!signedIn && isProtected(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(loginUrl);
  }

  if (signedIn && pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
    target.search = "";
    return redirectTo(target);
  }

  return response;
}

export const config = {
  // Excludes api/, confirm/, join/ and static assets (guide §9).
  matcher: [
    "/((?!api/|confirm/|join/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
