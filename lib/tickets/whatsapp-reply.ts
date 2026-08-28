import "server-only";

import { sendInstagramCreatorReplyEmail } from "@/lib/email/instagram-ticket-mail";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  createAdminInstagramStore,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import { sendWhatsAppProviderText } from "@/lib/meta/whatsapp-provider";
import { COLLABORATION_IDLE_MS } from "@/lib/meta/conversation-machine";
import { WHATSAPP_MESSAGING_WINDOW_STAFF_WARNING } from "@/lib/meta/routing-copy";
import { channelCrmReplyKey } from "@/lib/meta/prompt-keys";
import { toPlainTicketDescription } from "@/lib/meta/plain-text";
import type { DbTicket } from "@/lib/tickets/types";
import {
  getWatiChannelPhoneNumber,
  resolveWhatsAppProvider,
} from "@/lib/wati/config";

export type WhatsAppStaffReplyResult =
  | {
      ok: true;
      whatsapp: "sent" | "failed" | "skipped";
      email: "sent" | "failed" | "skipped";
      whatsappErrorCode?: string | null;
      messagingWindowExpired?: boolean;
      alreadySent?: boolean;
    }
  | { ok: false; error: string; errorCode: string };

function recipientFromTicket(ticket: DbTicket): string | null {
  const waId = ticket.external_contact_id?.trim() ?? "";
  if (/^\d{6,20}$/.test(waId)) return waId;
  return null;
}

export function isWhatsAppTicket(ticket: DbTicket): boolean {
  return ticket.source_channel?.trim().toLowerCase() === "whatsapp";
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

export async function sendStaffWhatsAppReply(input: {
  ticket: DbTicket;
  commentId: string;
  commentText: string;
  store?: InstagramIngestStore;
  allowResolvedTicket?: boolean;
  skipWhatsAppDelivery?: boolean;
}): Promise<WhatsAppStaffReplyResult> {
  if (!isWhatsAppTicket(input.ticket)) {
    return { ok: false, error: "This ticket is not a WhatsApp ticket.", errorCode: "not_whatsapp" };
  }
  const statusAllowed =
    isActiveTicketStatus(input.ticket.status) ||
    (input.allowResolvedTicket === true &&
      input.ticket.status.trim().toLowerCase() === "resolved");
  if (!statusAllowed) {
    return {
      ok: false,
      error: "Replies can only be sent on an active WhatsApp ticket.",
      errorCode: "ticket_not_active",
    };
  }

  const recipientId = recipientFromTicket(input.ticket);
  if (!recipientId) {
    return {
      ok: false,
      error: "This ticket is missing a valid WhatsApp recipient.",
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
      error: "WhatsApp sending is temporarily unavailable.",
      errorCode: "admin_client_missing",
    };
  }

  const conversation =
    input.ticket.external_conversation_id
      ? await store.getConversation("whatsapp", input.ticket.external_conversation_id)
      : null;
  if (conversation && "errorCode" in conversation) {
    return {
      ok: false,
      error: "Unable to load the WhatsApp conversation.",
      errorCode: conversation.errorCode,
    };
  }

  const conversationId = conversation?.id;
  if (!conversationId) {
    return {
      ok: false,
      error: "Unable to find the WhatsApp conversation for this ticket.",
      errorCode: "conversation_missing",
    };
  }

  if (input.skipWhatsAppDelivery === true) {
    const emailClaim = await store.claimEmailDelivery({
      ticketId: input.ticket.id,
      conversationId,
      commentId: input.commentId,
      purpose: "whatsapp-staff-reply",
      idempotencyKey: `email:wa-crm:${input.commentId}`,
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
      whatsapp: "sent",
      email,
      alreadySent: true,
    };
  }

  if (conversation.externalContactId && conversation.externalContactId !== recipientId) {
    return {
      ok: false,
      error: "WhatsApp recipient does not match this conversation.",
      errorCode: "recipient_mismatch",
    };
  }

  const windowOpen = messagingWindowOpen(conversation.lastActivityAt);
  const idempotencyKey = channelCrmReplyKey("wa", input.commentId);
  const provider = resolveWhatsAppProvider();
  const businessAddress =
    provider.ok && provider.provider === "wati"
      ? (getWatiChannelPhoneNumber() ?? undefined)
      : undefined;
  const claimed = await store.claimOutboundMessage({
    conversationId,
    ticketId: input.ticket.id,
    channel: "whatsapp",
    recipientExternalId: recipientId,
    senderAddress: businessAddress,
    messageBody: text,
    idempotencyKey,
    purpose: "staff_reply",
    commentId: input.commentId,
  });

  if (claimed.outcome === "failed") {
    return {
      ok: false,
      error: "Unable to queue the WhatsApp reply.",
      errorCode: claimed.errorCode,
    };
  }

  if (
    claimed.outcome === "duplicate" &&
    (claimed.deliveryStatus === "sent" ||
      claimed.deliveryStatus === "delivered" ||
      claimed.deliveryStatus === "read")
  ) {
    const emailClaim = await store.claimEmailDelivery({
      ticketId: input.ticket.id,
      conversationId,
      commentId: input.commentId,
      purpose: "whatsapp-staff-reply",
      idempotencyKey: `email:wa-crm:${input.commentId}`,
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
      whatsapp: "sent",
      email,
      alreadySent: true,
    };
  }

  const outboundId = claimed.id;
  if (!windowOpen) {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "failed",
      deliveryErrorCode: "outside_customer_service_window",
    });
    const emailClaim = await store.claimEmailDelivery({
      ticketId: input.ticket.id,
      conversationId,
      commentId: input.commentId,
      purpose: "whatsapp-staff-reply",
      idempotencyKey: `email:wa-crm:${input.commentId}`,
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
    }
    return {
      ok: true,
      whatsapp: "failed",
      email,
      whatsappErrorCode: "outside_customer_service_window",
      messagingWindowExpired: true,
    };
  }

  const sent = await sendWhatsAppProviderText({
    recipientId,
    text,
  });
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
    purpose: "whatsapp-staff-reply",
    idempotencyKey: `email:wa-crm:${input.commentId}`,
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
      whatsapp: "failed",
      email,
      whatsappErrorCode: sent.errorCode,
      messagingWindowExpired: sent.messagingWindowExpired || !windowOpen,
    };
  }

  return {
    ok: true,
    whatsapp: "sent",
    email,
    messagingWindowExpired: !windowOpen,
  };
}

export function staffWhatsAppWindowWarning(open: boolean): string | null {
  return open ? null : WHATSAPP_MESSAGING_WINDOW_STAFF_WARNING;
}
