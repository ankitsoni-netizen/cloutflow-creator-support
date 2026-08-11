"use client";

import { useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import type { StaffDirectoryMember, Ticket } from "@/lib/types";
import { getInitials } from "@/lib/utils";

interface TeamManagementProps {
  staff: StaffDirectoryMember[];
  tickets: Ticket[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenInbox: () => void;
  currentRole: string | null;
}

const PREPARED_ROLES = [
  "Admin",
  "Supervisor",
  "CRM Executive",
  "Finance Operations",
  "Campaign Operations",
  "Read Only",
];

export default function TeamManagement({
  staff,
  tickets,
  loading = false,
  error = null,
  onRetry,
  onOpenInbox,
  currentRole,
}: TeamManagementProps) {
  const [inviteOpen, setInviteOpen] = useState(false);

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
              Your role: {currentRole || "Not provided"} · Prepared role labels
              for later: {PREPARED_ROLES.join(", ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-surface"
            >
              Invite User
            </button>
            <button
              type="button"
              onClick={onOpenInbox}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Open Inbox
            </button>
          </div>
        </div>

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
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ member, assignedCount, openCount, resolvedCount }) => (
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
                      {member.role || "Not provided"}
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
                    <td className="px-4 py-3 tabular-nums">{assignedCount}</td>
                    <td className="px-4 py-3 tabular-nums">{openCount}</td>
                    <td className="px-4 py-3 tabular-nums">{resolvedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <button
            type="button"
            aria-label="Close invite overlay"
            className="absolute inset-0"
            onClick={() => setInviteOpen(false)}
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
              Secure Supabase Admin invitation setup is required. Invitation
              submission stays disabled until a server-only invitation action
              exists. Admin credentials are never used in browser code.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Email</span>
                <input
                  type="email"
                  disabled
                  placeholder="colleague@cloutflow.com"
                  className="w-full rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Role</span>
                <select
                  disabled
                  className="w-full rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted"
                >
                  <option>Select role</option>
                  {PREPARED_ROLES.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Close
              </button>
              <button
                type="button"
                disabled
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white opacity-60"
              >
                Send invite (disabled)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
