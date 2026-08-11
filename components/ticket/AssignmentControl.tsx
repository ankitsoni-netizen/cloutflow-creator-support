"use client";

import type { StaffOption } from "@/lib/tickets/workflow-types";

interface AssignmentControlProps {
  assignedExecutiveId?: string | null;
  assignedExecutive: string;
  staffOptions: StaffOption[];
  saving: boolean;
  error: string | null;
  onChange: (assigneeUserId: string) => void;
}

export default function AssignmentControl({
  assignedExecutiveId,
  assignedExecutive,
  staffOptions,
  saving,
  error,
  onChange,
}: AssignmentControlProps) {
  const currentId = assignedExecutiveId ?? "";
  const historicalAssignee =
    currentId &&
    !staffOptions.some((option) => option.userId === currentId)
      ? {
          userId: currentId,
          fullName: assignedExecutive.trim() || "Former executive",
        }
      : null;

  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted uppercase">
        Assigned executive
      </span>
      <select
        value={currentId}
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option value="">Unassigned</option>
        {historicalAssignee ? (
          <option value={historicalAssignee.userId} disabled>
            {historicalAssignee.fullName} (inactive)
          </option>
        ) : null}
        {staffOptions.map((option) => (
          <option key={option.userId} value={option.userId}>
            {option.fullName}
            {option.team ? ` · ${option.team}` : ""}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] text-muted">
        Unassigned clears the executive only. The ticket stays with its assigned
        team.
      </span>
      {saving ? (
        <span className="mt-1 block text-[11px] text-muted">
          Saving assignment...
        </span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-[11px] text-[var(--danger)]" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
