import { redirect } from "next/navigation";

// proxy.ts sends logged-out visitors on to /login?next=/dashboard.
export default function HomePage() {
  redirect("/dashboard");
}
