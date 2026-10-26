"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Switch } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { formatSlot } from "@/lib/format";
import type { Doctor } from "@/lib/validation";
import { removeWaitlistPatient, setWaitlistActive } from "./actions";
import { PatientFormDialog, type WaitlistRow } from "./patient-form-dialog";

type ActiveFilter = "all" | "active" | "inactive";

const SOURCE_LABELS: Record<string, string> = {
  receptionist: "Reception",
  sms_link: "Sign-up link",
  online: "Online",
  pms: "Dentally",
};

function summary(values: string[], empty = "Any"): string {
  return values.length ? values.join(", ") : empty;
}

export function WaitlistView({ rows, doctors, timezone }: { rows: WaitlistRow[]; doctors: Doctor[]; timezone: string }) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<ActiveFilter>("all");
  const [editing, setEditing] = React.useState<WaitlistRow | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<WaitlistRow | null>(null);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "active" && !r.is_active) return false;
      if (filter === "inactive" && r.is_active) return false;
      if (!q) return true;
      return [r.patient_name, r.email ?? "", r.phone ?? ""].some((s) => s.toLowerCase().includes(q));
    });
  }, [rows, query, filter]);

  function openForm(row: WaitlistRow | null) {
    setEditing(row);
    setFormOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Waitlist"
        description="Patients who want an earlier appointment."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add patient
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="waitlist-search" className="sr-only">
            Search by name, phone or email
          </label>
          <Input
            id="waitlist-search"
            type="search"
            placeholder="Search by name, phone or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="waitlist-filter" className="sr-only">
            Show
          </label>
          <NativeSelect id="waitlist-filter" value={filter} onChange={(e) => setFilter(e.target.value as ActiveFilter)}>
            <option value="all">All patients</option>
            <option value="active">Active only</option>
            <option value="inactive">Paused only</option>
          </NativeSelect>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No one is on the waitlist yet."
          description="Add a patient, or share the sign-up link from Settings so patients can join themselves."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="No patients match your search." />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <tr className="border-b">
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Treatments</TableHead>
                <TableHead>Dentist</TableHead>
                <TableHead>Days / times</TableHead>
                <TableHead>Notice</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Last contacted</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <PatientRow
                  key={row.id}
                  row={row}
                  timezone={timezone}
                  onEdit={() => openForm(row)}
                  onRemove={() => setRemoving(row)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PatientFormDialog open={formOpen} onOpenChange={setFormOpen} patient={editing} doctors={doctors} />
      <RemoveDialog row={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function PatientRow({
  row,
  timezone,
  onEdit,
  onRemove,
}: {
  row: WaitlistRow;
  timezone: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setWaitlistActive(row.id, next);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <TableRow className={row.is_active ? undefined : "text-muted-foreground"}>
      <TableCell className="font-medium">
        <Link href={`/crm/patient/${row.id}`} className="text-link underline-offset-4 hover:underline">
          {row.patient_name}
        </Link>
        {row.existing_patient ? <span className="ml-2 text-xs font-normal text-muted-foreground">Existing patient</span> : null}
        {row.sms_opt_out ? (
          <Badge tone="warning" className="ml-2">
            Opted out of SMS
          </Badge>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs font-normal text-destructive">
            {error}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        <div>{row.phone ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{row.email ?? "—"}</div>
      </TableCell>
      <TableCell>{summary(row.preferred_procedures)}</TableCell>
      <TableCell>{summary(row.preferred_doctors)}</TableCell>
      <TableCell>
        <div>{summary(row.preferred_days.map((d) => d.slice(0, 3)))}</div>
        <div className="text-xs text-muted-foreground">{summary(row.preferred_times)}</div>
      </TableCell>
      <TableCell>{row.max_notice_hours === 0 ? "Same day" : `${row.max_notice_hours} h`}</TableCell>
      <TableCell>{SOURCE_LABELS[row.opt_in_source] ?? row.opt_in_source}</TableCell>
      <TableCell>{row.last_contacted_at ? formatSlot(row.last_contacted_at, timezone) : "Never"}</TableCell>
      <TableCell>
        <Switch
          checked={row.is_active}
          disabled={pending}
          onCheckedChange={toggle}
          aria-label={`${row.patient_name} is ${row.is_active ? "active" : "paused"}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${row.patient_name}`}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${row.patient_name}`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function RemoveDialog({ row, onClose }: { row: WaitlistRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {row ? (
        <DialogContent title={`Remove ${row.patient_name}?`}>
          <RemoveForm key={row.id} row={row} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function RemoveForm({ row, onClose }: { row: WaitlistRow; onClose: () => void }) {
  const [state, formAction] = useActionState(removeWaitlistPatient, null);

  React.useEffect(() => {
    if (state?.message) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row.id} />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <p className="text-sm text-muted-foreground">
        This permanently deletes the patient (use for erasure requests). Their recovered slots keep their revenue.
        To stop contacting them without deleting, switch them to paused instead.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Keep patient
        </Button>
        <SubmitButton variant="destructive" pendingText="Removing…">
          Remove permanently
        </SubmitButton>
      </div>
    </form>
  );
}
