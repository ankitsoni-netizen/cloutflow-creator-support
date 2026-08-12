import "server-only";

import { sendAcknowledgementForTicket } from "@/lib/email/ticket-mail";
import type { ValidatedWebsiteTicketInput } from "@/lib/public-intake/validate";
import { mapWebsiteFormToDbInsert } from "@/lib/public-intake/map";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSupabaseError } from "@/lib/tickets/errors";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PublicWebsiteTicketSuccess = {
  success: true;
  ticketCode: string;
  acknowledgementSent: boolean;
  message: string;
};

export type PublicWebsiteTicketFailure = {
  success: false;
  message: string;
};

export type PublicWebsiteTicketResult =
  | PublicWebsiteTicketSuccess
  | PublicWebsiteTicketFailure;

type CreateDeps = {
  supabase?: SupabaseClient;
  sendAcknowledgement?: typeof sendAcknowledgementForTicket;
};

function safePublicMessage(acknowledgementSent: boolean): string {
  if (acknowledgementSent) {
    return "Your request has been submitted. An acknowledgement email has been sent.";
  }
  return "Your ticket was created successfully. Our team will contact you shortly.";
}

/**
 * Creates a website-sourced ticket and attempts the existing Brevo acknowledgement.
 * Email failure never rolls back the ticket or hides the ticket code.
 */
export async function createWebsiteTicketFromValidatedInput(
  input: ValidatedWebsiteTicketInput,
  deps: CreateDeps = {},
): Promise<
  | { ok: true; response: PublicWebsiteTicketSuccess }
  | { ok: false; status: number; response: PublicWebsiteTicketFailure }
> {
  const mapped = mapWebsiteFormToDbInsert(input);
  if ("error" in mapped) {
    return {
      ok: false,
      status: 400,
      response: { success: false, message: mapped.error },
    };
  }

  let supabase: SupabaseClient;
  try {
    supabase = deps.supabase ?? createAdminClient();
  } catch {
    console.error("website intake: supabase admin client is not configured");
    return {
      ok: false,
      status: 503,
      response: {
        success: false,
        message: "Support intake is temporarily unavailable. Please try again later.",
      },
    };
  }

  const sendAcknowledgement =
    deps.sendAcknowledgement ?? sendAcknowledgementForTicket;

  const { data, error } = await supabase
    .from("tickets")
    .insert(mapped.insert)
    .select(TICKET_SELECT)
    .single();

  if (error || !data) {
    if (error) {
      logSupabaseError("website intake tickets insert failed", error);
    } else {
      console.error("website intake tickets insert returned no row");
    }
    return {
      ok: false,
      status: 500,
      response: {
        success: false,
        message: "Unable to submit your request right now. Please try again.",
      },
    };
  }

  const created = data as DbTicket;
  const acknowledgement = await sendAcknowledgement(created);
  let acknowledgementSent = acknowledgement.outcome === "sent";

  if (acknowledgement.outcome === "sent") {
    const sentAt = new Date().toISOString();
    const { error: ackError } = await supabase
      .from("tickets")
      .update({ acknowledgement_email_sent_at: sentAt })
      .eq("id", created.id);

    if (ackError) {
      logSupabaseError(
        "website intake acknowledgement_email_sent_at update failed",
        ackError,
      );
      // Ticket exists and Brevo accepted mail — still report sent to the creator.
      acknowledgementSent = true;
    }
  } else if (acknowledgement.outcome === "failed") {
    console.error("website intake acknowledgement email failed", {
      ticketCode: created.ticket_code,
      outcome: acknowledgement.outcome,
    });
  }

  return {
    ok: true,
    response: {
      success: true,
      ticketCode: created.ticket_code,
      acknowledgementSent,
      message: safePublicMessage(acknowledgementSent),
    },
  };
}

/** Sanitizes a success payload so only public fields are returned. */
export function toPublicWebsiteTicketResponse(
  result: PublicWebsiteTicketSuccess,
): PublicWebsiteTicketSuccess {
  return {
    success: true,
    ticketCode: result.ticketCode,
    acknowledgementSent: result.acknowledgementSent,
    message: result.message,
  };
}
