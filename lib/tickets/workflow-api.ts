import { createClient } from "@/lib/supabase/client";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { buildTimeline } from "@/lib/tickets/timeline";
import { mapDbComment, mapDbEvent, mapStaffOption } from "@/lib/tickets/workflow-map";
import type {
  StaffOption,
  TicketComment,
  TicketEvent,
  TimelineItem,
} from "@/lib/tickets/workflow-types";

export async function fetchTicketTimeline(ticketId: string): Promise<
  | { comments: TicketComment[]; events: TicketEvent[]; timeline: TimelineItem[] }
  | { error: string }
> {
  const supabase = createClient();

  const [commentsResult, eventsResult] = await Promise.all([
    supabase
      .from("ticket_comments")
      .select(
        "id, ticket_id, author_user_id, author_name, visibility, comment_text, send_to_creator, delivery_status, created_at",
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    supabase
      .from("ticket_events")
      .select(
        "id, ticket_id, event_type, from_status, to_status, actor_user_id, actor_name, event_data, created_at",
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
  ]);

  if (commentsResult.error) {
    logSupabaseError("ticket comments fetch failed", commentsResult.error);
    return { error: toSafeTicketErrorMessage(commentsResult.error) };
  }

  if (eventsResult.error) {
    logSupabaseError("ticket events fetch failed", eventsResult.error);
    return { error: toSafeTicketErrorMessage(eventsResult.error) };
  }

  const comments = (commentsResult.data ?? []).map(mapDbComment);
  const events = (eventsResult.data ?? []).map((row) =>
    mapDbEvent({
      ...row,
      event_data:
        row.event_data && typeof row.event_data === "object"
          ? (row.event_data as Record<string, unknown>)
          : {},
    }),
  );

  return {
    comments,
    events,
    timeline: buildTimeline(events, comments),
  };
}

export async function fetchActiveStaffOptions(): Promise<
  { data: StaffOption[] } | { error: string }
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("user_id, full_name, role, team")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    logSupabaseError("active staff client fetch failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }

  const options = (data ?? [])
    .map(mapStaffOption)
    .filter((option): option is StaffOption => option !== null);

  return { data: options };
}
