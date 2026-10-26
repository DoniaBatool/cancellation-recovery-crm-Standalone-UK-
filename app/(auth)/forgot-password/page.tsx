import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/app/(auth)/forgot-password/forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>Enter your email and we'll send you a link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ForgotPasswordForm />
        <Link href="/login" className="text-center text-sm text-link underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
