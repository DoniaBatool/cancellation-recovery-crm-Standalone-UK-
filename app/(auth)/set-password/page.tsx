import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "@/app/(auth)/set-password/set-password-form";
import { requireAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "Set password" };

export default async function SetPasswordPage() {
  // No session (expired or direct visit) -> /login.
  await requireAuthUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a password</CardTitle>
        <CardDescription>You'll use it to sign in from now on.</CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}
