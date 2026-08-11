import type {
  CampaignRecord,
  CreatorRecord,
  InboxView,
  SourceChannel,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "./types";

const DISPLAY_TIMEZONE = "Asia/Kolkata";

/** Tickets older than this (unresolved) surface in aging / attention queues. Not an SLA breach. */
export const AGING_THRESHOLD_MS = 72 * 60 * 60 * 1000;

const kolkataDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const kolkataRelativeDayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIMEZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** Formats a timestamptz/ISO string for CRM display in Asia/Kolkata. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const parts = kolkataDateTimeFormatter.formatToParts(date);
  const day = partValue(parts, "day");
  const month = partValue(parts, "month");
  const year = partValue(parts, "year");
  const hours = partValue(parts, "hour").padStart(2, "0");
  const minutes = partValue(parts, "minute").padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

/** Compact IST timestamp for dense queue rows. */
export function formatCompactDateTime(iso: string): string {
  const date = new Date(iso);
  const parts = kolkataRelativeDayFormatter.formatToParts(date);
  const day = partValue(parts, "day");
  const month = partValue(parts, "month");
  const hours = partValue(parts, "hour").padStart(2, "0");
  const minutes = partValue(parts, "minute").padStart(2, "0");
  return `${day} ${month}, ${hours}:${minutes}`;
}

export function priorityClass(priority: TicketPriority): string {
  switch (priority) {
    case "Urgent":
      return "bg-[var(--priority-urgent-soft)] text-[var(--priority-urgent)] ring-[color-mix(in_srgb,var(--priority-urgent)_25%,transparent)]";
    case "High":
      return "bg-[var(--priority-high-soft)] text-[var(--priority-high)] ring-[color-mix(in_srgb,var(--priority-high)_25%,transparent)]";
    case "Low":
      return "bg-[var(--priority-low-soft)] text-[var(--priority-low)] ring-[color-mix(in_srgb,var(--priority-low)_25%,transparent)]";
    default:
      return "bg-[var(--priority-normal-soft)] text-[var(--priority-normal)] ring-[color-mix(in_srgb,var(--priority-normal)_25%,transparent)]";
  }
}

export function statusClass(status: TicketStatus): string {
  switch (status) {
    case "Open":
      return "bg-[var(--status-open-soft)] text-[var(--status-open)] ring-[color-mix(in_srgb,var(--status-open)_25%,transparent)]";
    case "In Progress":
      return "bg-[var(--status-progress-soft)] text-[var(--status-progress)] ring-[color-mix(in_srgb,var(--status-progress)_25%,transparent)]";
    case "Waiting":
      return "bg-[var(--status-waiting-soft)] text-[var(--status-waiting)] ring-[color-mix(in_srgb,var(--status-waiting)_25%,transparent)]";
    case "Resolved":
      return "bg-[var(--status-resolved-soft)] text-[var(--status-resolved)] ring-[color-mix(in_srgb,var(--status-resolved)_25%,transparent)]";
    default:
      return "bg-surface-muted text-muted ring-border";
  }
}

export function channelAccentClass(channel: SourceChannel): string {
  switch (channel) {
    case "WhatsApp":
      return "text-[var(--channel-whatsapp)]";
    case "Instagram":
      return "text-[var(--channel-instagram)]";
    case "Website":
      return "text-[var(--channel-website)]";
    case "Email":
      return "text-[var(--channel-email)]";
    default:
      return "text-[var(--channel-phone)]";
  }
}

export function matchesStatusFilter(
  status: TicketStatus,
  filter: string,
): boolean {
  if (filter === "All") return true;
  return status === filter;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function displayOrFallback(
  value: string | null | undefined,
  fallback = "Not provided",
): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function ticketMatchesSearch(ticket: Ticket, query: string): boolean {
  if (!query) return true;
  const haystack = [
    ticket.ticketNumber,
    ticket.creatorName,
    ticket.phone,
    ticket.email,
    ticket.socialHandle,
    ticket.brand,
    ticket.campaignName,
    ticket.cloutflowPoc,
    ticket.issueCategory,
    ticket.issueType,
    ticket.sourceChannel,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function isTicketAssigned(ticket: Ticket): boolean {
  return Boolean(ticket.assignedExecutiveId || ticket.assignedExecutive.trim());
}

export function isAgingUnresolved(ticket: Ticket, now = Date.now()): boolean {
  if (ticket.status === "Resolved") return false;
  const created = new Date(ticket.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now - created >= AGING_THRESHOLD_MS;
}

export function ticketMatchesInboxView(
  ticket: Ticket,
  view: InboxView,
  staffUserId: string,
  staffFullName: string,
  pendingReplyIds?: Set<string>,
): boolean {
  switch (view) {
    case "all-active":
      return ticket.status !== "Resolved";
    case "my-tickets": {
      const matchesId =
        !!ticket.assignedExecutiveId &&
        ticket.assignedExecutiveId === staffUserId;
      const matchesName =
        !!staffFullName &&
        ticket.assignedExecutive.toLowerCase() === staffFullName.toLowerCase();
      return matchesId || matchesName;
    }
    case "unassigned":
      return !isTicketAssigned(ticket);
    case "open":
      return ticket.status === "Open";
    case "in-progress":
      return ticket.status === "In Progress";
    case "waiting":
      return ticket.status === "Waiting";
    case "urgent":
      return ticket.priority === "Urgent" && ticket.status !== "Resolved";
    case "pending-reply":
      return pendingReplyIds?.has(ticket.id) ?? false;
    case "resolved":
      return ticket.status === "Resolved";
    default:
      return true;
  }
}

export function countTicketsForView(
  tickets: Ticket[],
  view: InboxView,
  staffUserId: string,
  staffFullName: string,
  pendingReplyIds?: Set<string>,
): number {
  return tickets.filter((ticket) =>
    ticketMatchesInboxView(
      ticket,
      view,
      staffUserId,
      staffFullName,
      pendingReplyIds,
    ),
  ).length;
}

export function ticketAgeLabel(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "Unknown age";
  const diffMs = Date.now() - created;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

export function averageResolutionHours(tickets: Ticket[]): number | null {
  const resolved = tickets.filter(
    (ticket) => ticket.status === "Resolved" && ticket.resolvedAt,
  );
  if (resolved.length === 0) return null;

  let total = 0;
  let counted = 0;
  for (const ticket of resolved) {
    const start = new Date(ticket.createdAt).getTime();
    const end = new Date(ticket.resolvedAt as string).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    total += (end - start) / 3600000;
    counted += 1;
  }

  if (counted === 0) return null;
  return total / counted;
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

export type { CampaignRecord, CreatorRecord };
