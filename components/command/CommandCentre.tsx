"use client";

import ChannelBadge from "@/components/ui/ChannelBadge";
import EmptyState from "@/components/ui/EmptyState";
import {
  AGING_THRESHOLD_MS,
  buildNeedsAttentionQueue,
  countByStatus,
  distribution,
  executiveWorkload,
} from "@/lib/intelligence/command-centre";
import type { Ticket } from "@/lib/types";
import {
  formatCompactDateTime,
  formatDateTime,
  priorityClass,
  statusClass,
  ticketAgeLabel,
} from "@/lib/utils";

interface CommandCentreProps {
  tickets: Ticket[];
  pendingReplyIds: Set<string>;
  staffName: string;
  onOpenInbox: () => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenView: (
    view:
      | "unassigned"
      | "waiting"
      | "urgent"
      | "pending-reply"
      | "resolved"
      | "sla-risk",
  ) => void;
}

function StatCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-foreground tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border border-border bg-surface px-4 py-4 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4">
      {content}
    </div>
  );
}

function MiniBar({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Insufficient data.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.slice(0, 6).map((row) => (
            <li key={row.label}>
              <div className="mb-1 flex justify-between gap-2 text-xs">
                <span className="truncate text-muted">{row.label}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {row.value}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CommandCentre({
  tickets,
  pendingReplyIds,
  staffName,
  onOpenInbox,
  onOpenTicket,
  onOpenView,
}: CommandCentreProps) {
  const counts = countByStatus(tickets);
  const attention = buildNeedsAttentionQueue(tickets, pendingReplyIds);
  const workload = executiveWorkload(tickets);
  const byIssue = distribution(tickets, (ticket) => ticket.issueType);
  const byChannel = distribution(tickets, (ticket) => ticket.sourceChannel);
  const oldestUnresolved = [...tickets]
    .filter((ticket) => ticket.status !== "Resolved")
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .slice(0, 6);
  const recentlyResolved = [...tickets]
    .filter((ticket) => ticket.status === "Resolved")
    .sort((a, b) => {
      const aTime = new Date(a.resolvedAt || a.updatedAt).getTime();
      const bTime = new Date(b.resolvedAt || b.updatedAt).getTime();
      return bTime - aTime;
    })
    .slice(0, 6);
  const recentActivity = [...tickets]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 8);

  const agingHours = Math.round(AGING_THRESHOLD_MS / 3600000);

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
              Creator Care OS
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Command Centre
            </h1>
            <p className="mt-1 text-sm text-muted">
              Operational home for {staffName}. Live ticket intelligence across
              creators, campaigns and ownership.
            </p>
            <p className="mt-1 text-xs text-muted tabular-nums">
              Snapshot as of {formatDateTime(new Date().toISOString())} IST ·{" "}
              {tickets.length} loaded ticket
              {tickets.length === 1 ? "" : "s"}
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

        {tickets.length === 0 ? (
          <div className="mt-8 rounded-lg border border-border bg-surface">
            <EmptyState
              title="No tickets loaded"
              description="Command Centre populates from live Supabase tickets. Create a ticket or refresh once data is available."
              action={
                <button
                  type="button"
                  onClick={onOpenInbox}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
                >
                  Go to Inbox
                </button>
              }
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
              <StatCard label="Open" value={counts.open} onClick={onOpenInbox} />
              <StatCard label="In Progress" value={counts.inProgress} />
              <StatCard
                label="Waiting"
                value={counts.waiting}
                onClick={() => onOpenView("waiting")}
              />
              <StatCard
                label="Resolved"
                value={counts.resolved}
                onClick={() => onOpenView("resolved")}
              />
              <StatCard
                label="Urgent"
                value={counts.urgent}
                onClick={() => onOpenView("urgent")}
              />
              <StatCard
                label="Unassigned"
                value={counts.unassigned}
                onClick={() => onOpenView("unassigned")}
              />
              <StatCard
                label="Pending replies"
                value={pendingReplyIds.size}
                onClick={() => onOpenView("pending-reply")}
              />
              <StatCard
                label="Aging unresolved"
                value={counts.aging}
                hint={`>${agingHours}h · not an SLA breach`}
                onClick={() => onOpenView("sla-risk")}
              />
            </div>

            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-sm text-muted">
              <span className="font-medium text-foreground">SLA Risk:</span>{" "}
              Formal SLA breach detection is not configured yet. Aging
              unresolved tickets ({">"}
              {agingHours} hours) are shown as attention signals only.
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section className="rounded-lg border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Needs Attention
                    </h2>
                    <p className="text-xs text-muted">
                      Urgent, unassigned, aging, waiting, or pending creator
                      replies
                    </p>
                  </div>
                  <span className="text-xs font-medium text-muted tabular-nums">
                    {attention.length}
                  </span>
                </div>
                {attention.length === 0 ? (
                  <EmptyState
                    compact
                    title="Queue is clear"
                    description="No active tickets currently match attention conditions."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {attention.slice(0, 10).map((item) => (
                      <li key={item.ticket.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTicket(item.ticket.id)}
                          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[11px] font-semibold text-accent tabular-nums">
                                {item.ticket.ticketNumber}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${priorityClass(item.ticket.priority)}`}
                              >
                                {item.ticket.priority}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(item.ticket.status)}`}
                              >
                                {item.ticket.status}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium text-foreground">
                              {item.ticket.creatorName}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-muted">
                              {item.reasons.join(" · ")}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted tabular-nums">
                            {ticketAgeLabel(item.ticket.createdAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="space-y-4">
                <MiniBar title="Issue-type distribution" rows={byIssue} />
                <MiniBar title="Channel distribution" rows={byChannel} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <section className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Executive workload
                  </h2>
                  <p className="text-xs text-muted">Open vs total assigned</p>
                </div>
                {workload.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted">No assignments.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {workload.slice(0, 8).map((row) => (
                      <li
                        key={row.name}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <span className="truncate text-foreground">
                          {row.name}
                        </span>
                        <span className="text-muted tabular-nums">
                          {row.open} open · {row.total} total
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Oldest unresolved
                  </h2>
                </div>
                {oldestUnresolved.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted">None.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {oldestUnresolved.map((ticket) => (
                      <li key={ticket.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTicket(ticket.id)}
                          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-[11px] text-accent">
                              {ticket.ticketNumber}
                            </span>{" "}
                            {ticket.creatorName}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted tabular-nums">
                            {ticketAgeLabel(ticket.createdAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Recently resolved
                  </h2>
                </div>
                {recentlyResolved.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted">None yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {recentlyResolved.map((ticket) => (
                      <li key={ticket.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTicket(ticket.id)}
                          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-[11px] text-accent">
                              {ticket.ticketNumber}
                            </span>{" "}
                            {ticket.creatorName}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted tabular-nums">
                            {formatCompactDateTime(
                              ticket.resolvedAt || ticket.updatedAt,
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="mt-4 rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Recent ticket activity
                </h2>
                <p className="text-xs text-muted">
                  Sorted by last updated timestamp from live ticket rows
                </p>
              </div>
              <ul className="divide-y divide-border">
                {recentActivity.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTicket(ticket.id)}
                      className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left hover:bg-surface-muted sm:grid-cols-[140px_minmax(0,1fr)_120px_100px]"
                    >
                      <span className="font-mono text-xs font-semibold text-accent tabular-nums">
                        {ticket.ticketNumber}
                      </span>
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {ticket.creatorName} · {ticket.issueType}
                        {ticket.brand ? ` · ${ticket.brand}` : ""}
                      </span>
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ring-1 ring-inset ${statusClass(ticket.status)}`}
                        >
                          {ticket.status}
                        </span>
                        <ChannelBadge
                          channel={ticket.sourceChannel}
                          showLabel={false}
                        />
                      </span>
                      <span className="text-xs text-muted tabular-nums sm:text-right">
                        {formatCompactDateTime(ticket.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
