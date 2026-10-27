import { isValidToken } from "@/lib/offers";

// Short link used in SMS: /c/<token> -> /confirm/<token>. Saves about 20 characters per text.
// Only a well-formed token is passed on, so this can never redirect somewhere else.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const target = new URL(isValidToken(token) ? `/confirm/${token}` : "/confirm/invalid", request.url);
  return Response.redirect(target, 307);
}
