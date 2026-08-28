import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInstagramResolutionTranscriptEmail } from "@/lib/email/instagram-ticket-mail";
import { sendResolutionEmail } from "@/lib/email/ticket-mail";
import { scheduleAfterResponse } from "@/lib/meta/after-response";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import {
  markTicketCustomerNotified,
  updateCommentDeliveryStatus,
} from "@/lib/tickets/email-delivery";
import { logSupabaseError } from "@/lib/tickets/errors";
import {
  isInstagramTicket,
  sendStaffInstagramReply,
} from "@/lib/tickets/instagram-reply";
import {
  isWhatsAppTicket,
  sendStaffWhatsAppReply,
} from "@/lib/tickets/whatsapp-reply";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import {
  verifyTicketResolutionOutboxDrainAuth,
} from "@/lib/tickets/resolution-outbox-auth";

export const TICKET_RESOLUTION_OUTBOX_MAX_ATTEMPTS = 5;
export const TICKET_RESOLUTION_OUTBOX_CLAIM_LEASE_MS = 60_000;
export const TICKET_RESOLUTION_OUTBOX_BACKOFF_MS = 15_000;
export const TICKET_RESOLUTION_OUTBOX_DRAIN_BATCH = 4;

const TERMINAL_CHANNEL_CODES = new Set([
  "creator_email_invalid",
  "ticket_not_found",
  "empty_reply",
  "invalid_recipient",
  "not_instagram",
  "not_whatsapp",
  "no_email_recipient",
]);

export type ResolutionChannelState = "pending" | "sent" | "failed" | "skipped";

export type ResolutionJobPayload = {
  resolution_summary?: string;
  source_channel?: string;
  instagram?: ResolutionChannelState;
  whatsapp?: ResolutionChannelState;
  email?: ResolutionChannelState;
  transcript?: ResolutionChannelState;
  comment_delivery?: ResolutionChannelState;
  customer_notified?: boolean;
};

export function channelIsComplete(state: ResolutionChannelState | undefined): boolean {
  return state === "sent" || state === "skipped";
}

export function resolutionJobNotificationsComplete(
  payload: ResolutionJobPayload,
  sourceChannel: string,
): boolean {
  const channel = sourceChannel.trim().toLowerCase();
  if (channel === "instagram") {
    return (
      channelIsComplete(payload.instagram) &&
      channelIsComplete(payload.email) &&
      channelIsComplete(payload.transcript)
    );
  }
  if (channel === "whatsapp") {
    return (
      channelIsComplete(payload.whatsapp) &&
      channelIsComplete(payload.email) &&
      channelIsComplete(payload.transcript)
    );
  }
  return channelIsComplete(payload.email);
}

export type ResolutionOutboxDrainCounts = {
  claimed: number;
  sent: number;
  retryable: number;
  terminal: number;
  skipped: number;
};

export function emptyResolutionOutboxDrainCounts(): ResolutionOutboxDrainCounts {
  return { claimed: 0, sent: 0, retryable: 0, terminal: 0, skipped: 0 };
}

type ResolutionJobRow = {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  idempotency_key: string;
  delivery_status: string;
  delivery_attempt_count: number;
  payload: ResolutionJobPayload | null;
};

export type ResolutionOutboxDeps = {
  supabase: SupabaseClient;
  now?: Date;
  sendResolutionEmail?: typeof sendResolutionEmail;
  sendStaffInstagramReply?: typeof sendStaffInstagramReply;
  sendStaffWhatsAppReply?: typeof sendStaffWhatsAppReply;
  sendTranscriptEmail?: typeof sendInstagramResolutionTranscriptEmail;
  loadTicket?: (ticketId: string) => Promise<DbTicket | null>;
};

function isUndefinedTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("does not exist");
}

function nextBackoffIso(now: Date, attemptCount: number): string {
  const delay = TICKET_RESOLUTION_OUTBOX_BACKOFF_MS * 2 ** Math.max(0, attemptCount - 1);
  return new Date(now.getTime() + delay).toISOString();
}

async function loadTicketById(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<DbTicket | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("id", ticketId)
    .maybeSingle();
  if (error || !data) return null;
  return data as DbTicket;
}

async function listDueJobs(
  supabase: SupabaseClient,
  nowIso: string,
  jobId?: string,
): Promise<ResolutionJobRow[]> {
  let query = supabase
    .from("ticket_resolution_jobs")
    .select(
      "id, ticket_id, comment_id, idempotency_key, delivery_status, delivery_attempt_count, payload",
    )
    .in("delivery_status", ["pending", "failed"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .lt("delivery_attempt_count", TICKET_RESOLUTION_OUTBOX_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(jobId ? 1 : TICKET_RESOLUTION_OUTBOX_DRAIN_BATCH);

  if (jobId) query = query.eq("id", jobId);

  const { data, error } = await query;
  if (error) {
    if (!isUndefinedTable(error)) {
      logSupabaseError("ticket resolution jobs list failed", error);
    }
    return [];
  }
  return (data ?? []) as ResolutionJobRow[];
}

async function claimJob(
  supabase: SupabaseClient,
  job: ResolutionJobRow,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_ticket_resolution_job", {
    p_job_id: job.id,
    p_now: now.toISOString(),
    p_max_attempts: TICKET_RESOLUTION_OUTBOX_MAX_ATTEMPTS,
  });
  if (!error && data && typeof data === "object") {
    const outcome = (data as { outcome?: string }).outcome;
    return outcome === "claimed";
  }

  const leaseUntil = new Date(
    now.getTime() + TICKET_RESOLUTION_OUTBOX_CLAIM_LEASE_MS,
  ).toISOString();
  const claimed = await supabase
    .from("ticket_resolution_jobs")
    .update({
      delivery_attempt_count: job.delivery_attempt_count + 1,
      last_attempt_at: now.toISOString(),
      next_attempt_at: leaseUntil,
      delivery_status: "pending",
      updated_at: now.toISOString(),
    })
    .eq("id", job.id)
    .eq("delivery_attempt_count", job.delivery_attempt_count)
    .in("delivery_status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  return Boolean(claimed.data?.id) && !claimed.error;
}

async function markJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: {
    delivery_status: "sent" | "failed" | "skipped";
    last_error_code?: string | null;
    next_attempt_at?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("ticket_resolution_jobs")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error && !isUndefinedTable(error)) {
    logSupabaseError("ticket resolution job mark failed", error);
  }
}

async function patchJobPayload(
  supabase: SupabaseClient,
  job: ResolutionJobRow,
  patch: ResolutionJobPayload,
): Promise<ResolutionJobPayload> {
  const payload = { ...(job.payload ?? {}), ...patch };
  job.payload = payload;
  const { error } = await supabase
    .from("ticket_resolution_jobs")
    .update({
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error && !isUndefinedTable(error)) {
    logSupabaseError("ticket resolution job payload update failed", error);
  }
  return payload;
}

function toChannelState(
  value: "sent" | "failed" | "skipped" | undefined,
  alreadySent?: boolean,
): ResolutionChannelState {
  if (alreadySent && (value === "sent" || value === undefined)) return "sent";
  if (value === "sent" || value === "skipped" || value === "failed") return value;
  return "failed";
}

async function deliverInstagramAndEmail(input: {
  ticket: DbTicket;
  commentId: string;
  resolutionSummary: string;
  payload: ResolutionJobPayload;
  deps: ResolutionOutboxDeps;
}): Promise<{
  payload: ResolutionJobPayload;
  errorCode: string | null;
  retryable: boolean;
}> {
  if (
    channelIsComplete(input.payload.instagram) &&
    channelIsComplete(input.payload.email)
  ) {
    return { payload: input.payload, errorCode: null, retryable: false };
  }
  const sendIg = input.deps.sendStaffInstagramReply ?? sendStaffInstagramReply;
  const ig = await sendIg({
    ticket: input.ticket,
    commentId: input.commentId,
    commentText: input.resolutionSummary,
    allowResolvedTicket: true,
    skipInstagramDelivery: channelIsComplete(input.payload.instagram),
  });
  if (!ig.ok) {
    const terminal = TERMINAL_CHANNEL_CODES.has(ig.errorCode);
    return {
      payload: {
        ...input.payload,
        instagram: terminal ? "skipped" : "failed",
      },
      errorCode: ig.errorCode,
      retryable: !terminal,
    };
  }
  return {
    payload: {
      ...input.payload,
      instagram: toChannelState(ig.instagram, ig.alreadySent),
      email: toChannelState(ig.email),
    },
    errorCode: ig.instagramErrorCode ?? (ig.email === "failed" ? "email_send_failed" : null),
    retryable: ig.instagram === "failed" || ig.email === "failed",
  };
}

async function deliverWhatsAppAndEmail(input: {
  ticket: DbTicket;
  commentId: string;
  resolutionSummary: string;
  payload: ResolutionJobPayload;
  deps: ResolutionOutboxDeps;
}): Promise<{
  payload: ResolutionJobPayload;
  errorCode: string | null;
  retryable: boolean;
}> {
  if (
    channelIsComplete(input.payload.whatsapp) &&
    channelIsComplete(input.payload.email)
  ) {
    return { payload: input.payload, errorCode: null, retryable: false };
  }
  const sendWa = input.deps.sendStaffWhatsAppReply ?? sendStaffWhatsAppReply;
  const wa = await sendWa({
    ticket: input.ticket,
    commentId: input.commentId,
    commentText: input.resolutionSummary,
    allowResolvedTicket: true,
    skipWhatsAppDelivery: channelIsComplete(input.payload.whatsapp),
  });
  if (!wa.ok) {
    const terminal = TERMINAL_CHANNEL_CODES.has(wa.errorCode);
    return {
      payload: {
        ...input.payload,
        whatsapp: terminal ? "skipped" : "failed",
      },
      errorCode: wa.errorCode,
      retryable: !terminal,
    };
  }
  return {
    payload: {
      ...input.payload,
      whatsapp: toChannelState(wa.whatsapp, wa.alreadySent),
      email: toChannelState(wa.email),
    },
    errorCode: wa.whatsappErrorCode ?? (wa.email === "failed" ? "email_send_failed" : null),
    retryable: wa.whatsapp === "failed" || wa.email === "failed",
  };
}

async function deliverWebsiteEmail(input: {
  ticket: DbTicket;
  resolutionSummary: string;
  payload: ResolutionJobPayload;
  deps: ResolutionOutboxDeps;
}): Promise<{
  payload: ResolutionJobPayload;
  errorCode: string | null;
  retryable: boolean;
}> {
  if (channelIsComplete(input.payload.email)) {
    return { payload: input.payload, errorCode: null, retryable: false };
  }
  const sendEmail = input.deps.sendResolutionEmail ?? sendResolutionEmail;
  const mailed = await sendEmail({
    ticket: input.ticket,
    resolutionSummary: input.resolutionSummary,
  });
  if (!mailed.ok) {
    const missingRecipient = /missing or invalid/i.test(mailed.error);
    return {
      payload: {
        ...input.payload,
        email: missingRecipient ? "skipped" : "failed",
      },
      errorCode: missingRecipient ? "creator_email_invalid" : "email_send_failed",
      retryable: !missingRecipient,
    };
  }
  return {
    payload: { ...input.payload, email: "sent" },
    errorCode: null,
    retryable: false,
  };
}

async function sendTranscriptIfNeeded(input: {
  ticket: DbTicket;
  commentId: string | null;
  resolutionSummary: string;
  payload: ResolutionJobPayload;
  deps: ResolutionOutboxDeps;
}): Promise<ResolutionChannelState> {
  if (channelIsComplete(input.payload.transcript)) {
    return input.payload.transcript ?? "sent";
  }
  if (!isInstagramTicket(input.ticket) && !isWhatsAppTicket(input.ticket)) {
    return "skipped";
  }
  if (!input.ticket.external_conversation_id || !input.commentId) return "skipped";

  let store;
  try {
    store = createAdminInstagramStore();
  } catch {
    return "skipped";
  }
  const channel = isWhatsAppTicket(input.ticket) ? "whatsapp" : "instagram";
  const conversation = await store.getConversation(
    channel,
    input.ticket.external_conversation_id,
  );
  if (!conversation) return "skipped";
  if ("errorCode" in conversation) return "failed";

  const rows = await store.listSupportTranscript({
    conversationId: conversation.id,
    ticketId: input.ticket.id,
  });
  const transcriptText = rows
    .map((row) => {
      const who = row.direction === "inbound" ? "Creator" : "Cloutflow";
      return `${who}: ${row.messageBody}`;
    })
    .join("\n\n");
  const purpose = isWhatsAppTicket(input.ticket)
    ? "whatsapp-resolution-transcript"
    : "instagram-resolution-transcript";
  const claim = await store.claimEmailDelivery({
    ticketId: input.ticket.id,
    conversationId: conversation.id,
    commentId: input.commentId,
    purpose,
    idempotencyKey: `email:${channel === "whatsapp" ? "wa" : "ig"}-resolve:${input.ticket.id}`,
  });
  if (claim.outcome === "duplicate") {
    return claim.deliveryStatus === "sent" || claim.deliveryStatus === "skipped"
      ? (claim.deliveryStatus as ResolutionChannelState)
      : "failed";
  }
  if (claim.outcome !== "claimed") return "failed";

  const sendTranscript =
    input.deps.sendTranscriptEmail ?? sendInstagramResolutionTranscriptEmail;
  const mailed = await sendTranscript({
    ticket: input.ticket,
    transcriptText,
    resolutionSummary: input.resolutionSummary,
  });
  await store.markEmailDelivery(claim.id, {
    deliveryStatus:
      mailed.outcome === "sent"
        ? "sent"
        : mailed.outcome === "skipped"
          ? "skipped"
          : "failed",
    brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
    errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
  });
  return mailed.outcome === "sent"
    ? "sent"
    : mailed.outcome === "skipped"
      ? "skipped"
      : "failed";
}

function primaryChannelsComplete(
  payload: ResolutionJobPayload,
  sourceChannel: string,
): boolean {
  const channel = sourceChannel.trim().toLowerCase();
  if (channel === "instagram") {
    return channelIsComplete(payload.instagram) && channelIsComplete(payload.email);
  }
  if (channel === "whatsapp") {
    return channelIsComplete(payload.whatsapp) && channelIsComplete(payload.email);
  }
  return channelIsComplete(payload.email);
}

export async function drainResolutionJobs(
  deps: ResolutionOutboxDeps,
  options: { jobId?: string } = {},
): Promise<ResolutionOutboxDrainCounts> {
  const counts = emptyResolutionOutboxDrainCounts();
  const now = deps.now ?? new Date();
  const jobs = await listDueJobs(deps.supabase, now.toISOString(), options.jobId);
  const loadTicket = deps.loadTicket ?? ((id: string) => loadTicketById(deps.supabase, id));

  for (const job of jobs) {
    const claimed = await claimJob(deps.supabase, job, now);
    if (!claimed) {
      counts.skipped += 1;
      continue;
    }
    counts.claimed += 1;

    const ticket = await loadTicket(job.ticket_id);
    if (!ticket) {
      counts.terminal += 1;
      await markJob(deps.supabase, job.id, {
        delivery_status: "failed",
        last_error_code: "ticket_not_found",
        next_attempt_at: null,
      });
      continue;
    }

    const summary =
      (typeof job.payload?.resolution_summary === "string"
        ? job.payload.resolution_summary
        : ticket.resolution_summary) ?? "";
    let payload: ResolutionJobPayload = {
      resolution_summary: summary,
      source_channel: ticket.source_channel,
      ...(job.payload ?? {}),
    };
    let errorCode: string | null = null;
    let retryable = false;

    if (isInstagramTicket(ticket) && job.comment_id) {
      const ig = await deliverInstagramAndEmail({
        ticket,
        commentId: job.comment_id,
        resolutionSummary: summary,
        payload,
        deps,
      });
      payload = ig.payload;
      errorCode = ig.errorCode;
      retryable = ig.retryable;
    } else if (isWhatsAppTicket(ticket) && job.comment_id) {
      const wa = await deliverWhatsAppAndEmail({
        ticket,
        commentId: job.comment_id,
        resolutionSummary: summary,
        payload,
        deps,
      });
      payload = wa.payload;
      errorCode = wa.errorCode;
      retryable = wa.retryable;
    } else {
      const mailed = await deliverWebsiteEmail({
        ticket,
        resolutionSummary: summary,
        payload,
        deps,
      });
      payload = mailed.payload;
      errorCode = mailed.errorCode;
      retryable = mailed.retryable;
    }

    payload = await patchJobPayload(deps.supabase, job, payload);

    if (primaryChannelsComplete(payload, ticket.source_channel)) {
      const transcript = await sendTranscriptIfNeeded({
        ticket,
        commentId: job.comment_id,
        resolutionSummary: summary,
        payload,
        deps,
      });
      payload = await patchJobPayload(deps.supabase, job, { transcript });
      if (transcript === "failed") {
        retryable = true;
        errorCode = errorCode ?? "transcript_send_failed";
      }
    }

    const notificationsDone = resolutionJobNotificationsComplete(
      payload,
      ticket.source_channel,
    );

    if (job.comment_id && notificationsDone) {
      await updateCommentDeliveryStatus(deps.supabase, job.comment_id, "sent");
      payload = await patchJobPayload(deps.supabase, job, {
        comment_delivery: "sent",
      });
    } else if (job.comment_id) {
      await updateCommentDeliveryStatus(deps.supabase, job.comment_id, "failed");
      payload = await patchJobPayload(deps.supabase, job, {
        comment_delivery: "failed",
      });
    }

    if (notificationsDone && payload.customer_notified !== true) {
      await markTicketCustomerNotified(deps.supabase, ticket);
      payload = await patchJobPayload(deps.supabase, job, {
        customer_notified: true,
      });
    }

    if (notificationsDone) {
      counts.sent += 1;
      await markJob(deps.supabase, job.id, {
        delivery_status: "sent",
        last_error_code: null,
        next_attempt_at: null,
      });
      continue;
    }

    if (
      retryable &&
      job.delivery_attempt_count + 1 < TICKET_RESOLUTION_OUTBOX_MAX_ATTEMPTS
    ) {
      counts.retryable += 1;
      await markJob(deps.supabase, job.id, {
        delivery_status: "failed",
        last_error_code: errorCode,
        next_attempt_at: nextBackoffIso(now, job.delivery_attempt_count + 1),
      });
    } else {
      counts.terminal += 1;
      await markJob(deps.supabase, job.id, {
        delivery_status: "failed",
        last_error_code: errorCode,
        next_attempt_at: null,
      });
    }
  }

  return counts;
}

export async function scheduleResolutionJobDrain(
  jobId: string | null,
  drain: (jobId: string) => Promise<void> = async (id) => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await drainResolutionJobs({ supabase: createAdminClient() }, { jobId: id });
  },
): Promise<void> {
  if (!jobId) return;
  await scheduleAfterResponse(async () => {
    await drain(jobId);
  });
}

export type HandleResolutionOutboxDrainInput = {
  authorization: string | null;
  env?: Record<string, string | undefined>;
  deps: ResolutionOutboxDeps;
};

export async function handleTicketResolutionOutboxDrain(
  input: HandleResolutionOutboxDrainInput,
): Promise<
  | { status: 401; body: { error: string } }
  | { status: 200; body: ResolutionOutboxDrainCounts }
> {
  if (!verifyTicketResolutionOutboxDrainAuth(input.authorization, input.env)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const body = await drainResolutionJobs(input.deps);
  return { status: 200, body };
}
