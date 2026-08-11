import type {
  TicketComment,
  TicketEvent,
  TimelineItem,
} from "@/lib/tickets/workflow-types";

function statusLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  switch (value.toLowerCase()) {
    case "open":
      return "Open";
    case "in_progress":
    case "in progress":
      return "In Progress";
    case "waiting":
      return "Waiting";
    case "resolved":
      return "Resolved";
    default:
      return value;
  }
}

function readString(
  data: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function hasAssignmentIdentity(
  data: Record<string, unknown>,
  nameKeys: string[],
  idKeys: string[],
): boolean {
  if (readString(data, ...nameKeys)) return true;
  for (const key of idKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return true;
    if (typeof value === "number") return true;
  }
  return false;
}

function describeEvent(event: TicketEvent): TimelineItem {
  const data = event.eventData ?? {};
  const actor = event.actorName?.trim() || "System";
  const base = {
    id: `event-${event.id}`,
    timestamp: event.createdAt,
    actor,
  };

  switch (event.eventType) {
    case "ticket_created":
    case "created": {
      const createdStatus = statusLabel(
        event.toStatus ?? readString(data, "status", "to_status") ?? "open",
      );
      return {
        ...base,
        kind: "ticket_created",
        title: `Ticket created with status ${createdStatus}`,
      };
    }
    case "status_changed":
    case "status_change": {
      const from = statusLabel(event.fromStatus);
      const to = statusLabel(event.toStatus);
      const resolved = event.toStatus?.toLowerCase() === "resolved";
      return {
        ...base,
        kind: resolved ? "resolution" : "status_changed",
        title: resolved
          ? "Ticket resolved"
          : `Status changed: ${from} → ${to}`,
        detail: resolved
          ? (readString(data, "resolution_summary") ?? undefined)
          : undefined,
      };
    }
    case "assignment_changed":
    case "assignment_change": {
      const previousName = readString(
        data,
        "previous_executive_name",
        "from_executive_name",
      );
      const nextName = readString(
        data,
        "new_executive_name",
        "to_executive_name",
      );
      const hadPrevious = hasAssignmentIdentity(
        data,
        ["previous_executive_name", "from_executive_name"],
        ["previous_executive_id", "from_executive_id"],
      );
      const hasNext = hasAssignmentIdentity(
        data,
        ["new_executive_name", "to_executive_name"],
        ["new_executive_id", "to_executive_id"],
      );

      let title: string;
      if (hadPrevious && hasNext) {
        title = `Assigned from ${previousName ?? "previous executive"} to ${nextName ?? "new executive"}`;
      } else if (!hadPrevious && hasNext) {
        title = `Assigned to ${nextName ?? "executive"}`;
      } else if (hadPrevious && !hasNext) {
        title = `Unassigned from ${previousName ?? "previous executive"}`;
      } else {
        title = "Assignment updated";
      }

      return {
        ...base,
        kind: "assignment_changed",
        title,
      };
    }
    case "resolved":
    case "ticket_resolved":
      return {
        ...base,
        kind: "resolution",
        title: "Ticket resolved",
        detail: readString(data, "resolution_summary") ?? undefined,
      };
    default:
      return {
        ...base,
        kind: "other_event",
        title: event.eventType.replace(/_/g, " "),
        detail: Object.keys(data).length
          ? Object.entries(data)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
              .join(" · ")
          : undefined,
      };
  }
}

function describeComment(comment: TicketComment): TimelineItem {
  const isCreator = comment.visibility === "creator";
  return {
    id: `comment-${comment.id}`,
    kind: isCreator ? "creator_reply" : "internal_note",
    timestamp: comment.createdAt,
    actor: comment.authorName,
    title: isCreator ? "Creator-facing reply queued" : "Internal note added",
    detail: comment.commentText,
    deliveryStatus: comment.deliveryStatus,
    visibilityLabel: isCreator ? "Creator Reply" : "Internal Note",
  };
}

export function buildTimeline(
  events: TicketEvent[],
  comments: TicketComment[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events.map(describeEvent),
    ...comments.map(describeComment),
  ];

  items.sort((a, b) => {
    const diff =
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  return items;
}
