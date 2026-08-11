"use client";

import type { StatusFilter, Ticket } from "@/lib/types";
import {
  formatRelativeTime,
  priorityClass,
  statusClass,
} from "@/lib/utils";

const FILTERS: StatusFilter[] = [
  "Open",
  "In Progress",
  "Waiting",
  "Resolved",
  "All",
];

interface TicketListProps {
  tickets: Ticket[];
  selectedId: string | null;
  search: string;
  statusFilter: StatusFilter;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onSelectTicket: (id: string) => void;
  onNewTicket: () => void;
  title?: string;
}

export default function TicketList({
  tickets,
  selectedId,
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onSelectTicket,
  onNewTicket,
  title = "Creator Support Inbox",
}: TicketListProps) {
  return (
    <section className="flex h-full min-h-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onNewTicket}
            className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            + New Ticket
          </button>
        </div>

        <div className="mt-4">
          <label className="sr-only" htmlFor="ticket-search">
            Search tickets
          </label>
          <input
            id="ticket-search"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by ticket, creator, brand, or issue"
            className="w-full rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = statusFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => onStatusFilterChange(filter)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "bg-surface-muted text-muted hover:bg-accent-soft hover:text-accent"
                }`}
              >
                {filter}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tickets.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted">
            No tickets match your current filters.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tickets.map((ticket) => {
              const selected = ticket.id === selectedId;
              return (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTicket(ticket.id)}
                    className={`w-full px-4 py-4 text-left transition-colors sm:px-5 ${
                      selected
                        ? "bg-accent-soft"
                        : "hover:bg-surface-muted"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-medium text-accent">
                            {ticket.ticketNumber}
                          </span>
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
                        </div>
                        <p className="mt-1.5 truncate text-sm font-semibold text-foreground">
                          {ticket.creatorName}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-muted">
                          {ticket.issueCategory}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted">
                        {formatRelativeTime(ticket.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>
                        Brand:{" "}
                        <span className="font-medium text-foreground">
                          {ticket.brand}
                        </span>
                      </span>
                      <span>
                        Source:{" "}
                        <span className="font-medium text-foreground">
                          {ticket.sourceChannel}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
