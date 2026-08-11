import type { CreatorRecord, Ticket } from "@/lib/types";
import { normalizePhone, uniqueSorted } from "@/lib/utils";

/**
 * Group tickets into creator records using the strongest available identifier.
 * Never merge on name alone.
 */
export function buildCreatorRecords(tickets: Ticket[]): CreatorRecord[] {
  const groups = new Map<string, Ticket[]>();

  for (const ticket of tickets) {
    const key = creatorIdentityKey(ticket);
    const list = groups.get(key) ?? [];
    list.push(ticket);
    groups.set(key, list);
  }

  const records: CreatorRecord[] = [];

  for (const [id, group] of groups) {
    const sorted = [...group].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const latest = sorted[0];
    records.push({
      id,
      displayName: latest?.creatorName.trim() || "Unknown creator",
      phones: uniqueSorted(group.map((ticket) => ticket.phone)),
      emails: uniqueSorted(group.map((ticket) => ticket.email)),
      handles: uniqueSorted(group.map((ticket) => ticket.socialHandle)),
      platforms: uniqueSorted(group.map((ticket) => ticket.platform)),
      brands: uniqueSorted(group.map((ticket) => ticket.brand)),
      campaigns: uniqueSorted(group.map((ticket) => ticket.campaignName)),
      pocs: uniqueSorted(group.map((ticket) => ticket.cloutflowPoc)),
      ticketCount: group.length,
      openCount: group.filter((ticket) => ticket.status !== "Resolved").length,
      resolvedCount: group.filter((ticket) => ticket.status === "Resolved")
        .length,
      waitingCount: group.filter((ticket) => ticket.status === "Waiting")
        .length,
      tickets: sorted,
      latestUpdatedAt: latest?.updatedAt ?? new Date(0).toISOString(),
    });
  }

  return records.sort(
    (a, b) =>
      new Date(b.latestUpdatedAt).getTime() -
      new Date(a.latestUpdatedAt).getTime(),
  );
}

export function creatorIdentityKey(ticket: Ticket): string {
  const phone = normalizePhone(ticket.phone);
  if (phone.length >= 8) return `phone:${phone}`;

  const email = ticket.email.trim().toLowerCase();
  if (email.includes("@")) return `email:${email}`;

  const handle = ticket.socialHandle.trim().toLowerCase().replace(/^@/, "");
  if (handle) return `handle:${handle}`;

  // Last resort: isolate by ticket so same names are never merged.
  return `ticket:${ticket.id}`;
}

export function creatorMatchesSearch(
  creator: CreatorRecord,
  query: string,
): boolean {
  if (!query) return true;
  const haystack = [
    creator.displayName,
    ...creator.phones,
    ...creator.emails,
    ...creator.handles,
    ...creator.brands,
    ...creator.campaigns,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
