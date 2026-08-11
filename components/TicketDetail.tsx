"use client";

import type { Ticket } from "@/lib/types";
import {
  formatDateTime,
  priorityClass,
  statusClass,
} from "@/lib/utils";

interface TicketDetailProps {
  ticket: Ticket | null;
  onClose?: () => void;
  showClose?: boolean;
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

export default function TicketDetail({
  ticket,
  onClose,
  showClose = false,
}: TicketDetailProps) {
  if (!ticket) {
    return (
      <section className="flex h-full items-center justify-center bg-surface-muted px-6">
        <div className="max-w-sm text-center">
          <h2 className="text-base font-semibold text-foreground">
            Select a ticket
          </h2>
          <p className="mt-2 text-sm text-muted">
            Choose a ticket from the inbox to view creator details, issue
            context, and activity history.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs font-medium text-accent">
              {ticket.ticketNumber}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              {ticket.creatorName}
            </h2>
            <p className="mt-1 text-sm text-muted">{ticket.issueType}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityClass(ticket.priority)}`}
            >
              {ticket.priority}
            </span>
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass(ticket.status)}`}
            >
              {ticket.status}
            </span>
            {showClose && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted hover:bg-surface-muted lg:hidden"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailField label="Ticket ID" value={ticket.ticketNumber} />
          <DetailField label="Creator Name" value={ticket.creatorName} />
          <DetailField label="Phone" value={ticket.phone} />
          <DetailField label="Email" value={ticket.email} />
          <DetailField label="Social Handle" value={ticket.socialHandle} />
          <DetailField label="Platform" value={ticket.platform} />
          <DetailField label="Issue Type" value={ticket.issueType} />
          <DetailField label="Campaign Name" value={ticket.campaignName} />
          <DetailField label="Brand" value={ticket.brand} />
          <DetailField label="Campaign Month" value={ticket.campaignMonth} />
          <DetailField label="Cloutflow POC" value={ticket.cloutflowPoc} />
          <DetailField
            label="Cloutflow POC Contact Number"
            value={ticket.cloutflowPocContactNumber}
          />
          <DetailField label="Source Channel" value={ticket.sourceChannel} />
          <DetailField label="Status" value={ticket.status} />
          <DetailField label="Priority" value={ticket.priority} />
          <DetailField label="Assigned Team" value={ticket.assignedTeam} />
          <DetailField
            label="Assigned Executive"
            value={ticket.assignedExecutive}
          />
          <DetailField
            label="Created Date"
            value={formatDateTime(ticket.createdAt)}
          />
          <DetailField
            label="Last Updated"
            value={formatDateTime(ticket.updatedAt)}
          />
        </dl>

        <div className="mt-6 rounded-lg border border-border bg-surface-muted p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Issue Description
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            {ticket.issueDescription}
          </p>
        </div>

        {ticket.internalCallNotes ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Internal Call Notes
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {ticket.internalCallNotes}
            </p>
          </div>
        ) : null}

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-foreground">
            Activity Timeline
          </h3>
          <ol className="mt-4 space-y-4">
            {ticket.activity.map((event, index) => (
              <li key={event.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
                  {index < ticket.activity.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-border" />
                  ) : null}
                </div>
                <div className="pb-2">
                  <p className="text-sm text-foreground">{event.action}</p>
                  <p className="mt-1 text-xs text-muted">
                    {event.actor} · {formatDateTime(event.timestamp)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
