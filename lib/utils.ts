import type { Ticket, TicketPriority, TicketStatus } from "./types";

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date("2026-08-11T12:00:00+05:30");
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

export function nextTicketNumber(tickets: Ticket[]): string {
  const currentYear = new Date().getFullYear();
  let highest = 0;

  for (const ticket of tickets) {
    const sections = ticket.ticketNumber.split("-");
    const numericSection = sections[sections.length - 1];
    const value = Number(numericSection);
    if (!Number.isNaN(value) && value > highest) {
      highest = value;
    }
  }

  const paddedNumber = String(highest + 1).padStart(5, "0");
  return `CF-${currentYear}-${paddedNumber}`;
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
