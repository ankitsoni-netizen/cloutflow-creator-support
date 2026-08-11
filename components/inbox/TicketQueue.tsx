"use client";

import TicketQueueItem from "@/components/inbox/TicketQueueItem";
import EmptyState from "@/components/ui/EmptyState";
import {
  FilterIcon,
  PlusIcon,
  RefreshIcon,
  SortIcon,
} from "@/components/ui/Icons";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import type { InboxView, Ticket } from "@/lib/types";

const VIEWS: { id: InboxView; label: string }[] = [
  { id: "all-active", label: "All Active" },
  { id: "my-tickets", label: "My Tickets" },
  { id: "unassigned", label: "Unassigned" },
  { id: "open", label: "Open" },
  { id: "in-progress", label: "In Progress" },
  { id: "waiting", label: "Waiting" },
  { id: "urgent", label: "Urgent" },
  { id: "pending-reply", label: "Pending Reply" },
  { id: "resolved", label: "Resolved" },
];

interface TicketQueueProps {
  title: string;
  tickets: Ticket[];
  viewCounts: Record<InboxView, number>;
  activeView: InboxView;
  selectedId: string | null;
  localSearch: string;
  onLocalSearchChange: (value: string) => void;
  onViewChange: (view: InboxView) => void;
  onSelectTicket: (id: string) => void;
  onNewTicket: () => void;
  onRefresh: () => void;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  hasTickets?: boolean;
  pendingReplyIds?: Set<string>;
  sortLabel?: string;
}

export default function TicketQueue({
  title,
  tickets,
  viewCounts,
  activeView,
  selectedId,
  localSearch,
  onLocalSearchChange,
  onViewChange,
  onSelectTicket,
  onNewTicket,
  onRefresh,
  loading = false,
  refreshing = false,
  error = null,
  hasTickets = true,
  pendingReplyIds,
  sortLabel = "Updated · Newest",
}: TicketQueueProps) {
  return (
    <section className="flex h-full min-h-0 flex-col border-r border-border bg-surface">
      <div className="shrink-0 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="mt-0.5 text-xs text-muted tabular-nums">
              {loading
                ? "Loading tickets..."
                : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
              {refreshing ? " · Refreshing" : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh tickets"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-60"
            >
              <RefreshIcon
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onNewTicket}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Saved ticket views"
          className="mt-3 flex gap-1 overflow-x-auto pb-1"
        >
          {VIEWS.map((view) => {
            const active = activeView === view.id;
            const count = viewCounts[view.id] ?? 0;
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onViewChange(view.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "bg-surface-muted text-muted hover:bg-accent-soft hover:text-accent"
                }`}
              >
                {view.label}
                <span
                  className={`rounded px-1 py-0.5 text-[10px] tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-surface text-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <label className="sr-only" htmlFor="queue-search">
            Filter tickets in current view
          </label>
          <input
            id="queue-search"
            type="search"
            value={localSearch}
            onChange={(e) => onLocalSearchChange(e.target.value)}
            placeholder="Filter this view..."
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled
            title="Advanced filters coming soon"
            aria-label="Advanced filters (not configured)"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted"
          >
            <FilterIcon className="h-3.5 w-3.5" />
            Filter
          </button>
          <button
            type="button"
            disabled
            title={sortLabel}
            aria-label={`Sort: ${sortLabel}`}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted"
          >
            <SortIcon className="h-3.5 w-3.5" />
            Sort
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <LoadingSkeleton rows={8} />
        ) : error ? (
          <EmptyState
            title="Unable to load tickets"
            description={error}
            action={
              <button
                type="button"
                onClick={onRefresh}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Retry
              </button>
            }
          />
        ) : tickets.length === 0 ? (
          <EmptyState
            title={!hasTickets ? "Inbox is empty" : "No matching tickets"}
            description={
              !hasTickets
                ? "Create a ticket to start the Creator Support queue."
                : activeView === "pending-reply"
                  ? "No creator replies are currently queued as pending delivery."
                  : "Try another view or clear your search filters."
            }
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {tickets.map((ticket) => (
              <TicketQueueItem
                key={ticket.id}
                ticket={ticket}
                selected={ticket.id === selectedId}
                onSelect={() => onSelectTicket(ticket.id)}
                pendingDelivery={pendingReplyIds?.has(ticket.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
