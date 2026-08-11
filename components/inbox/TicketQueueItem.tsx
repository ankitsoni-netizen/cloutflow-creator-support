"use client";

import ChannelBadge from "@/components/ui/ChannelBadge";
import type { Ticket } from "@/lib/types";
import {
  formatCompactDateTime,
  getInitials,
  priorityClass,
  statusClass,
} from "@/lib/utils";

interface TicketQueueItemProps {
  ticket: Ticket;
  selected: boolean;
  onSelect: () => void;
  pendingDelivery?: boolean;
}

export default function TicketQueueItem({
  ticket,
  selected,
  onSelect,
  pendingDelivery = false,
}: TicketQueueItemProps) {
  const assignee = ticket.assignedExecutive.trim();
  const initials = getInitials(assignee || "?");

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`group w-full border-l-2 px-3 py-3 text-left transition-colors sm:px-4 ${
          selected
            ? "border-l-accent bg-accent-soft/70"
            : "border-l-transparent hover:bg-surface-muted"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] font-semibold tracking-tight text-accent tabular-nums">
                {ticket.ticketNumber}
              </span>
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${priorityClass(ticket.priority)}`}
              >
                {ticket.priority}
              </span>
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(ticket.status)}`}
              >
                {ticket.status}
              </span>
              {pendingDelivery ? (
                <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)] ring-1 ring-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[var(--warning-soft)]">
                  Pending delivery
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">
              {ticket.creatorName}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {ticket.issueType}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-[11px] text-muted tabular-nums">
              {formatCompactDateTime(ticket.updatedAt)}
            </span>
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted ring-1 ring-border"
              title={assignee || "Unassigned"}
              aria-label={assignee ? `Assigned to ${assignee}` : "Unassigned"}
            >
              {assignee ? initials : "—"}
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="truncate">
            <span className="text-foreground">{ticket.brand || "No brand"}</span>
            {ticket.campaignName ? ` · ${ticket.campaignName}` : null}
          </span>
          <ChannelBadge channel={ticket.sourceChannel} />
        </div>
      </button>
    </li>
  );
}
