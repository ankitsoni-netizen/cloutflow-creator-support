import { createClient } from "@/lib/supabase/server";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import type { DbTicket } from "@/lib/tickets/types";
import type { Ticket } from "@/lib/types";

const TICKET_SELECT = `
  id,
  ticket_code,
  creator_name,
  creator_phone,
  creator_email,
  social_handle,
  platform,
  issue_type,
  campaign_name,
  brand_name,
  campaign_month,
  cloutflow_poc_name,
  cloutflow_poc_contact_number,
  source_channel,
  status,
  priority,
  assigned_team,
  assigned_executive_id,
  assigned_executive_name,
  issue_description,
  internal_notes,
  acknowledgement_email_requested,
  acknowledgement_email_sent_at,
  resolution_summary,
  first_response_at,
  resolved_at,
  customer_last_notified_at,
  metadata,
  created_at,
  updated_at
`;

export async function fetchTicketsForStaff(): Promise<
  { tickets: Ticket[] } | { error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    logSupabaseError("tickets fetch failed", error);
    return {
      error: toSafeTicketErrorMessage(error),
    };
  }

  const rows = (data ?? []) as DbTicket[];
  return { tickets: rows.map(mapDbTicketToTicket) };
}
