"use client";

import type { TicketStatus } from "@/lib/types";

const ACTIVE_STATUSES: Exclude<TicketStatus, "Resolved">[] = [
  "Open",
  "In Progress",
  "Waiting",
];

interface StatusControlProps {
  status: TicketStatus;
  saving: boolean;
  error: string | null;
  onChange: (status: Exclude<TicketStatus, "Resolved">) => void;
}

export default function StatusControl({
  status,
  saving,
  error,
  onChange,
}: StatusControlProps) {
  const isResolved = status === "Resolved";

  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted uppercase">
        Status
      </span>
      <select
        value={isResolved ? "Resolved" : status}
        disabled={saving || isResolved}
        aria-busy={saving}
        aria-disabled={saving || isResolved}
        onChange={(e) => {
          onChange(e.target.value as Exclude<TicketStatus, "Resolved">);
        }}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-70"
      >
        {ACTIVE_STATUSES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
        {isResolved ? <option value="Resolved">Resolved</option> : null}
      </select>
      {saving ? (
        <span className="mt-1 block text-[11px] text-muted">Saving status...</span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-[11px] text-[var(--danger)]">{error}</span>
      ) : null}
      {isResolved ? (
        <span className="mt-1 block text-[11px] text-muted">
          Use reopen workflows later to change a resolved ticket.
        </span>
      ) : null}
    </label>
  );
}
