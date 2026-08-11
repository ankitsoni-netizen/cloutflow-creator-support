"use client";

import { useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import {
  buildCampaignRecords,
  campaignMatchesSearch,
} from "@/lib/intelligence/campaigns";
import type { CampaignRecord, Ticket } from "@/lib/types";
import {
  formatCompactDateTime,
  formatDateTime,
  statusClass,
  ticketAgeLabel,
} from "@/lib/utils";

interface CampaignsViewProps {
  tickets: Ticket[];
  onOpenTicket: (ticketId: string) => void;
  onOpenInbox: () => void;
}

export default function CampaignsView({
  tickets,
  onOpenTicket,
  onOpenInbox,
}: CampaignsViewProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const campaigns = useMemo(() => buildCampaignRecords(tickets), [tickets]);
  const filtered = useMemo(
    () =>
      campaigns.filter((campaign) =>
        campaignMatchesSearch(campaign, query.trim().toLowerCase()),
      ),
    [campaigns, query],
  );
  const selected =
    filtered.find((campaign) => campaign.id === selectedId) ??
    filtered[0] ??
    null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-surface px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
            <p className="mt-1 text-sm text-muted">
              Campaign intelligence derived from ticket fields (campaign, brand,
              month, POC). No separate campaigns table is used in this phase.
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
          placeholder="Search campaign, brand, month or POC..."
          className="mt-4 w-full max-w-xl rounded-md border border-border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaign groups yet"
          description="Campaign incident views appear once tickets include campaign context."
        />
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-border bg-surface">
            <ul className="divide-y divide-border">
              {filtered.map((campaign) => (
                <li key={campaign.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(campaign.id)}
                    className={`w-full px-4 py-3 text-left ${
                      selected?.id === campaign.id
                        ? "bg-accent-soft"
                        : "hover:bg-surface-muted"
                    }`}
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {campaign.campaignName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {campaign.brand} · {campaign.campaignMonth}
                    </p>
                    <p className="mt-1 text-[11px] text-muted tabular-nums">
                      {campaign.ticketCount} tickets · {campaign.openCount} open
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            {selected ? (
              <CampaignIncident
                campaign={selected}
                onOpenTicket={onOpenTicket}
              />
            ) : (
              <EmptyState
                title="Select a campaign"
                description="Inspect related tickets and complaint categories."
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CampaignIncident({
  campaign,
  onOpenTicket,
}: {
  campaign: CampaignRecord;
  onOpenTicket: (ticketId: string) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-foreground">
          {campaign.campaignName}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {campaign.brand} · {campaign.campaignMonth}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Ticket volume" value={campaign.ticketCount} />
          <Metric label="Open" value={campaign.openCount} />
          <Metric label="Payment complaints" value={campaign.paymentCount} />
          <Metric label="TDS/GST complaints" value={campaign.taxCount} />
          <Metric
            label="Conduct / escalation"
            value={campaign.conductCount}
          />
          <Metric
            label="Oldest unresolved"
            value={
              campaign.oldestUnresolvedAt
                ? ticketAgeLabel(campaign.oldestUnresolvedAt)
                : "None"
            }
            tabular={Boolean(campaign.oldestUnresolvedAt)}
          />
        </div>
        <p className="mt-4 text-xs text-muted">
          POCs: {campaign.pocs.join(", ") || "Not provided"} · Teams:{" "}
          {campaign.teams.join(", ") || "Not provided"}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            Related tickets
          </h3>
        </div>
        <ul className="divide-y divide-border">
          {campaign.tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => onOpenTicket(ticket.id)}
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-semibold text-accent">
                    {ticket.ticketNumber}
                  </p>
                  <p className="truncate text-sm text-foreground">
                    {ticket.creatorName} · {ticket.issueType}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {ticket.assignedExecutive || "Unassigned"}
                    {ticket.cloutflowPoc ? ` · POC ${ticket.cloutflowPoc}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
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

      {campaign.oldestUnresolvedAt ? (
        <p className="text-xs text-muted tabular-nums">
          Oldest unresolved created{" "}
          {formatDateTime(campaign.oldestUnresolvedAt)} IST
        </p>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tabular = true,
}: {
  label: string;
  value: string | number;
  tabular?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold text-foreground ${tabular ? "tabular-nums" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
