"use client";

import { useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import {
  buildCreatorRecords,
  creatorMatchesSearch,
} from "@/lib/intelligence/creators";
import type { CreatorRecord, Ticket } from "@/lib/types";
import {
  displayOrFallback,
  formatCompactDateTime,
  statusClass,
} from "@/lib/utils";

interface CreatorsViewProps {
  tickets: Ticket[];
  onOpenTicket: (ticketId: string) => void;
  onOpenInbox: () => void;
}

function FutureBlock({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-3">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11px] text-muted">
        Unavailable until the related database exists. Not fabricated.
      </p>
    </div>
  );
}

export default function CreatorsView({
  tickets,
  onOpenTicket,
  onOpenInbox,
}: CreatorsViewProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const creators = useMemo(() => buildCreatorRecords(tickets), [tickets]);
  const filtered = useMemo(
    () =>
      creators.filter((creator) =>
        creatorMatchesSearch(creator, query.trim().toLowerCase()),
      ),
    [creators, query],
  );
  const selected =
    filtered.find((creator) => creator.id === selectedId) ??
    filtered[0] ??
    null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-surface px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Creators</h1>
            <p className="mt-1 text-sm text-muted">
              Creator 360° records derived from live tickets. Creators are
              grouped by phone, email or handle — never by name alone.
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, email or handle..."
          className="mt-4 w-full max-w-xl rounded-md border border-border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      {creators.length === 0 ? (
        <EmptyState
          title="No creator records yet"
          description="Creator profiles appear once tickets exist in the workspace."
        />
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-border bg-surface">
            <ul className="divide-y divide-border">
              {filtered.map((creator) => (
                <li key={creator.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(creator.id)}
                    className={`w-full px-4 py-3 text-left ${
                      selected?.id === creator.id
                        ? "bg-accent-soft"
                        : "hover:bg-surface-muted"
                    }`}
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {creator.displayName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {creator.handles[0] ||
                        creator.emails[0] ||
                        creator.phones[0] ||
                        "Identifiers limited"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted tabular-nums">
                      {creator.ticketCount} tickets · {creator.openCount} open
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 ? (
              <EmptyState
                compact
                title="No matches"
                description="Try another creator identifier."
              />
            ) : null}
          </div>

          <div className="min-h-0 overflow-y-auto bg-surface-muted/40 p-4 sm:p-6">
            {selected ? (
              <CreatorProfile
                creator={selected}
                onOpenTicket={onOpenTicket}
              />
            ) : (
              <EmptyState
                title="Select a creator"
                description="Choose a creator record to inspect contact details and ticket history."
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CreatorProfile({
  creator,
  onOpenTicket,
}: {
  creator: CreatorRecord;
  onOpenTicket: (ticketId: string) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-foreground">
          {creator.displayName}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {creator.openCount} open · {creator.resolvedCount} resolved ·{" "}
          {creator.waitingCount} waiting
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Info label="Phone" value={creator.phones.join(", ") || "Not provided"} />
          <Info label="Email" value={creator.emails.join(", ") || "Not provided"} />
          <Info
            label="Social handles"
            value={creator.handles.join(", ") || "Not provided"}
          />
          <Info
            label="Platforms"
            value={creator.platforms.join(", ") || "Not provided"}
          />
          <Info
            label="Preferred channel"
            value="Unavailable until channel preferences exist"
          />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ChipList title="Brands" values={creator.brands} />
        <ChipList title="Campaigns" values={creator.campaigns} />
        <ChipList title="POCs" values={creator.pocs} />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            Issue history
          </h3>
        </div>
        <ul className="divide-y divide-border">
          {creator.tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => onOpenTicket(ticket.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-semibold text-accent">
                    {ticket.ticketNumber}
                  </p>
                  <p className="truncate text-sm text-foreground">
                    {ticket.issueType}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(ticket.status)}`}
                  >
                    {ticket.status}
                  </span>
                  <span className="text-[11px] text-muted tabular-nums">
                    {formatCompactDateTime(ticket.updatedAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FutureBlock title="Payment history" />
        <FutureBlock title="TDS / GST records" />
        <FutureBlock title="Invoice documents" />
        <FutureBlock title="Bank verification" />
        <FutureBlock title="Lifetime campaign value" />
        <FutureBlock title="Creator tier / relationship health" />
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">
        {displayOrFallback(value)}
      </dd>
    </div>
  );
}

function ChipList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {values.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Not provided</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className="rounded-md bg-surface-muted px-2 py-1 text-xs text-foreground"
            >
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
