import { createClient } from "@/lib/supabase/client";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import type { Ticket } from "@/lib/types";

export async function fetchTickets(): Promise<
  { tickets: Ticket[] } | { error: string }
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    logSupabaseError("tickets fetch failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }

  const rows = (data ?? []) as DbTicket[];
  return { tickets: rows.map(mapDbTicketToTicket) };
}

export async function resolveAssignedExecutiveId(
  executiveName: string,
): Promise<string | null> {
  const trimmed = executiveName.trim();
  if (!trimmed) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("user_id, full_name")
    .eq("is_active", true)
    .eq("full_name", trimmed)
    .maybeSingle();

  if (error) {
    logSupabaseError("staff_profiles executive lookup failed", error);
    return null;
  }

  return data?.user_id ?? null;
}
