import type { ConversationIdentity } from "@/lib/meta/conversation-identity";
import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";

export const POST_TICKET_STATE = "awaiting_post_completion";

/** Intake states that must never survive after a ticket insert commits. */
export const INTAKE_STATES_BLOCKED_AFTER_TICKET: ReadonlySet<string> = new Set([
  "awaiting_persona",
  "awaiting_creator_reason",
  "awaiting_creator_issue_category",
  "creator_campaign_details",
  "awaiting_month_confirmation",
  "creator_issue_details",
  "creator_confirmation",
  "brand_action",
  "agency_details",
  "agency_confirmation",
  "other_inquiry",
  "other_contact",
  "other_confirmation",
]);

export type ResolvedActiveTicket = {
  ticketId: string | null;
  status: string | null;
  ticketCode: string | null;
};

export type TicketFinalizationSnapshot = {
  ticketId: string;
  ticketCode: string | null;
  lastPromptKey: string;
};

/**
 * Force the working snapshot onto the only legal post-commit path.
 * Does not clear collected fields; identity stays on the conversation row.
 */
export function bindCommittedTicketSnapshot(
  snapshot: ConversationSnapshot,
  ticket: TicketFinalizationSnapshot,
): ConversationSnapshot {
  return {
    ...snapshot,
    ticketId: ticket.ticketId,
    ticketCode: ticket.ticketCode,
    ticketStatus:
      snapshot.ticketStatus && isActiveTicketStatus(snapshot.ticketStatus)
        ? snapshot.ticketStatus
        : "open",
    state: POST_TICKET_STATE,
    currentIntakeField: null,
    lastPromptKey: ticket.lastPromptKey,
  };
}

/**
 * Hydrate an inbound working snapshot. A linked or exact active ticket wins
 * over leftover creator_confirmation / month / details / persona states.
 */
export function bindActiveTicketToWorkingSnapshot(
  snapshot: ConversationSnapshot,
  ticketInfo: ResolvedActiveTicket,
): ConversationSnapshot {
  const next: ConversationSnapshot = {
    ...snapshot,
    ticketId: ticketInfo.ticketId,
    ticketStatus: ticketInfo.status,
    ticketCode: ticketInfo.ticketCode ?? snapshot.ticketCode,
  };
  if (
    ticketInfo.ticketId &&
    isActiveTicketStatus(ticketInfo.status) &&
    INTAKE_STATES_BLOCKED_AFTER_TICKET.has(next.state)
  ) {
    next.state = POST_TICKET_STATE;
  }
  return next;
}

/**
 * Prefer the conversation's committed ticket_id when that ticket is still
 * active. Do not nullify a valid link just because identity lookup missed.
 * Relink only when the conversation has no active link.
 */
export async function resolveActiveTicketForConversation(input: {
  store: InstagramIngestStore;
  identity: ConversationIdentity;
  conversationTicketId: string | null;
  sourceChannel: "instagram" | "whatsapp";
}): Promise<ResolvedActiveTicket | { errorCode: string }> {
  if (input.conversationTicketId) {
    const linked = await input.store.getTicket(input.conversationTicketId);
    if (linked && "errorCode" in linked) {
      return { errorCode: linked.errorCode };
    }
    if (linked && isActiveTicketStatus(linked.status)) {
      return {
        ticketId: linked.id,
        status: linked.status,
        ticketCode: linked.ticketCode ?? null,
      };
    }
  }

  const found = await input.store.findActiveInstagramTicket({
    externalConversationId: input.identity.externalConversationId,
    externalContactId: input.identity.externalContactId,
    sourceChannel: input.sourceChannel,
    provider: input.identity.provider,
    recipientAccountId: input.identity.recipientAccountId,
  });
  if (found && "errorCode" in found) {
    return { errorCode: found.errorCode };
  }
  if (found && isActiveTicketStatus(found.status)) {
    return {
      ticketId: found.id,
      status: found.status,
      ticketCode: found.ticketCode ?? null,
    };
  }
  return {
    ticketId: null,
    status: found?.status ?? null,
    ticketCode: found?.ticketCode ?? null,
  };
}
