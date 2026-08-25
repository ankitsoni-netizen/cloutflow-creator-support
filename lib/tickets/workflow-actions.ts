"use server";

import {
  sendCreatorReplyEmail,
  sendResolutionEmail,
} from "@/lib/email/ticket-mail";
import { sendInstagramResolutionTranscriptEmail } from "@/lib/email/instagram-ticket-mail";
import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import {
  loadTicketById,
  markTicketCustomerNotified,
  updateCommentDeliveryStatus,
} from "@/lib/tickets/email-delivery";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import {
  isInstagramTicket,
  sendStaffInstagramReply,
  staffInstagramWindowWarning,
} from "@/lib/tickets/instagram-reply";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { consumeStaffActionRateLimit } from "@/lib/tickets/staff-rate-limit";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import {
  COMMENT_SELECT,
  uiStatusToDb,
  mapDbComment,
  mapStaffOption,
} from "@/lib/tickets/workflow-map";
import type {
  AssignmentInput,
  CommentMutationResult,
  CreatorReplyActionResult,
  ResolveTicketActionResult,
  ResolveTicketInput,
  StaffOption,
  StatusUpdateInput,
  TicketMutationResult,
} from "@/lib/tickets/workflow-types";

export async function addInternalNoteAction(input: {
  ticketId: string;
  commentText: string;
}): Promise<CommentMutationResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const commentText = input.commentText.trim();
  if (!commentText) {
    return { error: "Internal note cannot be empty." };
  }

  const { data, error } = await context.supabase
    .from("ticket_comments")
    .insert({
      ticket_id: input.ticketId,
      author_user_id: context.user.id,
      author_name: context.profile.full_name,
      visibility: "internal",
      comment_text: commentText,
      send_to_creator: false,
      delivery_status: null,
    })
    .select(COMMENT_SELECT)
    .single();

  if (error || !data) {
    if (error) logSupabaseError("internal note insert failed", error);
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to save the internal note.",
    };
  }

  return { data: mapDbComment(data) };
}

export async function queueCreatorReplyAction(input: {
  ticketId: string;
  commentText: string;
}): Promise<CreatorReplyActionResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const commentText = input.commentText.trim();
  if (!commentText) {
    return { error: "Creator reply cannot be empty." };
  }

  const loadedTicket = await loadTicketById(context.supabase, input.ticketId);
  if ("error" in loadedTicket) return { error: loadedTicket.error };
  const ticket = loadedTicket.data;

  const rate = consumeStaffActionRateLimit(context.user.id);
  if (!rate.ok) return { error: rate.error };

  const { data, error } = await context.supabase
    .from("ticket_comments")
    .insert({
      ticket_id: input.ticketId,
      author_user_id: context.user.id,
      author_name: context.profile.full_name,
      visibility: "creator",
      comment_text: commentText,
      send_to_creator: true,
      delivery_status: "pending",
    })
    .select(COMMENT_SELECT)
    .single();

  if (error || !data) {
    if (error) logSupabaseError("creator reply insert failed", error);
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to save the creator reply.",
    };
  }

  const comment = mapDbComment(data);

  if (isInstagramTicket(ticket)) {
    const ig = await sendStaffInstagramReply({
      ticket,
      commentId: comment.id,
      commentText: comment.commentText,
    });
    if (!ig.ok) {
      const failed = await updateCommentDeliveryStatus(
        context.supabase,
        comment.id,
        "failed",
      );
      return {
        data: "data" in failed ? failed.data : comment,
        ticket: mapDbTicketToTicket(ticket),
        delivery: "failed",
        instagramDelivery: "failed",
        deliveryMessage: ig.error,
      };
    }

    const commentStatus =
      ig.instagram === "sent" || ig.email === "sent" ? "sent" : "failed";
    const updatedComment = await updateCommentDeliveryStatus(
      context.supabase,
      comment.id,
      commentStatus,
    );
    if ("error" in updatedComment) {
      return {
        data: comment,
        ticket: mapDbTicketToTicket(ticket),
        delivery: ig.instagram === "sent" ? "sent" : "failed",
        instagramDelivery: ig.instagram,
        deliveryMessage:
          ig.instagram === "sent"
            ? "Instagram reply sent, but delivery status could not be saved."
            : "The Instagram reply could not be sent.",
        messagingWindowWarning: staffInstagramWindowWarning(
          !ig.messagingWindowExpired,
        ),
      };
    }

    if (ig.instagram === "sent" || ig.email === "sent") {
      const notified = await markTicketCustomerNotified(context.supabase, ticket);
      if ("error" in notified) {
        return {
          data: updatedComment.data,
          ticket: mapDbTicketToTicket(ticket),
          delivery: ig.instagram === "failed" ? "failed" : "sent",
          instagramDelivery: ig.instagram,
          deliveryMessage:
            ig.instagram === "sent"
              ? "Instagram reply sent, but ticket notification timestamps could not be updated."
              : "The Instagram reply could not be sent.",
          messagingWindowWarning: staffInstagramWindowWarning(
            !ig.messagingWindowExpired,
          ),
        };
      }
      return {
        data: updatedComment.data,
        ticket: notified.data,
        delivery: ig.instagram === "failed" ? "failed" : "sent",
        instagramDelivery: ig.instagram,
        deliveryMessage:
          ig.instagram === "failed"
            ? "The reply was saved, but Instagram delivery failed. You can retry."
            : "Reply sent to Instagram.",
        messagingWindowWarning: staffInstagramWindowWarning(
          !ig.messagingWindowExpired,
        ),
      };
    }

    return {
      data: updatedComment.data,
      ticket: mapDbTicketToTicket(ticket),
      delivery: "failed",
      instagramDelivery: "failed",
      deliveryMessage: "The Instagram reply could not be sent.",
      messagingWindowWarning: staffInstagramWindowWarning(
        !ig.messagingWindowExpired,
      ),
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
        ? "Email was accepted by Brevo, but delivery status could not be saved due to database permissions. See supabase/migrations/20260811163000_ticket_comments_delivery_update.sql."
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

export async function updateTicketStatusAction(
  input: StatusUpdateInput,
): Promise<TicketMutationResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const { data, error } = await context.supabase
    .from("tickets")
    .update({ status: uiStatusToDb(input.status) })
    .eq("id", input.ticketId)
    .select(TICKET_SELECT)
    .single();

  if (error || !data) {
    if (error) logSupabaseError("ticket status update failed", error);
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to update ticket status.",
    };
  }

  return { data: mapDbTicketToTicket(data as DbTicket) };
}

export async function resolveTicketAction(
  input: ResolveTicketInput,
): Promise<ResolveTicketActionResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const resolutionSummary = input.resolutionSummary.trim();
  if (!resolutionSummary) {
    return { error: "Resolution summary is required." };
  }

  const { data, error } = await context.supabase
    .from("tickets")
    .update({
      status: "resolved",
      resolution_summary: resolutionSummary,
    })
    .eq("id", input.ticketId)
    .select(TICKET_SELECT)
    .single();

  if (error || !data) {
    if (error) logSupabaseError("ticket resolve failed", error);
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to resolve the ticket.",
    };
  }

  const resolvedTicket = data as DbTicket;

  const { data: commentRow, error: commentError } = await context.supabase
    .from("ticket_comments")
    .insert({
      ticket_id: resolvedTicket.id,
      author_user_id: context.user.id,
      author_name: context.profile.full_name,
      visibility: "creator",
      comment_text: resolutionSummary,
      send_to_creator: true,
      delivery_status: "pending",
    })
    .select(COMMENT_SELECT)
    .single();

  if (commentError || !commentRow) {
    if (commentError) {
      logSupabaseError("resolution comment insert failed", commentError);
    }
    return {
      data: mapDbTicketToTicket(resolvedTicket),
      resolutionEmail: "failed",
      resolutionEmailMessage:
        "Ticket resolved, but the resolution email could not be prepared.",
    };
  }

  const comment = mapDbComment(commentRow);

  if (isInstagramTicket(resolvedTicket)) {
    const ig = await sendStaffInstagramReply({
      ticket: { ...resolvedTicket, status: "open" },
      commentId: comment.id,
      commentText: resolutionSummary,
    });
    let store;
    try {
      store = createAdminInstagramStore();
    } catch {
      store = null;
    }
    if (store && resolvedTicket.external_conversation_id) {
      const conversation = await store.getConversation(
        "instagram",
        resolvedTicket.external_conversation_id,
      );
      if (conversation && !("errorCode" in conversation)) {
        const rows = await store.listSupportTranscript({
          conversationId: conversation.id,
          ticketId: resolvedTicket.id,
        });
        const transcriptText = rows
          .map((row) => {
            const who = row.direction === "inbound" ? "Creator" : "Cloutflow";
            return `${who}: ${row.messageBody}`;
          })
          .join("\n\n");
        const claim = await store.claimEmailDelivery({
          ticketId: resolvedTicket.id,
          conversationId: conversation.id,
          commentId: comment.id,
          purpose: "instagram-resolution-transcript",
          idempotencyKey: `email:ig-resolve:${resolvedTicket.id}`,
        });
        if (claim.outcome === "claimed") {
          const mailed = await sendInstagramResolutionTranscriptEmail({
            ticket: resolvedTicket,
            transcriptText,
            resolutionSummary,
          });
          await store.markEmailDelivery(claim.id, {
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
      }
    }

    const commentStatus =
      ig.ok && ig.instagram === "sent" ? "sent" : "failed";
    const updatedComment = await updateCommentDeliveryStatus(
      context.supabase,
      comment.id,
      commentStatus === "sent" ? "sent" : "failed",
    );
    await markTicketCustomerNotified(context.supabase, resolvedTicket);
    return {
      data: mapDbTicketToTicket(resolvedTicket),
      resolutionEmail: commentStatus === "sent" ? "sent" : "failed",
      resolutionEmailMessage:
        commentStatus === "sent"
          ? "Ticket resolved and the creator was notified."
          : "Ticket resolved, but Instagram/email notification failed.",
      comment: "data" in updatedComment ? updatedComment.data : comment,
    };
  }

  const sendResult = await sendResolutionEmail({
    ticket: resolvedTicket,
    resolutionSummary,
  });

  if (!sendResult.ok) {
    const failed = await updateCommentDeliveryStatus(
      context.supabase,
      comment.id,
      "failed",
    );
    return {
      data: mapDbTicketToTicket(resolvedTicket),
      resolutionEmail: "failed",
      resolutionEmailMessage:
        "Ticket resolved, but the resolution email could not be sent.",
      comment: "data" in failed ? failed.data : comment,
    };
  }

  const updatedComment = await updateCommentDeliveryStatus(
    context.supabase,
    comment.id,
    "sent",
  );
  if ("error" in updatedComment) {
    return {
      data: mapDbTicketToTicket(resolvedTicket),
      resolutionEmail: "failed",
      resolutionEmailMessage: updatedComment.rlsBlocked
        ? "Ticket resolved and email accepted by Brevo, but delivery status could not be saved due to database permissions."
        : "Ticket resolved and email accepted by Brevo, but delivery status could not be saved.",
      comment,
    };
  }

  const notified = await markTicketCustomerNotified(
    context.supabase,
    resolvedTicket,
  );
  if ("error" in notified) {
    return {
      data: mapDbTicketToTicket(resolvedTicket),
      resolutionEmail: "sent",
      resolutionEmailMessage:
        "Ticket resolved and email accepted by Brevo, but notification timestamps could not be updated.",
      comment: updatedComment.data,
    };
  }

  return {
    data: notified.data,
    resolutionEmail: "sent",
    resolutionEmailMessage: "Ticket resolved and resolution email sent.",
    comment: updatedComment.data,
  };
}

const DEFAULT_ASSIGNED_TEAM = "Creator Support";

export async function reassignTicketAction(
  input: AssignmentInput,
): Promise<TicketMutationResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const assigneeUserId = input.assigneeUserId?.trim() || null;

  const { data: current, error: currentError } = await context.supabase
    .from("tickets")
    .select("id, assigned_executive_id, assigned_team")
    .eq("id", input.ticketId)
    .single();

  if (currentError || !current) {
    if (currentError) {
      logSupabaseError("ticket assignment load failed", currentError);
    }
    return {
      error: currentError
        ? toSafeTicketErrorMessage(currentError)
        : "Unable to load the ticket for reassignment.",
    };
  }

  const currentTeam =
    typeof current.assigned_team === "string" && current.assigned_team.trim()
      ? current.assigned_team.trim()
      : DEFAULT_ASSIGNED_TEAM;

  let updatePayload: {
    assigned_executive_id: string | null;
    assigned_executive_name: string | null;
    assigned_team?: string;
  };

  if (!assigneeUserId) {
    // Clear executive only. Keep team ownership (assigned_team is NOT NULL).
    if (current.assigned_executive_id === null) {
      const { data: unchanged, error: unchangedError } = await context.supabase
        .from("tickets")
        .select(TICKET_SELECT)
        .eq("id", input.ticketId)
        .single();
      if (unchangedError || !unchanged) {
        return {
          error: unchangedError
            ? toSafeTicketErrorMessage(unchangedError)
            : "Unable to load the ticket.",
        };
      }
      return { data: mapDbTicketToTicket(unchanged as DbTicket) };
    }

    updatePayload = {
      assigned_executive_id: null,
      assigned_executive_name: null,
      assigned_team: currentTeam,
    };
  } else {
    const { data: assignee, error: assigneeError } = await context.supabase
      .from("staff_profiles")
      .select("user_id, full_name, role, team, is_active")
      .eq("user_id", assigneeUserId)
      .eq("is_active", true)
      .maybeSingle();

    if (assigneeError) {
      logSupabaseError("assignee lookup failed", assigneeError);
      return { error: toSafeTicketErrorMessage(assigneeError) };
    }

    const staffOption = assignee ? mapStaffOption(assignee) : null;
    if (!staffOption) {
      return { error: "Selected executive is not an active staff member." };
    }

    if (current.assigned_executive_id === staffOption.userId) {
      const { data: unchanged, error: unchangedError } = await context.supabase
        .from("tickets")
        .select(TICKET_SELECT)
        .eq("id", input.ticketId)
        .single();
      if (unchangedError || !unchanged) {
        return {
          error: unchangedError
            ? toSafeTicketErrorMessage(unchangedError)
            : "Unable to load the ticket.",
        };
      }
      return { data: mapDbTicketToTicket(unchanged as DbTicket) };
    }

    updatePayload = {
      assigned_executive_id: staffOption.userId,
      assigned_executive_name: staffOption.fullName,
      assigned_team: staffOption.team?.trim() || currentTeam,
    };
  }

  // Single atomic tickets UPDATE. Assignment audit is written by the
  // database trigger in the same transaction (no app-side ticket_events insert).
  const { data: updated, error: updateError } = await context.supabase
    .from("tickets")
    .update(updatePayload)
    .eq("id", input.ticketId)
    .select(TICKET_SELECT)
    .single();

  if (updateError || !updated) {
    if (updateError) logSupabaseError("ticket reassignment failed", updateError);
    return {
      error: updateError
        ? toSafeTicketErrorMessage(updateError)
        : "Unable to reassign the ticket.",
    };
  }

  return { data: mapDbTicketToTicket(updated as DbTicket) };
}

export async function fetchActiveStaffOptionsAction(): Promise<
  { data: StaffOption[] } | { error: string }
> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const { data, error } = await context.supabase
    .from("staff_profiles")
    .select("user_id, full_name, role, team")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    logSupabaseError("active staff fetch failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }

  const options = (data ?? [])
    .map(mapStaffOption)
    .filter((option): option is StaffOption => option !== null);

  return { data: options };
}
