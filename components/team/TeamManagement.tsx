"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import EmptyState from "@/components/ui/EmptyState";
import { MoreIcon } from "@/components/ui/Icons";
import { inviteStaffAction } from "@/lib/team/invite-action";
import { setStaffActiveAction } from "@/lib/team/set-staff-active-action";
import { updateStaffAction } from "@/lib/team/update-staff-action";
import {
  INVITE_ROLES,
  isAdminRole,
  inviteRoleLabel,
} from "@/lib/team/roles";
import type { StaffDirectoryMember, Ticket } from "@/lib/types";
import { getInitials } from "@/lib/utils";

interface TeamManagementProps {
  staff: StaffDirectoryMember[];
  tickets: Ticket[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onStaffChanged?: () => void;
  onOpenInbox: () => void;
  currentRole: string | null;
  currentUserId: string;
}

const EMPTY_INVITE_FORM = {
  name: "",
  email: "",
  role: "",
};

export default function TeamManagement({
  staff,
  tickets,
  loading = false,
  error = null,
  onRetry,
  onStaffChanged,
  onOpenInbox,
  currentRole,
  currentUserId,
}: TeamManagementProps) {
  const canManage = isAdminRole(currentRole);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE_FORM);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [menuUserId, setMenuUserId] = useState<string | null>(null);
  const [editMember, setEditMember] = useState<StaffDirectoryMember | null>(
    null,
  );
  const [editForm, setEditForm] = useState({ name: "", role: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    return staff.map((member) => {
      const assigned = tickets.filter(
        (ticket) =>
          ticket.assignedExecutiveId === member.userId ||
          ticket.assignedExecutive.toLowerCase() ===
            member.fullName.toLowerCase(),
      );
      return {
        member,
        assignedCount: assigned.length,
        openCount: assigned.filter((ticket) => ticket.status !== "Resolved")
          .length,
        resolvedCount: assigned.filter((ticket) => ticket.status === "Resolved")
          .length,
      };
    });
  }, [staff, tickets]);

  useEffect(() => {
    if (!menuUserId) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuUserId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuUserId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuUserId]);

  function closeInvite() {
    setInviteOpen(false);
    setInviteForm(EMPTY_INVITE_FORM);
    setInviteError(null);
    setInviteSuccess(null);
  }

  function openInvite() {
    setInviteForm(EMPTY_INVITE_FORM);
    setInviteError(null);
    setInviteSuccess(null);
    setInviteOpen(true);
  }

  function openEdit(member: StaffDirectoryMember) {
    setMenuUserId(null);
    setEditMember(member);
    setEditForm({
      name: member.fullName,
      role: (member.role ?? "").trim().toLowerCase(),
    });
    setEditError(null);
  }

  function closeEdit() {
    setEditMember(null);
    setEditForm({ name: "", role: "" });
    setEditError(null);
  }

  function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);

    startTransition(async () => {
      const result = await inviteStaffAction({
        name: inviteForm.name,
        email: inviteForm.email,
        role: inviteForm.role,
      });

      if (!result.ok) {
        setInviteError(result.error);
        return;
      }

      setInviteSuccess(
        `Invite sent to ${result.member.fullName}. They will receive a welcome email with login credentials.`,
      );
      setInviteForm(EMPTY_INVITE_FORM);
      onStaffChanged?.();
    });
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editMember) return;
    setEditError(null);

    startTransition(async () => {
      const result = await updateStaffAction({
        userId: editMember.userId,
        name: editForm.name,
        role: editForm.role,
      });

      if (!result.ok) {
        setEditError(result.error);
        return;
      }

      closeEdit();
      onStaffChanged?.();
    });
  }

  function handleToggleActive(member: StaffDirectoryMember) {
    setMenuUserId(null);
    setActionError(null);

    const nextActive = !member.isActive;
    const label = nextActive ? "enable" : "disable";
    const confirmed = window.confirm(
      `Are you sure you want to ${label} ${member.fullName}?`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await setStaffActiveAction({
        userId: member.userId,
        isActive: nextActive,
      });

      if (!result.ok) {
        setActionError(result.error);
        return;
      }

      onStaffChanged?.();
    });
  }

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Team</h1>
            <p className="mt-1 text-sm text-muted">
              Staff directory from live `staff_profiles`. Ticket counts are
              derived from current loaded tickets.
            </p>
            <p className="mt-1 text-xs text-muted">
              Your role: {currentRole || "Not provided"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage ? (
              <button
                type="button"
                onClick={openInvite}
                className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-surface"
              >
                Invite User
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenInbox}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Open Inbox
            </button>
          </div>
        </div>

        {actionError ? (
          <p className="mt-4 text-sm text-[var(--danger)]" role="alert">
            {actionError}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-8 text-sm text-muted">Loading staff directory...</p>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-border bg-surface">
            <EmptyState
              title="Unable to load team"
              description={error}
              action={
                onRetry ? (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    Retry
                  </button>
                ) : null
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-8 rounded-lg border border-border bg-surface">
            <EmptyState
              title="No staff profiles"
              description="Active staff rows will appear here once available via RLS."
            />
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Staff</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium tabular-nums">Assigned</th>
                  <th className="px-4 py-3 font-medium tabular-nums">Open</th>
                  <th className="px-4 py-3 font-medium tabular-nums">Resolved</th>
                  {canManage ? (
                    <th className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(
                  ({ member, assignedCount, openCount, resolvedCount }) => {
                    const isSelf = member.userId === currentUserId;
                    const menuOpen = menuUserId === member.userId;

                    return (
                      <tr key={member.userId}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                              {getInitials(member.fullName)}
                            </span>
                            <span className="font-medium text-foreground">
                              {member.fullName}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {inviteRoleLabel(member.role)}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {member.team || "Not provided"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                              member.isActive
                                ? "bg-[var(--success-soft)] text-[var(--success)]"
                                : "bg-surface-muted text-muted"
                            }`}
                          >
                            {member.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {assignedCount}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{openCount}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {resolvedCount}
                        </td>
                        {canManage ? (
                          <td className="px-4 py-3 text-right">
                            <div
                              className="relative inline-flex"
                              ref={menuOpen ? menuRef : undefined}
                            >
                              <button
                                type="button"
                                aria-label={`Actions for ${member.fullName}`}
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                disabled={isPending}
                                onClick={() =>
                                  setMenuUserId(
                                    menuOpen ? null : member.userId,
                                  )
                                }
                                className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-60"
                              >
                                <MoreIcon className="h-4 w-4" />
                              </button>
                              {menuOpen ? (
                                <div
                                  role="menu"
                                  className="absolute top-full right-0 z-20 mt-1 min-w-[9rem] rounded-md border border-border bg-surface py-1 shadow-[var(--shadow-md)]"
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
                                    onClick={() => openEdit(member)}
                                  >
                                    Edit
                                  </button>
                                  {!isSelf ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted ${
                                        member.isActive
                                          ? "text-[var(--danger)]"
                                          : "text-foreground"
                                      }`}
                                      onClick={() => handleToggleActive(member)}
                                    >
                                      {member.isActive ? "Disable" : "Enable"}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inviteOpen && canManage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <button
            type="button"
            aria-label="Close invite overlay"
            className="absolute inset-0"
            onClick={closeInvite}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-lg)]"
          >
            <h2
              id="invite-title"
              className="text-lg font-semibold text-foreground"
            >
              Invite User
            </h2>
            <p className="mt-2 text-sm text-muted">
              Create a Creator Support account and email login credentials to
              the invitee.
            </p>
            <form className="mt-4 space-y-3" onSubmit={handleInviteSubmit}>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Name</span>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={inviteForm.name}
                  onChange={(event) =>
                    setInviteForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Riya Sharma"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={inviteForm.email}
                  onChange={(event) =>
                    setInviteForm((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                  placeholder="colleague@cloutflow.com"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Role</span>
                <select
                  required
                  value={inviteForm.role}
                  onChange={(event) =>
                    setInviteForm((prev) => ({
                      ...prev,
                      role: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select role</option>
                  {INVITE_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>

              {inviteError ? (
                <p className="text-sm text-[var(--danger)]" role="alert">
                  {inviteError}
                </p>
              ) : null}
              {inviteSuccess ? (
                <p className="text-sm text-[var(--success)]" role="status">
                  {inviteSuccess}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeInvite}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {isPending ? "Sending invite..." : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editMember && canManage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <button
            type="button"
            aria-label="Close edit overlay"
            className="absolute inset-0"
            onClick={closeEdit}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-staff-title"
            className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-lg)]"
          >
            <h2
              id="edit-staff-title"
              className="text-lg font-semibold text-foreground"
            >
              Edit User
            </h2>
            <p className="mt-2 text-sm text-muted">
              Update the display name and role for this team member.
            </p>
            <form className="mt-4 space-y-3" onSubmit={handleEditSubmit}>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Name</span>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Role</span>
                <select
                  required
                  value={editForm.role}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      role: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select role</option>
                  {INVITE_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>

              {editError ? (
                <p className="text-sm text-[var(--danger)]" role="alert">
                  {editError}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {isPending ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
