import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { safeNextPath } from "@/lib/validation";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  link_expired: "That link has expired or was already used. Request a new one below.",
  password_updated: "Your password has been updated. Please sign in.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; notice?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const rawNotice = Array.isArray(params.notice) ? params.notice[0] : params.notice;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use the email and password for your clinic account.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={safeNextPath(rawNext)} notice={rawNotice ? NOTICES[rawNotice] : undefined} />
      </CardContent>
    </Card>
  );
}
