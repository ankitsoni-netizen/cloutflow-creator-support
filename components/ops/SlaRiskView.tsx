"use client";

import EmptyState from "@/components/ui/EmptyState";
import { AGING_THRESHOLD_MS } from "@/lib/intelligence/command-centre";
import type { Ticket } from "@/lib/types";
import {
  formatCompactDateTime,
  isAgingUnresolved,
  priorityClass,
  statusClass,
  ticketAgeLabel,
} from "@/lib/utils";

interface SlaRiskViewProps {
  tickets: Ticket[];
  onOpenTicket: (ticketId: string) => void;
  onOpenInbox: () => void;
}

export default function SlaRiskView({
  tickets,
  onOpenTicket,
  onOpenInbox,
}: SlaRiskViewProps) {
  const agingHours = Math.round(AGING_THRESHOLD_MS / 3600000);
  const agingTickets = tickets
    .filter((ticket) => isAgingUnresolved(ticket))
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">SLA Risk</h1>
            <p className="mt-1 text-sm text-muted">
              Formal SLA rules are not configured. This view shows aging
              unresolved tickets as an operational attention signal only — not
              SLA breaches.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenInbox}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Open Inbox
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-sm text-muted">
          Setup required: business hours, priority targets and breach
          definitions. Until then, aging threshold is {agingHours} hours from
          ticket creation.
        </div>

        <div className="mt-5 rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Aging unresolved tickets
            </h2>
            <span className="text-xs text-muted tabular-nums">
              {agingTickets.length}
            </span>
          </div>
          {agingTickets.length === 0 ? (
            <EmptyState
              compact
              title="No aging unresolved tickets"
              description={`No open tickets are older than ${agingHours} hours.`}
            />
          ) : (
            <ul className="divide-y divide-border">
              {agingTickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTicket(ticket.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold text-accent">
                          {ticket.ticketNumber}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${priorityClass(ticket.priority)}`}
                        >
                          {ticket.priority}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(ticket.status)}`}
                        >
                          {ticket.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {ticket.creatorName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {ticket.issueType}
                        {ticket.brand ? ` · ${ticket.brand}` : ""}
                        {ticket.assignedExecutive
                          ? ` · ${ticket.assignedExecutive}`
                          : " · Unassigned"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium text-[var(--warning)] tabular-nums">
                        {ticketAgeLabel(ticket.createdAt)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted tabular-nums">
                        Updated {formatCompactDateTime(ticket.updatedAt)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
