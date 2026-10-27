import type { Metadata } from "next";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyField } from "@/components/ui/copy-field";
import { PageHeader } from "@/components/shell/page-header";
import { getAppUrl } from "@/lib/env";
import { readDoctors } from "@/lib/doctors";
import { getDentallyClient } from "@/lib/engine/runtime";
import { ImportDoctors } from "./import-doctors";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canEditSettings } from "@/lib/team-permissions";
import { joinUrl } from "@/lib/waitlist-qr";
import { Alert } from "@/components/ui/alert";
import { SettingsForm, type ConfigValues } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

const INTEGRATIONS = [
  { name: "Dentally", note: "Read-only connection arrives in Phase 5." },
  { name: "SMS (Twilio)", note: "Arrives in Phase 3." },
  { name: "Email", note: "Arrives in Phase 3." },
  { name: "Slack", note: "Arrives in Phase 3." },
];

export default async function SettingsPage() {
  const { clinic, role } = await requireSession();
  const supabase = await createSupabaseServerClient();

  const [{ data: config }, { data: clinicRow }] = await Promise.all([
    supabase.from("clinic_config").select("*").eq("clinic_id", clinic.id).maybeSingle(),
    supabase.from("clinics").select("contact_email").eq("id", clinic.id).maybeSingle(),
  ]);

  if (!config) {
    return (
      <>
        <PageHeader title="Settings" />
        <Alert tone="error">This clinic has no settings row yet. Please contact support.</Alert>
      </>
    );
  }

  const values: ConfigValues = {
    contact_email: clinicRow?.contact_email ?? "",
    prices: {
      cleaning: config.price_cleaning,
      consultation: config.price_consultation,
      filling: config.price_filling,
      extraction: config.price_extraction,
      crown: config.price_crown,
      implant: config.price_implant,
      whitening: config.price_whitening,
      default: config.price_default,
    },
    doctors: readDoctors(config.doctors),
    engine_enabled: config.engine_enabled,
    shadow_mode: config.shadow_mode,
    slack_enabled: config.slack_enabled,
    offer_channels: config.offer_channels,
    offer_expiry_minutes: config.offer_expiry_minutes,
    offer_strategy: config.offer_strategy,
    batch_size: config.batch_size,
    max_offers_per_slot: config.max_offers_per_slot,
    min_lead_minutes: config.min_lead_minutes,
    max_horizon_hours: config.max_horizon_hours,
    approval_window_minutes: config.approval_window_minutes,
    quiet_hours_start: config.quiet_hours_start.slice(0, 5),
    quiet_hours_end: config.quiet_hours_end.slice(0, 5),
  };

  const link = joinUrl(getAppUrl(), clinic.slug);
  const dentallyConnected = getDentallyClient() !== null;

  return (
    <>
      <PageHeader title="Settings" description={`Prices, dentists and how offers are sent for ${clinic.name}.`} />

      <div className="flex flex-col gap-6">
        <SettingsForm values={values} canEdit={canEditSettings(role)} />

        {dentallyConnected && canEditSettings(role) ? (
          <Card>
            <CardHeader>
              <CardTitle>Dentists from Dentally</CardTitle>
              <CardDescription>Adds any dentist that is in Dentally but not in the list above. Existing names and emails are kept.</CardDescription>
            </CardHeader>
            <CardContent>
              <ImportDoctors />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Waitlist sign-up link</CardTitle>
            <CardDescription>Share it by text, on your website, or print the QR card for reception.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CopyField value={link} label="Sign-up link" />
            <div className="flex flex-wrap items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated PNG, no optimisation needed */}
              <img
                src="/crm/config/qr"
                alt={`QR code that opens ${link}`}
                width={160}
                height={160}
                className="rounded-md border bg-white"
              />
              <div className="flex flex-col gap-2">
                <Button asChild variant="outline">
                  <a href="/crm/config/qr?download=1">
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download QR (PNG)
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/crm/config/qr-card" target="_blank" rel="noopener">
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    Print QR card
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Connections are added in later phases.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {INTEGRATIONS.map((i) => (
                <li key={i.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium">{i.name}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {i.note}
                    <Badge>Not set up</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
