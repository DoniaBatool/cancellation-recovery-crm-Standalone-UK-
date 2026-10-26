import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/lib/auth-actions";
import { getSessionContext, requireAuthUser } from "@/lib/session";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  await requireAuthUser();
  // Linked after all (for example, just invited)? Go straight in.
  if (await getSessionContext()) redirect("/dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle>No access yet</CardTitle>
        <CardDescription>Your login isn't linked to a clinic yet.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Ask the clinic owner to add you from the Team page, then sign in again.
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
