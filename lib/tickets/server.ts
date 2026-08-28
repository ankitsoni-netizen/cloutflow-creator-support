import { createClient } from "@/lib/supabase/server";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { ticketSelect } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import type { Ticket } from "@/lib/types";

export async function fetchTicketsForStaff(): Promise<
  { tickets: Ticket[] } | { error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(ticketSelect())
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
