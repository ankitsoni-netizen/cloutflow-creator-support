"use server";

import {
  sendAcknowledgementForTicket,
  sendCreatorReplyEmail,
} from "@/lib/email/ticket-mail";
import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import {
  loadTicketById,
  markTicketCustomerNotified,
  updateCommentDeliveryStatus,
} from "@/lib/tickets/email-delivery";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { isInstagramTicket, sendStaffInstagramReply } from "@/lib/tickets/instagram-reply";
import { isWhatsAppTicket, sendStaffWhatsAppReply } from "@/lib/tickets/whatsapp-reply";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { ticketSelect } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import { COMMENT_SELECT, mapDbComment } from "@/lib/tickets/workflow-map";
import type { Ticket } from "@/lib/types";
import type {
  AcknowledgementEmailOutcome,
  CreatorReplyActionResult,
} from "@/lib/tickets/workflow-types";

export async function retryAcknowledgementEmailAction(input: {
  ticketId: string;
}): Promise<
  | {
      ticket: Ticket;
      acknowledgement: AcknowledgementEmailOutcome;
      acknowledgementMessage?: string;
    }
  | { error: string }
> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const loaded = await loadTicketById(context.supabase, input.ticketId);
  if ("error" in loaded) return { error: loaded.error };

  const ticket = loaded.data;
  if (!ticket.acknowledgement_email_requested) {
    return {
      ticket: mapDbTicketToTicket(ticket),
      acknowledgement: "skipped",
      acknowledgementMessage: "Acknowledgement email was not requested.",
    };
  }

  if (ticket.acknowledgement_email_sent_at) {
    return {
      ticket: mapDbTicketToTicket(ticket),
      acknowledgement: "sent",
      acknowledgementMessage: "Acknowledgement email was already accepted by Brevo.",
    };
  }

  if (!ticket.creator_email?.trim()) {
    return {
      ticket: mapDbTicketToTicket(ticket),
      acknowledgement: "failed",
      acknowledgementMessage: "Creator email is missing or invalid.",
    };
  }

  const sendResult = await sendAcknowledgementForTicket(ticket);
  if (sendResult.outcome !== "sent") {
    return {
      ticket: mapDbTicketToTicket(ticket),
      acknowledgement: sendResult.outcome,
      acknowledgementMessage: sendResult.error,
    };
  }

  const sentAt = new Date().toISOString();
  const { data: updated, error } = await context.supabase
    .from("tickets")
    .update({ acknowledgement_email_sent_at: sentAt })
    .eq("id", ticket.id)
    .select(ticketSelect())
    .single();

  if (error || !updated) {
    if (error) {
      logSupabaseError("acknowledgement_email_sent_at update failed", error);
    }
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Acknowledgement was accepted by Brevo, but the ticket could not be updated.",
    };
  }

  return {
    ticket: mapDbTicketToTicket(updated as DbTicket),
    acknowledgement: "sent",
    acknowledgementMessage: "Acknowledgement email accepted by Brevo.",
  };
}

export async function retryCreatorEmailAction(input: {
  ticketId: string;
  commentId: string;
}): Promise<CreatorReplyActionResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const loadedTicket = await loadTicketById(context.supabase, input.ticketId);
  if ("error" in loadedTicket) return { error: loadedTicket.error };
  const ticket = loadedTicket.data;

  const { data: commentRow, error: commentError } = await context.supabase
    .from("ticket_comments")
    .select(COMMENT_SELECT)
    .eq("id", input.commentId)
    .eq("ticket_id", input.ticketId)
    .single();

  if (commentError || !commentRow) {
    if (commentError) logSupabaseError("retry comment load failed", commentError);
    return {
      error: commentError
        ? toSafeTicketErrorMessage(commentError)
        : "Unable to load the creator email message.",
    };
  }

  const comment = mapDbComment(commentRow);
  if (comment.visibility !== "creator" || !comment.sendToCreator) {
    return { error: "Only creator-facing messages can be emailed." };
  }

  if (isInstagramTicket(ticket)) {
    const ig = await sendStaffInstagramReply({
      ticket,
      commentId: comment.id,
      commentText: comment.commentText,
    });
    if (!ig.ok) {
      return {
        data: comment,
        ticket: mapDbTicketToTicket(ticket),
        delivery: "failed",
        instagramDelivery: "failed",
        deliveryMessage: ig.error,
      };
    }
    const delivery = ig.instagram === "sent" ? "sent" : "failed";
    if (delivery === "sent") {
      await updateCommentDeliveryStatus(context.supabase, comment.id, "sent");
      await markTicketCustomerNotified(context.supabase, ticket);
    }
    return {
      data: comment,
      ticket: mapDbTicketToTicket(ticket),
      delivery,
      instagramDelivery: ig.instagram,
      deliveryMessage:
        delivery === "sent"
          ? "Instagram reply sent."
          : "Instagram delivery failed. You can retry.",
    };
  }

  if (isWhatsAppTicket(ticket)) {
    const wa = await sendStaffWhatsAppReply({
      ticket,
      commentId: comment.id,
      commentText: comment.commentText,
    });
    if (!wa.ok) {
      return {
        data: comment,
        ticket: mapDbTicketToTicket(ticket),
        delivery: "failed",
        whatsappDelivery: "failed",
        deliveryMessage: wa.error,
      };
    }
    const delivery = wa.whatsapp === "sent" ? "sent" : "failed";
    if (delivery === "sent") {
      await updateCommentDeliveryStatus(context.supabase, comment.id, "sent");
      await markTicketCustomerNotified(context.supabase, ticket);
    }
    return {
      data: comment,
      ticket: mapDbTicketToTicket(ticket),
      delivery,
      whatsappDelivery: wa.whatsapp,
      deliveryMessage:
        delivery === "sent"
          ? "WhatsApp reply sent."
          : wa.whatsappErrorCode === "outside_customer_service_window"
            ? "WhatsApp’s customer-service window is closed. This reply was not sent."
            : "WhatsApp delivery failed. You can retry.",
    };
  }

  if (comment.deliveryStatus === "sent" || comment.deliveryStatus === "delivered") {
    return {
      data: comment,
      ticket: mapDbTicketToTicket(ticket),
      delivery: "sent",
      deliveryMessage: "This email was already accepted by Brevo.",
    };
  }

  const sendResult = await sendCreatorReplyEmail({
    ticket,
    commentText: comment.commentText,
  });

  if (!sendResult.ok) {
    const failed = await updateCommentDeliveryStatus(
      context.supabase,
      comment.id,
      "failed",
    );
    return {
      data: "data" in failed ? failed.data : comment,
      ticket: mapDbTicketToTicket(ticket),
      delivery: "failed",
      deliveryMessage: sendResult.error,
    };
  }

  const updatedComment = await updateCommentDeliveryStatus(
    context.supabase,
    comment.id,
    "sent",
  );
  if ("error" in updatedComment) {
    return {
      error: updatedComment.rlsBlocked
        ? "Email was accepted by Brevo, but delivery status could not be saved due to database permissions. See the prepared migration for ticket_comments updates."
        : updatedComment.error,
    };
  }

  const notified = await markTicketCustomerNotified(context.supabase, ticket);
  if ("error" in notified) {
    return {
      data: updatedComment.data,
      ticket: mapDbTicketToTicket(ticket),
      delivery: "sent",
      deliveryMessage:
        "Email accepted by Brevo, but ticket notification timestamps could not be updated.",
    };
  }

  return {
    data: updatedComment.data,
    ticket: notified.data,
    delivery: "sent",
    deliveryMessage: "Email accepted by Brevo.",
  };
}

export async function getEmailChannelStatusAction(): Promise<{
  configured: boolean;
  status: "configured" | "not_configured";
  label: "Email connected" | "Email not configured";
  fromDisplay: string | null;
}> {
  const { getEmailChannelStatus } = await import("@/lib/email/availability");
  return getEmailChannelStatus();
}
