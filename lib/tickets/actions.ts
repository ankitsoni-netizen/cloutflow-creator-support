"use server";

import { sendAcknowledgementForTicket } from "@/lib/email/ticket-mail";
import { createClient } from "@/lib/supabase/server";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket, mapFormToDbInsert } from "@/lib/tickets/map";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import type { NewTicketFormData } from "@/lib/types";
import type { CreateTicketActionResult } from "@/lib/tickets/workflow-types";

export async function createTicketAction(options: {
  form: NewTicketFormData;
  assignedTeam: string | null;
  assignedExecutiveId: string | null;
}): Promise<CreateTicketActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Your session expired. Please sign in again." };
  }

  const mapped = mapFormToDbInsert(options.form, {
    assignedTeam: options.assignedTeam,
    assignedExecutiveId: options.assignedExecutiveId,
  });

  if ("error" in mapped) {
    return { error: mapped.error };
  }

  const { data, error } = await supabase
    .from("tickets")
    .insert(mapped.insert)
    .select(TICKET_SELECT)
    .single();

  let created: DbTicket | null = data ? (data as DbTicket) : null;

  if (!created && error) {
    logSupabaseError("tickets insert failed", error);

    // Insert may have succeeded while RETURNING was filtered by RLS.
    if (error.code === "PGRST116") {
      const { data: latest, error: latestError } = await supabase
        .from("tickets")
        .select(TICKET_SELECT)
        .eq("creator_name", mapped.insert.creator_name)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) {
        logSupabaseError("tickets post-insert fetch failed", latestError);
        return { error: toSafeTicketErrorMessage(latestError) };
      }

      if (latest) {
        created = latest as DbTicket;
      }
    }

    if (!created) {
      return { error: toSafeTicketErrorMessage(error) };
    }
  }

  if (!created) {
    return { error: "Unable to create ticket. Please try again." };
  }

  const acknowledgement = await sendAcknowledgementForTicket(created);

  if (acknowledgement.outcome === "sent") {
    const sentAt = new Date().toISOString();
    const { data: updated, error: ackError } = await supabase
      .from("tickets")
      .update({ acknowledgement_email_sent_at: sentAt })
      .eq("id", created.id)
      .select(TICKET_SELECT)
      .single();

    if (ackError || !updated) {
      if (ackError) {
        logSupabaseError("acknowledgement_email_sent_at update failed", ackError);
      }
      return {
        ticket: mapDbTicketToTicket(created),
        acknowledgement: "failed",
        acknowledgementMessage:
          "Acknowledgement was accepted by Brevo, but the ticket could not be updated with the sent timestamp.",
      };
    }

    return {
      ticket: mapDbTicketToTicket(updated as DbTicket),
      acknowledgement: "sent",
      acknowledgementMessage: "Ticket created and acknowledgement email sent.",
    };
  }

  if (acknowledgement.outcome === "failed") {
    return {
      ticket: mapDbTicketToTicket(created),
      acknowledgement: "failed",
      acknowledgementMessage:
        acknowledgement.error ||
        "Ticket created, but the acknowledgement email could not be sent.",
    };
  }

  return {
    ticket: mapDbTicketToTicket(created),
    acknowledgement: "skipped",
    acknowledgementMessage: "Ticket created.",
  };
}
