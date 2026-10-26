"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import type { Doctor } from "@/lib/validation";

type Row = { key: number; id: string; name: string; email: string };

/** Edits the dentist list and posts it as one JSON field named `doctors`. */
export function DoctorsEditor({ initial, error }: { initial: Doctor[]; error?: string }) {
  const counter = React.useRef(initial.length);
  const [rows, setRows] = React.useState<Row[]>(() =>
    initial.map((d, i) => ({ key: i, id: d.id, name: d.name, email: d.email ?? "" })),
  );

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const json = JSON.stringify(
    rows
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({ id: r.id || undefined, name: r.name.trim(), email: r.email.trim() || undefined })),
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="doctors" value={json} />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No dentists added yet.</p> : null}
      {rows.map((row, index) => (
        <div key={row.key} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`doctor-name-${row.key}`} className="text-sm font-medium">
              Dentist {index + 1}
            </label>
            <Input
              id={`doctor-name-${row.key}`}
              placeholder="Dr Ali Khan"
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`doctor-email-${row.key}`} className="text-sm font-medium">
              Email (optional)
            </label>
            <Input
              id={`doctor-email-${row.key}`}
              type="email"
              placeholder="ali@clinic.co.uk"
              value={row.email}
              onChange={(e) => update(row.key, { email: e.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove dentist ${index + 1}`}
            onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            counter.current += 1;
            setRows((current) => [...current, { key: counter.current, id: "", name: "", email: "" }]);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add dentist
        </Button>
      </div>
    </div>
  );
}
