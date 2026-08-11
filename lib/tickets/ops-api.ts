import { createClient } from "@/lib/supabase/client";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import type { StaffDirectoryMember } from "@/lib/types";

/** Ticket IDs with at least one creator-facing comment still pending delivery. */
export async function fetchPendingReplyTicketIds(): Promise<
  { ticketIds: string[] } | { error: string }
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ticket_comments")
    .select("ticket_id")
    .eq("visibility", "creator")
    .eq("delivery_status", "pending");

  if (error) {
    logSupabaseError("pending reply ticket ids fetch failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }

  const ticketIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => row.ticket_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  return { ticketIds };
}

export async function fetchStaffDirectory(): Promise<
  { data: StaffDirectoryMember[] } | { error: string }
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("user_id, full_name, role, team, is_active")
    .order("full_name", { ascending: true });

  if (error) {
    logSupabaseError("staff directory fetch failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }

  const members: StaffDirectoryMember[] = (data ?? [])
    .map((row) => {
      const fullName =
        typeof row.full_name === "string" ? row.full_name.trim() : "";
      if (!row.user_id || !fullName) return null;
      return {
        userId: row.user_id as string,
        fullName,
        role: (row.role as string | null) ?? null,
        team: (row.team as string | null) ?? null,
        isActive: Boolean(row.is_active),
      };
    })
    .filter((member): member is StaffDirectoryMember => member !== null);

  return { data: members };
}
