import type { CampaignRecord, Ticket } from "@/lib/types";
import { uniqueSorted } from "@/lib/utils";

function classifyIssue(issueType: string): "payment" | "tax" | "conduct" | "other" {
  const value = issueType.toLowerCase();
  if (
    value.includes("payment") ||
    value.includes("payout") ||
    value.includes("invoice") ||
    value.includes("bank")
  ) {
    return "payment";
  }
  if (
    value.includes("tds") ||
    value.includes("gst") ||
    value.includes("tax") ||
    value.includes("form 16")
  ) {
    return "tax";
  }
  if (
    value.includes("conduct") ||
    value.includes("poc") ||
    value.includes("escalat") ||
    value.includes("behaviour") ||
    value.includes("behavior")
  ) {
    return "conduct";
  }
  return "other";
}

export function campaignIdentityKey(ticket: Ticket): string {
  const campaign = ticket.campaignName.trim().toLowerCase() || "unknown-campaign";
  const brand = ticket.brand.trim().toLowerCase() || "unknown-brand";
  const month = ticket.campaignMonth.trim().toLowerCase() || "unknown-month";
  return `${campaign}::${brand}::${month}`;
}

/**
 * Campaign intelligence derived from ticket fields only.
 * No separate campaigns table is used in this phase.
 */
export function buildCampaignRecords(tickets: Ticket[]): CampaignRecord[] {
  const groups = new Map<string, Ticket[]>();

  for (const ticket of tickets) {
    const key = campaignIdentityKey(ticket);
    const list = groups.get(key) ?? [];
    list.push(ticket);
    groups.set(key, list);
  }

  const records: CampaignRecord[] = [];

  for (const [id, group] of groups) {
    const sample = group[0];
    const unresolved = group.filter((ticket) => ticket.status !== "Resolved");
    const oldestUnresolvedAt =
      unresolved.length === 0
        ? null
        : unresolved
            .map((ticket) => ticket.createdAt)
            .sort(
              (a, b) => new Date(a).getTime() - new Date(b).getTime(),
            )[0] ?? null;

    records.push({
      id,
      campaignName: sample?.campaignName.trim() || "Unknown campaign",
      brand: sample?.brand.trim() || "Unknown brand",
      campaignMonth: sample?.campaignMonth.trim() || "Not provided",
      pocs: uniqueSorted(group.map((ticket) => ticket.cloutflowPoc)),
      teams: uniqueSorted(group.map((ticket) => ticket.assignedTeam)),
      ticketCount: group.length,
      openCount: unresolved.length,
      paymentCount: group.filter(
        (ticket) => classifyIssue(ticket.issueType) === "payment",
      ).length,
      taxCount: group.filter(
        (ticket) => classifyIssue(ticket.issueType) === "tax",
      ).length,
      conductCount: group.filter(
        (ticket) => classifyIssue(ticket.issueType) === "conduct",
      ).length,
      oldestUnresolvedAt,
      tickets: [...group].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    });
  }

  return records.sort((a, b) => b.openCount - a.openCount || b.ticketCount - a.ticketCount);
}

export function campaignMatchesSearch(
  campaign: CampaignRecord,
  query: string,
): boolean {
  if (!query) return true;
  const haystack = [
    campaign.campaignName,
    campaign.brand,
    campaign.campaignMonth,
    ...campaign.pocs,
    ...campaign.teams,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
