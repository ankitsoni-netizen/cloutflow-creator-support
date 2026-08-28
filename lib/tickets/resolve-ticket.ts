import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError, toSafeTicketErrorMessage } from "@/lib/tickets/errors";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import { TICKET_SELECT } from "@/lib/tickets/select";
import { resolveTicketIdempotencyKey } from "@/lib/tickets/resolve-cache";
import type { DbTicket } from "@/lib/tickets/types";
import {
  COMMENT_SELECT,
  mapDbComment,
} from "@/lib/tickets/workflow-map";
import type {
  ResolveTicketActionResult,
  TicketComment,
} from "@/lib/tickets/workflow-types";

export const RESOLVE_TICKET_RPC = "resolve_creator_support_ticket";

const RPC_MISSING_CODES = new Set(["PGRST202", "42883", "PGRST204"]);

export type ResolveTicketCommitInput = {
  ticketId: string;
  resolutionSummary: string;
  actorUserId: string;
  actorName: string;
  idempotencyKey?: string;
  nowIso?: string;
};

export type ResolveTicketCommitSuccess = {
  data: ReturnType<typeof mapDbTicketToTicket>;
  resolutionEmail: "queued";
  resolutionEmailMessage: string;
  alreadyResolved: boolean;
  jobId: string | null;
  comment?: TicketComment;
  eventId?: string | null;
  usedRpc: boolean;
  jobTableMissing: boolean;
};

export type ResolveTicketCommitResult =
  | ResolveTicketCommitSuccess
  | { error: string };

type RpcResolvePayload = {
  already_resolved?: boolean;
  comment_id?: string | null;
  job_id?: string | null;
  event_id?: string | null;
  ticket?: DbTicket | Record<string, unknown> | null;
};

function isRpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && RPC_MISSING_CODES.has(error.code)) return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("could not find the function") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

async function loadTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{ data: DbTicket } | { error: string }> {
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) {
    logSupabaseError("ticket resolve load failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }
  if (!data) return { error: "Unable to load the ticket." };
  return { data: data as DbTicket };
}

async function loadComment(
  supabase: SupabaseClient,
  commentId: string | null | undefined,
): Promise<TicketComment | undefined> {
  if (!commentId) return undefined;
  const { data, error } = await supabase
    .from("ticket_comments")
    .select(COMMENT_SELECT)
    .eq("id", commentId)
    .maybeSingle();
  if (error || !data) return undefined;
  return mapDbComment(data);
}

async function commitViaRpc(
  supabase: SupabaseClient,
  input: ResolveTicketCommitInput,
  idempotencyKey: string,
): Promise<ResolveTicketCommitResult | { missing: true }> {
  const { data, error } = await supabase.rpc(RESOLVE_TICKET_RPC, {
    p_ticket_id: input.ticketId,
    p_resolution_summary: input.resolutionSummary,
    p_actor_user_id: input.actorUserId,
    p_actor_name: input.actorName,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (isRpcMissing(error)) return { missing: true };
    logSupabaseError("ticket resolve rpc failed", error);
    return { error: toSafeTicketErrorMessage(error) };
  }

  const payload = (data ?? {}) as RpcResolvePayload;
  const rawTicket = payload.ticket;
  if (!rawTicket || typeof rawTicket !== "object") {
    const loaded = await loadTicket(supabase, input.ticketId);
    if ("error" in loaded) return loaded;
    const comment = await loadComment(supabase, payload.comment_id);
    return {
      data: mapDbTicketToTicket(loaded.data),
      resolutionEmail: "queued",
      resolutionEmailMessage: "Ticket marked as resolved",
      alreadyResolved: Boolean(payload.already_resolved),
      jobId: payload.job_id ?? null,
      comment,
      eventId: payload.event_id ?? null,
      usedRpc: true,
      jobTableMissing: false,
    };
  }

  const comment = await loadComment(supabase, payload.comment_id);
  return {
    data: mapDbTicketToTicket(rawTicket as DbTicket),
    resolutionEmail: "queued",
    resolutionEmailMessage: "Ticket marked as resolved",
    alreadyResolved: Boolean(payload.already_resolved),
    jobId: payload.job_id ?? null,
    comment,
    eventId: payload.event_id ?? null,
    usedRpc: true,
    jobTableMissing: false,
  };
}

/**
 * Authoritative resolve mutation. Commits status/resolved_at/summary/audit
 * and enqueues durable notification work. Does not send email or DMs.
 * Requires resolve_creator_support_ticket; there is no client fallback that
 * can mark a ticket resolved without a durable outbox job.
 */
export async function commitTicketResolution(
  supabase: SupabaseClient,
  input: ResolveTicketCommitInput,
): Promise<ResolveTicketCommitResult> {
  const resolutionSummary = input.resolutionSummary.trim();
  if (!resolutionSummary) {
    return { error: "Resolution summary is required." };
  }

  const idempotencyKey =
    input.idempotencyKey?.trim() || resolveTicketIdempotencyKey(input.ticketId);

  const rpc = await commitViaRpc(
    supabase,
    { ...input, resolutionSummary },
    idempotencyKey,
  );
  if (!("missing" in rpc)) return rpc;

  return {
    error: "Ticket resolution is temporarily unavailable. Please retry.",
  };
}

export function toResolveTicketActionResult(
  result: ResolveTicketCommitResult,
): ResolveTicketActionResult {
  if ("error" in result) return { error: result.error };
  return {
    data: result.data,
    resolutionEmail: result.resolutionEmail,
    resolutionEmailMessage: result.resolutionEmailMessage,
    comment: result.comment,
    alreadyResolved: result.alreadyResolved,
  };
}
