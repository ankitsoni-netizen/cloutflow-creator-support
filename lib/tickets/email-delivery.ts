import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import {
  COMMENT_SELECT,
  mapDbComment,
} from "@/lib/tickets/workflow-map";
import type { Ticket } from "@/lib/types";
import type { TicketComment } from "@/lib/tickets/workflow-types";

export async function updateCommentDeliveryStatus(
  supabase: SupabaseClient,
  commentId: string,
  deliveryStatus: "pending" | "sent" | "failed",
): Promise<{ data: TicketComment } | { error: string; rlsBlocked?: boolean }> {
  const { data, error } = await supabase
    .from("ticket_comments")
    .update({ delivery_status: deliveryStatus })
    .eq("id", commentId)
    .select(COMMENT_SELECT)
    .single();

  if (error || !data) {
    if (error) logSupabaseError("ticket comment delivery update failed", error);
    const message = error
      ? toSafeTicketErrorMessage(error)
      : "Unable to update email delivery status.";
    const rlsBlocked =
      error?.code === "42501" ||
      error?.code === "PGRST301" ||
      /permission|policy|rls/i.test(error?.message ?? "");
    return { error: message, rlsBlocked };
  }

  return { data: mapDbComment(data) };
}

export async function markTicketCustomerNotified(
  supabase: SupabaseClient,
  ticket: DbTicket,
): Promise<{ data: Ticket } | { error: string }> {
  const now = new Date().toISOString();
  const patch: {
    customer_last_notified_at: string;
    first_response_at?: string;
  } = {
    customer_last_notified_at: now,
  };
  if (!ticket.first_response_at) {
    patch.first_response_at = now;
  }

  const { data, error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", ticket.id)
    .select(TICKET_SELECT)
    .single();

  if (error || !data) {
    if (error) {
      logSupabaseError("ticket notification timestamp update failed", error);
    }
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to update ticket notification timestamps.",
    };
  }

  return { data: mapDbTicketToTicket(data as DbTicket) };
}

export async function loadTicketById(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{ data: DbTicket } | { error: string }> {
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("id", ticketId)
    .single();

  if (error || !data) {
    if (error) logSupabaseError("ticket load failed", error);
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to load the ticket.",
    };
  }

  return { data: data as DbTicket };
}
