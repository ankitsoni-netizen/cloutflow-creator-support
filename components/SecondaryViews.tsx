"use client";

import { useMemo, useState, type ReactNode } from "react";
import EmptyState from "@/components/ui/EmptyState";
import IntegrationCard from "@/components/ui/IntegrationCard";
import { SparklesIcon } from "@/components/ui/Icons";
import type {
  SourceChannel,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";
import {
  averageResolutionHours,
  formatDateTime,
  isTicketAssigned,
  uniqueSorted,
} from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

function ViewHeader({
  title,
  description,
  meta,
  onOpenInbox,
  actions,
}: {
  title: string;
  description: string;
  meta?: string;
  onOpenInbox: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
        {meta ? (
          <p className="mt-1 text-xs text-muted tabular-nums">{meta}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onOpenInbox}
          className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Open Inbox
        </button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="flex min-w-[140px] flex-1 flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-foreground tabular-nums">
        {value}
      </p>
    </div>
  );
}

function BarList({
  title,
  rows,
  emptyHint = "No data in the current filter set.",
}: {
  title: string;
  rows: { label: string; value: number }[];
  emptyHint?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  const hasData = rows.some((row) => row.value > 0);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {!hasData ? (
        <p className="mt-3 text-sm text-muted">{emptyHint}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted">{row.label}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {row.value}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(row.value / max) * 100}%` }}
                  role="presentation"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function countBy(
  tickets: Ticket[],
  getKey: (ticket: Ticket) => string,
): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const ticket of tickets) {
    const key = getKey(ticket).trim() || "Unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function topOpenFriction(
  tickets: Ticket[],
  getKey: (ticket: Ticket) => string,
  limit = 5,
): { label: string; value: number }[] {
  return countBy(
    tickets.filter((ticket) => ticket.status !== "Resolved"),
    getKey,
  ).slice(0, limit);
}

function monthKeyFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  return `${month} ${year}`.trim() || "Unknown";
}

function isWithinDateRange(
  createdAt: string,
  range: "all" | "7d" | "30d",
  now: number,
): boolean {
  if (range === "all") return true;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const windowMs = range === "7d" ? 7 * 86400000 : 30 * 86400000;
  return now - created <= windowMs;
}

function agingBucket(createdAt: string, now: number): "<24h" | "24-72h" | ">72h" | null {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const age = now - created;
  if (age < 24 * 3600000) return "<24h";
  if (age < 72 * 3600000) return "24-72h";
  return ">72h";
}

/* -------------------------------------------------------------------------- */
/* AnalyticsView                                                               */
/* -------------------------------------------------------------------------- */

interface AnalyticsViewProps {
  tickets: Ticket[];
  onOpenInbox: () => void;
  pendingReplyCount?: number;
}

export function AnalyticsView({
  tickets,
  onOpenInbox,
  pendingReplyCount,
}: AnalyticsViewProps) {
  const [dateRange, setDateRange] = useState<"all" | "7d" | "30d">("all");
  const [channel, setChannel] = useState("");
  const [issueType, setIssueType] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [brand, setBrand] = useState("");
  const [campaign, setCampaign] = useState("");
  const [poc, setPoc] = useState("");
  const [executive, setExecutive] = useState("");
  const [nowMs] = useState(() => Date.now());
  const asOfLabel = formatDateTime(new Date(nowMs).toISOString());

  const filterOptions = useMemo(() => {
    return {
      channels: uniqueSorted(tickets.map((t) => t.sourceChannel)),
      issueTypes: uniqueSorted(tickets.map((t) => t.issueType)),
      statuses: uniqueSorted(tickets.map((t) => t.status)),
      priorities: uniqueSorted(tickets.map((t) => t.priority)),
      brands: uniqueSorted(tickets.map((t) => t.brand)),
      campaigns: uniqueSorted(tickets.map((t) => t.campaignName)),
      pocs: uniqueSorted(tickets.map((t) => t.cloutflowPoc)),
      executives: uniqueSorted(
        tickets.map((t) =>
          isTicketAssigned(t) ? t.assignedExecutive : "Unassigned",
        ),
      ),
    };
  }, [tickets]);

  const filtered = useMemo(() => {
    return tickets.filter((ticket) => {
      if (!isWithinDateRange(ticket.createdAt, dateRange, nowMs)) return false;
      if (channel && ticket.sourceChannel !== (channel as SourceChannel)) {
        return false;
      }
      if (issueType && ticket.issueType !== issueType) return false;
      if (status && ticket.status !== (status as TicketStatus)) return false;
      if (priority && ticket.priority !== (priority as TicketPriority)) {
        return false;
      }
      if (brand && ticket.brand !== brand) return false;
      if (campaign && ticket.campaignName !== campaign) return false;
      if (poc && ticket.cloutflowPoc !== poc) return false;
      if (executive) {
        const assignedLabel = isTicketAssigned(ticket)
          ? ticket.assignedExecutive
          : "Unassigned";
        if (assignedLabel !== executive) return false;
      }
      return true;
    });
  }, [
    tickets,
    dateRange,
    channel,
    issueType,
    status,
    priority,
    brand,
    campaign,
    poc,
    executive,
    nowMs,
  ]);

  const metrics = useMemo(() => {
    const open = filtered.filter((t) => t.status === "Open").length;
    const inProgress = filtered.filter((t) => t.status === "In Progress").length;
    const waiting = filtered.filter((t) => t.status === "Waiting").length;
    const resolved = filtered.filter((t) => t.status === "Resolved").length;
    const unassigned = filtered.filter((t) => !isTicketAssigned(t)).length;
    const urgent = filtered.filter((t) => t.priority === "Urgent").length;
    return {
      total: filtered.length,
      open,
      inProgress,
      waiting,
      resolved,
      unassigned,
      urgent,
    };
  }, [filtered]);

  const byIssue = useMemo(
    () => countBy(filtered, (t) => t.issueType),
    [filtered],
  );
  const byChannel = useMemo(
    () => countBy(filtered, (t) => t.sourceChannel),
    [filtered],
  );
  const byBrand = useMemo(() => countBy(filtered, (t) => t.brand), [filtered]);
  const byCampaign = useMemo(
    () => countBy(filtered, (t) => t.campaignName),
    [filtered],
  );
  const byMonth = useMemo(
    () =>
      countBy(filtered, (t) => t.campaignMonth || monthKeyFromIso(t.createdAt)),
    [filtered],
  );
  const byPoc = useMemo(
    () => countBy(filtered, (t) => t.cloutflowPoc),
    [filtered],
  );
  const byExecutive = useMemo(
    () =>
      countBy(filtered, (t) =>
        isTicketAssigned(t) ? t.assignedExecutive : "Unassigned",
      ),
    [filtered],
  );

  const resolutionVolume = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const ticket of filtered) {
      if (ticket.status !== "Resolved" || !ticket.resolvedAt) continue;
      const day = formatDateTime(ticket.resolvedAt).split(",")[0] ?? "Unknown";
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([label, value]) => ({ label, value }))
      .slice(-21);
  }, [filtered]);

  const avgHours = averageResolutionHours(filtered);

  const aging = useMemo(() => {
    const unresolved = filtered.filter((t) => t.status !== "Resolved");
    const buckets = { "<24h": 0, "24-72h": 0, ">72h": 0 };
    for (const ticket of unresolved) {
      const bucket = agingBucket(ticket.createdAt, nowMs);
      if (bucket) buckets[bucket] += 1;
    }
    return [
      { label: "<24h", value: buckets["<24h"] },
      { label: "24–72h", value: buckets["24-72h"] },
      { label: ">72h", value: buckets[">72h"] },
    ];
  }, [filtered, nowMs]);

  const frictionBrands = useMemo(
    () => topOpenFriction(filtered, (t) => t.brand),
    [filtered],
  );
  const frictionCampaigns = useMemo(
    () => topOpenFriction(filtered, (t) => t.campaignName),
    [filtered],
  );
  const frictionMonths = useMemo(
    () =>
      topOpenFriction(
        filtered,
        (t) => t.campaignMonth || monthKeyFromIso(t.createdAt),
      ),
    [filtered],
  );
  const frictionPocs = useMemo(
    () => topOpenFriction(filtered, (t) => t.cloutflowPoc),
    [filtered],
  );

  const dateRangeLabel =
    dateRange === "all"
      ? "All time (by createdAt)"
      : dateRange === "7d"
        ? "Last 7 days (by createdAt)"
        : "Last 30 days (by createdAt)";

  const rangeMeta =
    tickets.length === 0
      ? `No tickets loaded · as of ${asOfLabel} IST`
      : `${dateRangeLabel} · ${filtered.length} of ${tickets.length} tickets · as of ${asOfLabel} IST`;

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <ViewHeader
          title="Analytics"
          description="Creator-support operations metrics from live ticket data only. No synthetic CSAT, SLA%, or AI rates."
          meta={rangeMeta}
          onOpenInbox={onOpenInbox}
        />

        <div className="mt-5 rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted">
            Filters (client-side) · empty = All
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="flex min-w-[140px] flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Date range
              </span>
              <select
                value={dateRange}
                onChange={(e) =>
                  setDateRange(e.target.value as "all" | "7d" | "30d")
                }
                className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent"
              >
                <option value="all">All</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>
            <FilterSelect
              label="Channel"
              value={channel}
              onChange={setChannel}
              options={filterOptions.channels}
            />
            <FilterSelect
              label="Issue type"
              value={issueType}
              onChange={setIssueType}
              options={filterOptions.issueTypes}
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={filterOptions.statuses}
            />
            <FilterSelect
              label="Priority"
              value={priority}
              onChange={setPriority}
              options={filterOptions.priorities}
            />
            <FilterSelect
              label="Brand"
              value={brand}
              onChange={setBrand}
              options={filterOptions.brands}
            />
            <FilterSelect
              label="Campaign"
              value={campaign}
              onChange={setCampaign}
              options={filterOptions.campaigns}
            />
            <FilterSelect
              label="POC"
              value={poc}
              onChange={setPoc}
              options={filterOptions.pocs}
            />
            <FilterSelect
              label="Executive"
              value={executive}
              onChange={setExecutive}
              options={filterOptions.executives}
            />
          </div>
        </div>

        {tickets.length === 0 ? (
          <div className="mt-8 rounded-lg border border-border bg-surface">
            <EmptyState
              title="Insufficient data"
              description="Analytics will populate once tickets are available in the workspace. No sample ticket data is shown."
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-8 rounded-lg border border-border bg-surface">
            <EmptyState
              title="No tickets match filters"
              description="Widen the date range or clear channel, issue, status, priority, brand, campaign, POC, or executive filters."
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
              <MetricCard label="Total" value={metrics.total} />
              <MetricCard label="Open" value={metrics.open} />
              <MetricCard label="In progress" value={metrics.inProgress} />
              <MetricCard label="Waiting" value={metrics.waiting} />
              <MetricCard label="Resolved" value={metrics.resolved} />
              <MetricCard label="Unassigned" value={metrics.unassigned} />
              <MetricCard label="Urgent" value={metrics.urgent} />
            </div>

            {typeof pendingReplyCount === "number" ? (
              <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-4">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                  Pending creator replies
                </p>
                <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">
                  {pendingReplyCount}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Count supplied by the parent inbox; not inferred from ticket
                  rows alone.
                </p>
              </div>
            ) : null}

            <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-4">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Average resolution time
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">
                {avgHours === null
                  ? "Not enough resolved timestamps"
                  : `${avgHours.toFixed(1)} hours`}
              </p>
              <p className="mt-1 text-xs text-muted">
                From tickets with both createdAt and resolvedAt in the current
                filter set.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BarList title="Tickets by issue type" rows={byIssue} />
              <BarList title="Tickets by channel" rows={byChannel} />
              <BarList title="Tickets by brand" rows={byBrand} />
              <BarList title="Tickets by campaign" rows={byCampaign} />
              <BarList title="Tickets by month" rows={byMonth} />
              <BarList title="Tickets by POC" rows={byPoc} />
              <BarList title="Tickets by executive" rows={byExecutive} />
              <BarList
                title="Unresolved ticket aging"
                rows={aging}
                emptyHint="No unresolved tickets in the current filter set."
              />
              <div className="lg:col-span-2">
                <BarList
                  title="Resolution volume over time (resolvedAt)"
                  rows={resolutionVolume}
                  emptyHint="No resolved tickets with resolvedAt in the current filter set."
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold text-foreground">
                Which brands, campaigns, months and POCs generate the most
                creator-support friction?
              </h2>
              <p className="mt-1 text-xs text-muted">
                Ranked by open (unresolved) ticket count in the current filter
                set.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <BarList
                  title="Top brands (open)"
                  rows={frictionBrands}
                  emptyHint="No open tickets to rank brands."
                />
                <BarList
                  title="Top campaigns (open)"
                  rows={frictionCampaigns}
                  emptyHint="No open tickets to rank campaigns."
                />
                <BarList
                  title="Top months (open)"
                  rows={frictionMonths}
                  emptyHint="No open tickets to rank months."
                />
                <BarList
                  title="Top POCs (open)"
                  rows={frictionPocs}
                  emptyHint="No open tickets to rank POCs."
                />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ResolutionBaseView                                                          */
/* -------------------------------------------------------------------------- */

interface ResolutionBaseViewProps {
  onOpenInbox: () => void;
}

const RESOLUTION_CATEGORIES = [
  "Payment",
  "TDS",
  "GST",
  "Invoice",
  "Banking",
  "Campaign Deliverables",
  "POC Escalation",
  "Creator Conduct",
  "Platform Guidance",
  "General Support",
] as const;

const ARTICLE_STATUS_FILTERS = [
  "All",
  "Draft",
  "Published",
  "Archived",
] as const;

export function ResolutionBaseView({ onOpenInbox }: ResolutionBaseViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [articleStatus, setArticleStatus] =
    useState<(typeof ARTICLE_STATUS_FILTERS)[number]>("All");

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <ViewHeader
          title="Resolution Base"
          description="Knowledge workspace for reusable creator-support resolutions. The resolution_articles table is not queried yet — schema and API wiring are required later."
          onOpenInbox={onOpenInbox}
          actions={
            <>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted"
                title="Requires AI setup"
              >
                <SparklesIcon className="h-4 w-4" />
                Generate with AI
              </button>
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted"
                title="Requires AI setup"
              >
                Improve article
              </button>
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted"
                title="Requires AI setup"
              >
                Translate
              </button>
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted"
                title="Requires ticket context and article store"
              >
                Recommend for ticket
              </button>
            </>
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resolution articles..."
            className="min-w-[220px] flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-1.5">
            {ARTICLE_STATUS_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setArticleStatus(item)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  articleStatus === item
                    ? "bg-accent text-white"
                    : "bg-surface text-muted ring-1 ring-border"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              category === "all"
                ? "bg-accent text-white"
                : "bg-surface text-muted ring-1 ring-border"
            }`}
          >
            All categories
          </button>
          {RESOLUTION_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                category === item
                  ? "bg-accent text-white"
                  : "bg-surface text-muted ring-1 ring-border"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                Article list
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                0 articles · status filter: {articleStatus}
              </p>
            </div>
            <EmptyState
              compact
              title="No articles yet"
              description="Resolution articles will appear here once resolution_articles is created and queried. Draft, published, and archived states will be supported. No fake policy content is shown."
            />
          </div>
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                Article preview
              </h2>
            </div>
            <EmptyState
              title="Select an article"
              description="Payment, TDS, GST, invoice, banking, campaign deliverables, POC escalation, creator conduct, platform guidance, and general support playbooks will preview here after articles exist."
            />
            {(query || category !== "all" || articleStatus !== "All") && (
              <p className="border-t border-border px-4 py-3 text-xs text-muted">
                Filters applied locally
                {query ? ` · search “${query}”` : ""}
                {category !== "all" ? ` · category ${category}` : ""}
                {articleStatus !== "All" ? ` · ${articleStatus}` : ""}. No
                matching articles in the current workspace.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ChannelsView                                                                */
/* -------------------------------------------------------------------------- */

interface ChannelsViewProps {
  onOpenInbox: () => void;
}

function ChannelSetupBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 rounded-md border border-dashed border-border bg-surface-muted px-3 py-3">
      <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-xs leading-5 text-muted">
        {children}
      </div>
    </div>
  );
}

function DisabledField({
  label,
  placeholder,
}: {
  label: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <input
        type="text"
        disabled
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted"
      />
    </label>
  );
}

export function ChannelsView({ onOpenInbox }: ChannelsViewProps) {
  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <ViewHeader
          title="Channels"
          description="Omnichannel integrations for Cloutflow Creator Operations Resolution System. Status reflects real connectivity only — all channels are Not Connected until backend credentials are configured."
          onOpenInbox={onOpenInbox}
        />

        <p className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-xs leading-5 text-muted">
          Security: never paste API keys, tokens, or secrets into the browser.
          Channel credentials must live in server-side configuration only.
          Configuration forms below are intentionally disabled.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <IntegrationCard
              name="Website Chat"
              description="Capture inbound creator chats from Cloutflow web surfaces into the unified inbox."
              inbound="Not connected"
              outbound="Not connected"
              setupNotes="Requires website widget keys and routing rules configured in a secure backend. Do not paste embed secrets here."
              status="not_connected"
            />
            <ChannelSetupBlock title="Setup detail">
              <p>
                Chatbot preview: placeholder only — no live widget is embedded.
              </p>
              <pre className="overflow-x-auto rounded border border-border bg-surface px-2 py-2 font-mono text-[11px] text-muted">
                {`<!-- Cloutflow chat embed placeholder -->
<script src="…" data-workspace="…"></script>`}
              </pre>
              <DisabledField
                label="Allowed domains"
                placeholder="e.g. app.cloutflow.com (disabled)"
              />
              <p>
                Handoff behaviour: when a creator needs a human, the chat should
                create or attach a ticket and route to the inbox. Not configured.
              </p>
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted"
              >
                Save configuration
              </button>
            </ChannelSetupBlock>
          </div>

          <div>
            <IntegrationCard
              name="WhatsApp via WATI"
              description="Handle WhatsApp creator conversations with queued outbound replies."
              inbound="Not connected"
              outbound="Queued until connected"
              setupNotes="Requires WATI workspace credentials stored server-side. Webhook verification is pending."
              status="not_connected"
            />
            <ChannelSetupBlock title="Setup detail">
              <p>Webhook status: not registered.</p>
              <p>Inbound mapping: WATI conversation → support ticket (pending).</p>
              <p>Outbound: agent replies queued until WATI is connected.</p>
              <DisabledField
                label="WATI workspace ID"
                placeholder="Configure server-side only"
              />
              <DisabledField
                label="Webhook URL"
                placeholder="Will be issued after backend setup"
              />
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted"
              >
                Save configuration
              </button>
            </ChannelSetupBlock>
          </div>

          <div>
            <IntegrationCard
              name="Instagram via Meta"
              description="Sync Instagram DMs and comments related to creator campaigns."
              inbound="Not connected"
              outbound="Queued until connected"
              setupNotes="Requires Meta app credentials and page permissions managed outside the browser."
              status="not_connected"
            />
            <ChannelSetupBlock title="Setup detail">
              <p>Meta app link status: not connected.</p>
              <p>Page / IG account binding: not configured.</p>
              <p>Webhook subscription: placeholder — no events received.</p>
              <DisabledField
                label="Meta app ID"
                placeholder="Configure server-side only"
              />
              <DisabledField
                label="Page ID"
                placeholder="Configure server-side only"
              />
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted"
              >
                Save configuration
              </button>
            </ChannelSetupBlock>
          </div>

          <div>
            <IntegrationCard
              name="Brevo Email"
              description="Send acknowledgement and follow-up emails from the support desk."
              inbound="Not connected"
              outbound="Queued until connected"
              setupNotes="Requires Brevo API credentials and approved templates. Keys are never stored in frontend code."
              status="not_connected"
            />
            <ChannelSetupBlock title="Setup detail">
              <p>Sender domain: not verified in this workspace.</p>
              <p>Acknowledgement template: not configured.</p>
              <p>Inbound parse / reply-to threading: not configured.</p>
              <DisabledField
                label="Sender email"
                placeholder="Configure server-side only"
              />
              <DisabledField
                label="Template ID"
                placeholder="Configure server-side only"
              />
              <button
                type="button"
                disabled
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted"
              >
                Save configuration
              </button>
            </ChannelSetupBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* AutomationsView                                                             */
/* -------------------------------------------------------------------------- */

interface AutomationsViewProps {
  onOpenInbox: () => void;
}

const AUTOMATION_TEMPLATES = [
  {
    title: "Route by issue type",
    when: "When a ticket is created",
    if: "If issue type matches a routing map",
    then: "Then assign team / executive",
    status: "Not configured" as const,
  },
  {
    title: "Route by brand",
    when: "When a ticket is created or brand is set",
    if: "If brand has a dedicated owner",
    then: "Then assign that owner",
    status: "Draft" as const,
  },
  {
    title: "Route by POC",
    when: "When a ticket includes a Cloutflow POC",
    if: "If POC has an escalation owner",
    then: "Then notify or assign that executive",
    status: "Not configured" as const,
  },
  {
    title: "Escalate urgent",
    when: "When priority becomes Urgent",
    if: "If ticket is still unresolved",
    then: "Then notify lead and bump queue visibility",
    status: "Not configured" as const,
  },
  {
    title: "Remind executives",
    when: "When a ticket ages without update",
    if: "If assigned executive has not responded",
    then: "Then send a reminder (channel TBD)",
    status: "Draft" as const,
  },
  {
    title: "Follow up missing docs",
    when: "When status is Waiting",
    if: "If creator docs or bank details are missing",
    then: "Then send a follow-up prompt",
    status: "Not configured" as const,
  },
  {
    title: "Mark waiting",
    when: "When an agent requests creator info",
    if: "If outbound message asks for documents",
    then: "Then set status to Waiting",
    status: "Not configured" as const,
  },
  {
    title: "Reopen on reply",
    when: "When a creator replies on a resolved thread",
    if: "If the linked ticket is Resolved",
    then: "Then reopen to Open or Waiting",
    status: "Draft" as const,
  },
  {
    title: "Escalate old unresolved",
    when: "When unresolved age exceeds 72h",
    if: "If status is not Resolved",
    then: "Then escalate to team lead",
    status: "Not configured" as const,
  },
  {
    title: "Detect repeated campaign / brand complaints",
    when: "When a new ticket is created",
    if: "If the same brand or campaign has multiple open tickets",
    then: "Then flag for friction review",
    status: "Not configured" as const,
  },
  {
    title: "Request feedback",
    when: "When a ticket is resolved",
    if: "If creator contact channel is available",
    then: "Then request resolution feedback (not CSAT faked)",
    status: "Not configured" as const,
  },
] as const;

export function AutomationsView({ onOpenInbox }: AutomationsViewProps) {
  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <ViewHeader
          title="Automations"
          description="When → If → Then rule templates for creator-support operations. None are Active until real configuration and execution backends exist."
          onOpenInbox={onOpenInbox}
        />

        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-xs text-muted">
          Active rules: 0 · Templates below are Not configured or Draft only.
          Execute and save actions are disabled.
        </div>

        <div className="mt-6 space-y-3">
          {AUTOMATION_TEMPLATES.map((item) => (
            <article
              key={item.title}
              className="rounded-lg border border-border bg-surface px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted">Status: {item.status}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted"
                  >
                    Configure
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted"
                  >
                    Execute
                  </button>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-md bg-surface-muted px-3 py-2">
                  <dt className="font-semibold text-foreground">When</dt>
                  <dd className="mt-1 text-muted">{item.when}</dd>
                </div>
                <div className="rounded-md bg-surface-muted px-3 py-2">
                  <dt className="font-semibold text-foreground">If</dt>
                  <dd className="mt-1 text-muted">{item.if}</dd>
                </div>
                <div className="rounded-md bg-surface-muted px-3 py-2">
                  <dt className="font-semibold text-foreground">Then</dt>
                  <dd className="mt-1 text-muted">{item.then}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* SettingsView                                                                */
/* -------------------------------------------------------------------------- */

interface SettingsViewProps {
  emailAcknowledgements: boolean;
  onToggleEmailAcknowledgements: () => void;
  onOpenInbox: () => void;
  staffName: string;
  staffTeam: string | null;
}

const SETTINGS_SECTIONS = [
  { id: "workspace", label: "Workspace", interactive: true },
  { id: "ticket-fields", label: "Ticket Fields", interactive: false },
  { id: "status-priority", label: "Status and Priority", interactive: false },
  { id: "teams-roles", label: "Teams and Roles", interactive: false },
  { id: "business-hours", label: "Business Hours", interactive: false },
  { id: "sla", label: "SLA", interactive: false },
  { id: "notifications", label: "Notifications", interactive: false },
  { id: "email-templates", label: "Email Templates", interactive: false },
  { id: "channels", label: "Channels", interactive: false },
  { id: "ai-automation", label: "AI and Automation", interactive: false },
  { id: "security", label: "Security", interactive: false },
  { id: "audit-log", label: "Audit Log", interactive: false },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export function SettingsView({
  emailAcknowledgements,
  onToggleEmailAcknowledgements,
  onOpenInbox,
  staffName,
  staffTeam,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSectionId>("workspace");
  const active =
    SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <ViewHeader
          title="Settings"
          description="Workspace preferences for Cloutflow Creator Operations Resolution System."
          onOpenInbox={onOpenInbox}
        />

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="rounded-lg border border-border bg-surface p-2">
            {SETTINGS_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  section === item.id
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                <span>{item.label}</span>
                {!item.interactive ? (
                  <span className="text-[10px] text-muted">Setup</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="rounded-lg border border-border bg-surface p-5">
            {section === "workspace" ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Workspace
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Signed in as {staffName}
                    {staffTeam ? ` · ${staffTeam}` : ""}.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface-muted p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Default acknowledgement emails
                    </h3>
                    <p className="mt-1 text-sm text-muted">
                      Prefill the acknowledgement checkbox when raising a new
                      ticket. This preference is session-local until workspace
                      settings persistence is enabled.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emailAcknowledgements}
                    onClick={onToggleEmailAcknowledgements}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      emailAcknowledgements ? "bg-accent" : "bg-border-strong"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        emailAcknowledgements
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Not configured"
                description={`${active.label} setup is required. No fake save actions or sample configuration are available yet.`}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
