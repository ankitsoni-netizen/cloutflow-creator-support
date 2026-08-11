import type { Ticket } from "@/lib/types";
import {
  AGING_THRESHOLD_MS,
  isAgingUnresolved,
  isTicketAssigned,
} from "@/lib/utils";

export type AttentionReason =
  | "Urgent priority"
  | "Unassigned"
  | "Aging unresolved"
  | "Waiting on creator/process"
  | "Pending creator reply";

export interface AttentionItem {
  ticket: Ticket;
  reasons: AttentionReason[];
}

export function buildNeedsAttentionQueue(
  tickets: Ticket[],
  pendingReplyIds: Set<string>,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const ticket of tickets) {
    if (ticket.status === "Resolved") continue;
    const reasons: AttentionReason[] = [];

    if (ticket.priority === "Urgent") reasons.push("Urgent priority");
    if (!isTicketAssigned(ticket)) reasons.push("Unassigned");
    if (isAgingUnresolved(ticket)) reasons.push("Aging unresolved");
    if (ticket.status === "Waiting") reasons.push("Waiting on creator/process");
    if (pendingReplyIds.has(ticket.id)) reasons.push("Pending creator reply");

    if (reasons.length > 0) {
      items.push({ ticket, reasons });
    }
  }

  return items.sort((a, b) => {
    if (b.reasons.length !== a.reasons.length) {
      return b.reasons.length - a.reasons.length;
    }
    return (
      new Date(a.ticket.createdAt).getTime() -
      new Date(b.ticket.createdAt).getTime()
    );
  });
}

export function countByStatus(tickets: Ticket[]) {
  return {
    open: tickets.filter((ticket) => ticket.status === "Open").length,
    inProgress: tickets.filter((ticket) => ticket.status === "In Progress")
      .length,
    waiting: tickets.filter((ticket) => ticket.status === "Waiting").length,
    resolved: tickets.filter((ticket) => ticket.status === "Resolved").length,
    urgent: tickets.filter(
      (ticket) =>
        ticket.priority === "Urgent" && ticket.status !== "Resolved",
    ).length,
    unassigned: tickets.filter(
      (ticket) => ticket.status !== "Resolved" && !isTicketAssigned(ticket),
    ).length,
    aging: tickets.filter((ticket) => isAgingUnresolved(ticket)).length,
  };
}

export function executiveWorkload(tickets: Ticket[]) {
  const map = new Map<string, { name: string; open: number; total: number }>();

  for (const ticket of tickets) {
    const key =
      ticket.assignedExecutiveId ||
      ticket.assignedExecutive.trim() ||
      "unassigned";
    const name = ticket.assignedExecutive.trim() || "Unassigned";
    const current = map.get(key) ?? { name, open: 0, total: 0 };
    current.total += 1;
    if (ticket.status !== "Resolved") current.open += 1;
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => b.open - a.open);
}

export function distribution(
  tickets: Ticket[],
  getKey: (ticket: Ticket) => string,
) {
  const map = new Map<string, number>();
  for (const ticket of tickets) {
    const key = getKey(ticket).trim() || "Unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export { AGING_THRESHOLD_MS };
