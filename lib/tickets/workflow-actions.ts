"use server";

import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import { uiStatusToDb, mapDbComment, mapStaffOption } from "@/lib/tickets/workflow-map";
import type {
  AssignmentInput,
  CommentMutationResult,
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
    .select(
      "id, ticket_id, author_user_id, author_name, visibility, comment_text, send_to_creator, delivery_status, created_at",
    )
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
}): Promise<CommentMutationResult> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const commentText = input.commentText.trim();
  if (!commentText) {
    return { error: "Creator reply cannot be empty." };
  }

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
    .select(
      "id, ticket_id, author_user_id, author_name, visibility, comment_text, send_to_creator, delivery_status, created_at",
    )
    .single();

  if (error || !data) {
    if (error) logSupabaseError("creator reply insert failed", error);
    return {
      error: error
        ? toSafeTicketErrorMessage(error)
        : "Unable to queue the creator reply.",
    };
  }

  return { data: mapDbComment(data) };
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
): Promise<TicketMutationResult> {
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

  return { data: mapDbTicketToTicket(data as DbTicket) };
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
