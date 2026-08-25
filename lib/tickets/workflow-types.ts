import type { Ticket, TicketStatus } from "@/lib/types";

export type CommentVisibility = "internal" | "creator";
export type DeliveryStatus = "pending" | "sent" | "delivered" | "failed";

export interface TicketComment {
  id: string;
  ticketId: string;
  authorUserId: string | null;
  authorName: string;
  visibility: CommentVisibility;
  commentText: string;
  sendToCreator: boolean;
  deliveryStatus: DeliveryStatus | null;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  ticketId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string | null;
  actorName: string | null;
  eventData: Record<string, unknown>;
  createdAt: string;
}

export interface StaffOption {
  userId: string;
  fullName: string;
  role: string | null;
  team: string | null;
}

export type TimelineKind =
  | "ticket_created"
  | "status_changed"
  | "assignment_changed"
  | "internal_note"
  | "creator_reply"
  | "resolution"
  | "acknowledgement_email"
  | "instagram_inbound"
  | "instagram_outbound"
  | "other_event";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  timestamp: string;
  actor: string;
  title: string;
  detail?: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  deliveryStatus?: DeliveryStatus | null;
  visibilityLabel?: "Internal Note" | "Creator Reply" | "Resolution Email" | "Instagram";
  commentId?: string;
  canRetryEmail?: boolean;
  canRetryInstagram?: boolean;
  channelMessageId?: string;
}

export type AcknowledgementEmailOutcome = "sent" | "skipped" | "failed";

export type CreateTicketActionResult =
  | {
      ticket: Ticket;
      acknowledgement: AcknowledgementEmailOutcome;
      acknowledgementMessage?: string;
    }
  | { error: string };

export type CreatorReplyActionResult =
  | {
      data: TicketComment;
      ticket: Ticket;
      delivery: "sent" | "failed";
      deliveryMessage?: string;
      instagramDelivery?: "sent" | "failed" | "skipped";
      messagingWindowWarning?: string | null;
    }
  | { error: string };

export type ResolveTicketActionResult =
  | {
      data: Ticket;
      resolutionEmail: "sent" | "failed" | "skipped";
      resolutionEmailMessage?: string;
      comment?: TicketComment;
    }
  | { error: string };

export interface StatusUpdateInput {
  ticketId: string;
  status: Exclude<TicketStatus, "Resolved">;
}

export interface ResolveTicketInput {
  ticketId: string;
  resolutionSummary: string;
}

export interface AssignmentInput {
  ticketId: string;
  /** Active staff user_id, or null/empty to unassign. */
  assigneeUserId: string | null;
}

export type MutationResult<T> = { data: T } | { error: string };

export type TicketMutationResult = MutationResult<Ticket>;
export type CommentMutationResult = MutationResult<TicketComment>;
