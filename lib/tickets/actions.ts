"use server";

import { createClient } from "@/lib/supabase/server";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket, mapFormToDbInsert } from "@/lib/tickets/map";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import type { NewTicketFormData, Ticket } from "@/lib/types";

export async function createTicketAction(options: {
  form: NewTicketFormData;
  assignedTeam: string | null;
  assignedExecutiveId: string | null;
}): Promise<{ ticket: Ticket } | { error: string }> {
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

  if (data) {
    return { ticket: mapDbTicketToTicket(data as DbTicket) };
  }

  if (error) {
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
        return { ticket: mapDbTicketToTicket(latest as DbTicket) };
      }
    }

    return { error: toSafeTicketErrorMessage(error) };
  }

  return { error: "Unable to create ticket. Please try again." };
}
