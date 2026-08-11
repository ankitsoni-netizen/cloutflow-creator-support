import type { TicketPriority, TicketStatus } from "./types";

const DISPLAY_TIMEZONE = "Asia/Kolkata";

const kolkataDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
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

export function priorityClass(priority: TicketPriority): string {
  switch (priority) {
    case "Urgent":
      return "bg-red-50 text-red-700 ring-red-200";
    case "High":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "Low":
      return "bg-slate-50 text-slate-600 ring-slate-200";
    default:
      return "bg-blue-50 text-blue-700 ring-blue-200";
  }
}

export function statusClass(status: TicketStatus): string {
  switch (status) {
    case "Open":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "In Progress":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    case "Waiting":
      return "bg-orange-50 text-orange-700 ring-orange-200";
    case "Resolved":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    default:
      return "bg-slate-50 text-slate-600 ring-slate-200";
  }
}

export function matchesStatusFilter(
  status: TicketStatus,
  filter: string,
): boolean {
  if (filter === "All") return true;
  return status === filter;
}
