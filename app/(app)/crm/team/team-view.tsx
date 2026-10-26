"use client";

import * as React from "react";
import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Role } from "@/lib/constants";
import type { FormState } from "@/lib/form-state";
import {
  ROLE_LABELS,
  canChangeRole,
  canRemove,
  canTransferOwnership,
  invitableRoles,
} from "@/lib/team-permissions";
import { changeMemberRole, inviteMember, removeMember, transferOwnership } from "./actions";

export type TeamMember = { userId: string; email: string; role: Role; joined: string; isYou: boolean };

type Confirm = { kind: "remove" | "transfer"; member: TeamMember } | null;

export function TeamView({ members, actor, actorId }: { members: TeamMember[]; actor: Role; actorId: string }) {
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const roles = invitableRoles(actor);

  return (
    <div className="flex flex-col gap-6">
      {roles.length > 0 ? <InviteCard roles={roles} /> : null}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <tr className="border-b">
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                actor={actor}
                actorId={actorId}
                onRemove={() => setConfirm({ kind: "remove", member: m })}
                onTransfer={() => setConfirm({ kind: "transfer", member: m })}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function InviteCard({ roles }: { roles: Role[] }) {
  const [state, formAction] = useActionState(inviteMember, null);
  // Remount the form after a successful invite so the email field is empty again.
  const formKey = state?.message ?? "new";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a team member</CardTitle>
        <CardDescription>They get an email with a link to set their password.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form key={formKey} action={formAction} noValidate className="flex flex-col gap-4">
          {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
          {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_12rem_auto]">
            <Field id="invite-email" label="Email" error={state?.fieldErrors?.email}>
              {(aria) => <Input {...aria} name="email" type="email" inputMode="email" autoComplete="off" required />}
            </Field>
            <Field id="invite-role" label="Role" error={state?.fieldErrors?.role}>
              {(aria) => (
                <NativeSelect {...aria} name="role" defaultValue={roles[roles.length - 1]}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <SubmitButton pendingText="Sending…">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Send invite
            </SubmitButton>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member,
  actor,
  actorId,
  onRemove,
  onTransfer,
}: {
  member: TeamMember;
  actor: Role;
  actorId: string;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  const asMember = { userId: member.userId, role: member.role };
  const mayChange = canChangeRole(actor, asMember, "admin");
  const mayRemove = canRemove(actor, actorId, asMember);
  const mayTransfer = canTransferOwnership(actor, actorId, asMember);

  return (
    <TableRow>
      <TableCell className="font-medium">
        {member.email}
        {member.isYou ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
      </TableCell>
      <TableCell>{mayChange ? <RoleSelect member={member} /> : <Badge tone={member.role === "owner" ? "info" : "neutral"}>{ROLE_LABELS[member.role]}</Badge>}</TableCell>
      <TableCell>{member.joined}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          {mayTransfer ? (
            <Button variant="outline" size="sm" onClick={onTransfer}>
              Make owner
            </Button>
          ) : null}
          {mayRemove ? (
            <Button variant="outline" size="sm" onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RoleSelect({ member }: { member: TeamMember }) {
  const [state, formAction] = useActionState(changeMemberRole, null);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <Form ref={formRef} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="user_id" value={member.userId} />
      <NativeSelect
        name="role"
        aria-label={`Role for ${member.email}`}
        defaultValue={member.role}
        className="h-9 w-32"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="admin">Admin</option>
        <option value="staff">Staff</option>
      </NativeSelect>
      {state?.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </Form>
  );
}

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm; onClose: () => void }) {
  return (
    <Dialog open={confirm !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {confirm ? (
        <DialogContent title={confirm.kind === "remove" ? `Remove ${confirm.member.email}?` : `Make ${confirm.member.email} the owner?`}>
          <ConfirmForm key={`${confirm.kind}-${confirm.member.userId}`} confirm={confirm} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function ConfirmForm({ confirm, onClose }: { confirm: NonNullable<Confirm>; onClose: () => void }) {
  const action: (prev: FormState, data: FormData) => Promise<FormState> =
    confirm.kind === "remove" ? removeMember : transferOwnership;
  const [state, formAction] = useActionState(action, null);

  React.useEffect(() => {
    if (state?.message) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="user_id" value={confirm.member.userId} />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <p className="text-sm text-muted-foreground">
        {confirm.kind === "remove"
          ? "They will lose access to this clinic straight away. Their login is not deleted."
          : "You will become an admin. There can only be one owner, and only the owner can change roles or hand over ownership."}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton variant={confirm.kind === "remove" ? "destructive" : "default"} pendingText="Working…">
          {confirm.kind === "remove" ? "Remove member" : "Transfer ownership"}
        </SubmitButton>
      </div>
    </form>
  );
}
