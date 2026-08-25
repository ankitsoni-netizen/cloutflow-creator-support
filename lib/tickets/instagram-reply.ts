import "server-only";

import { sendInstagramCreatorReplyEmail } from "@/lib/email/instagram-ticket-mail";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  createAdminInstagramStore,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import { sendInstagramText } from "@/lib/meta/instagram-send";
import { COLLABORATION_IDLE_MS } from "@/lib/meta/conversation-machine";
import { MESSAGING_WINDOW_STAFF_WARNING } from "@/lib/meta/routing-copy";
import { toPlainTicketDescription } from "@/lib/meta/plain-text";
import type { DbTicket } from "@/lib/tickets/types";

export type InstagramStaffReplyResult =
  | {
      ok: true;
      instagram: "sent" | "failed" | "skipped";
      email: "sent" | "failed" | "skipped";
      instagramErrorCode?: string | null;
      messagingWindowExpired?: boolean;
      alreadySent?: boolean;
    }
  | { ok: false; error: string; errorCode: string };

function recipientFromTicket(ticket: DbTicket): string | null {
  const igsid = ticket.external_contact_id?.trim() ?? "";
  if (/^\d+$/.test(igsid)) return igsid;
  return null;
}

export function isInstagramTicket(ticket: DbTicket): boolean {
  return ticket.source_channel?.trim().toLowerCase() === "instagram";
}

export function messagingWindowOpen(
  lastInboundAt: string | null,
  now = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const last = Date.parse(lastInboundAt);
  if (!Number.isFinite(last)) return false;
  return now - last < COLLABORATION_IDLE_MS;
}

export async function sendStaffInstagramReply(input: {
  ticket: DbTicket;
  commentId: string;
  commentText: string;
  store?: InstagramIngestStore;
}): Promise<InstagramStaffReplyResult> {
  if (!isInstagramTicket(input.ticket)) {
    return { ok: false, error: "This ticket is not an Instagram ticket.", errorCode: "not_instagram" };
  }
  if (!isActiveTicketStatus(input.ticket.status)) {
    return {
      ok: false,
      error: "Replies can only be sent on an active Instagram ticket.",
      errorCode: "ticket_not_active",
    };
  }

  const recipientId = recipientFromTicket(input.ticket);
  if (!recipientId) {
    return {
      ok: false,
      error: "This ticket is missing a valid Instagram recipient.",
      errorCode: "invalid_recipient",
    };
  }

  const text = toPlainTicketDescription(input.commentText);
  if (!text) {
    return {
      ok: false,
      error: "Creator reply cannot be empty.",
      errorCode: "empty_reply",
    };
  }

  let store: InstagramIngestStore;
  try {
    store = input.store ?? createAdminInstagramStore();
  } catch {
    return {
      ok: false,
      error: "Instagram sending is temporarily unavailable.",
      errorCode: "admin_client_missing",
    };
  }

  const conversation =
    input.ticket.external_conversation_id
      ? await store.getConversation("instagram", input.ticket.external_conversation_id)
      : null;
  if (conversation && "errorCode" in conversation) {
    return {
      ok: false,
      error: "Unable to load the Instagram conversation.",
      errorCode: conversation.errorCode,
    };
  }

  const conversationId = conversation?.id;
  if (!conversationId) {
    return {
      ok: false,
      error: "Unable to find the Instagram conversation for this ticket.",
      errorCode: "conversation_missing",
    };
  }

  if (conversation.externalContactId && conversation.externalContactId !== recipientId) {
    return {
      ok: false,
      error: "Instagram recipient does not match this conversation.",
      errorCode: "recipient_mismatch",
    };
  }

  const windowOpen = messagingWindowOpen(conversation.lastActivityAt);
  const claimed = await store.claimOutboundMessage({
    conversationId,
    ticketId: input.ticket.id,
    channel: "instagram",
    recipientExternalId: recipientId,
    messageBody: text,
    idempotencyKey: `ig:crm:${input.commentId}`,
    purpose: "staff_reply",
    commentId: input.commentId,
  });

  if (claimed.outcome === "failed") {
    return {
      ok: false,
      error: "Unable to queue the Instagram reply.",
      errorCode: claimed.errorCode,
    };
  }

  if (
    claimed.outcome === "duplicate" &&
    (claimed.deliveryStatus === "sent" || claimed.deliveryStatus === "delivered")
  ) {
    const emailClaim = await store.claimEmailDelivery({
      ticketId: input.ticket.id,
      conversationId,
      commentId: input.commentId,
      purpose: "instagram-staff-reply",
      idempotencyKey: `email:ig-crm:${input.commentId}`,
    });
    let email: "sent" | "failed" | "skipped" = "skipped";
    if (emailClaim.outcome === "claimed") {
      const mailed = await sendInstagramCreatorReplyEmail({
        ticket: input.ticket,
        commentText: text,
      });
      email =
        mailed.outcome === "sent"
          ? "sent"
          : mailed.outcome === "skipped"
            ? "skipped"
            : "failed";
      await store.markEmailDelivery(emailClaim.id, {
        deliveryStatus:
          mailed.outcome === "sent"
            ? "sent"
            : mailed.outcome === "skipped"
              ? "skipped"
              : "failed",
        brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
        errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
      });
    } else if (emailClaim.outcome === "duplicate" && emailClaim.deliveryStatus === "sent") {
      email = "sent";
    }
    return {
      ok: true,
      instagram: "sent",
      email,
      alreadySent: true,
    };
  }

  const outboundId = claimed.id;
  const sent = await sendInstagramText({ recipientId, text });
  if (sent.ok) {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "sent",
      externalMessageId: sent.metaMessageId,
      deliveryErrorCode: null,
    });
  } else {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "failed",
      deliveryErrorCode: sent.errorCode,
    });
  }

  const emailClaim = await store.claimEmailDelivery({
    ticketId: input.ticket.id,
    conversationId,
    commentId: input.commentId,
    purpose: "instagram-staff-reply",
    idempotencyKey: `email:ig-crm:${input.commentId}`,
  });
  let email: "sent" | "failed" | "skipped" = "skipped";
  if (emailClaim.outcome === "claimed") {
    const mailed = await sendInstagramCreatorReplyEmail({
      ticket: input.ticket,
      commentText: text,
    });
    email =
      mailed.outcome === "sent"
        ? "sent"
        : mailed.outcome === "skipped"
          ? "skipped"
          : "failed";
    await store.markEmailDelivery(emailClaim.id, {
      deliveryStatus:
        mailed.outcome === "sent"
          ? "sent"
          : mailed.outcome === "skipped"
            ? "skipped"
            : "failed",
      brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
      errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
    });
  } else if (emailClaim.outcome === "duplicate" && emailClaim.deliveryStatus === "sent") {
    email = "sent";
  }

  if (!sent.ok) {
    return {
      ok: true,
      instagram: "failed",
      email,
      instagramErrorCode: sent.errorCode,
      messagingWindowExpired: sent.messagingWindowExpired || !windowOpen,
    };
  }

  return {
    ok: true,
    instagram: "sent",
    email,
    messagingWindowExpired: !windowOpen,
  };
}

export function staffInstagramWindowWarning(open: boolean): string | null {
  return open ? null : MESSAGING_WINDOW_STAFF_WARNING;
}
