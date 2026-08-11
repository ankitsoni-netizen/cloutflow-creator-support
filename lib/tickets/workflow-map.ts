import type { TicketStatus } from "@/lib/types";
import type { DbTicketStatus } from "@/lib/tickets/types";
import type {
  CommentVisibility,
  DeliveryStatus,
  StaffOption,
  TicketComment,
  TicketEvent,
} from "@/lib/tickets/workflow-types";

export function uiStatusToDb(status: TicketStatus): DbTicketStatus {
  switch (status) {
    case "In Progress":
      return "in_progress";
    case "Waiting":
      return "waiting";
    case "Resolved":
      return "resolved";
    case "Open":
    default:
      return "open";
  }
}

export function mapDbComment(row: {
  id: string;
  ticket_id: string;
  author_user_id: string | null;
  author_name: string;
  visibility: string;
  comment_text: string;
  send_to_creator: boolean;
  delivery_status: string | null;
  created_at: string;
}): TicketComment {
  const visibility: CommentVisibility =
    row.visibility === "creator" ? "creator" : "internal";

  let deliveryStatus: DeliveryStatus | null = null;
  if (
    row.delivery_status === "pending" ||
    row.delivery_status === "sent" ||
    row.delivery_status === "delivered" ||
    row.delivery_status === "failed"
  ) {
    deliveryStatus = row.delivery_status;
  }

  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    visibility,
    commentText: row.comment_text,
    sendToCreator: row.send_to_creator,
    deliveryStatus,
    createdAt: row.created_at,
  };
}

export function mapDbEvent(row: {
  id: string;
  ticket_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  event_data: Record<string, unknown> | null;
  created_at: string;
}): TicketEvent {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    eventData: row.event_data ?? {},
    createdAt: row.created_at,
  };
}

export function mapStaffOption(row: {
  user_id: string;
  full_name: string | null;
  role: string | null;
  team: string | null;
}): StaffOption | null {
  const fullName = row.full_name?.trim();
  if (!fullName) return null;
  return {
    userId: row.user_id,
    fullName,
    role: row.role,
    team: row.team,
  };
}
