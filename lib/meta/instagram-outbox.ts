import "server-only";

import type { InstagramQuickReply, MachineSendEffect } from "@/lib/meta/conversation-machine";
import {
  isInstagramTerminalSendError,
  sendInstagramQuickReplies,
  sendInstagramText,
  type InstagramSendDeps,
  type InstagramSendResult,
} from "@/lib/meta/instagram-send";
import type {
  DueInstagramOutboundRow,
  InstagramIngestStore,
  ReservedOutboundRow,
} from "@/lib/meta/instagram-store";
import { sanitizeInstagramOutboundPayload } from "@/lib/meta/instagram-outbound-payload";
import { INSTAGRAM_SEND_TIMEOUT_MS } from "@/lib/meta/instagram-send";
import {
  finishInstagramAttending,
  startInstagramRetryTyping,
  type InstagramAttendingSession,
} from "@/lib/meta/instagram-sender-actions";
import { timeInstagramMetric, type InstagramTimingSession } from "@/lib/meta/timing";

/**
 * Instagram chatbot Graph delivery is at-least-once.
 * A 10s abort is delivery-unknown (timeout_unknown): keep pending, wait for an
 * echo/mid or a grace-period retry. Terminal Graph errors are never webhook-500s.
 *
 * Claim takes a 60s durable lease via next_attempt_at so a second worker cannot
 * send after the RPC transaction returns.
 */
export const INSTAGRAM_OUTBOX_MAX_ATTEMPTS = 5;
export const INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS = 30_000;
export const INSTAGRAM_OUTBOX_BACKOFF_BASE_MS = 15_000;
export const INSTAGRAM_OUTBOX_BACKOFF_MAX_MS = 15 * 60 * 1000;
export const INSTAGRAM_OUTBOX_CLAIM_LEASE_MS = 60_000;
/**
 * Drain handler budget: pg_net times out at 45s. Graph send aborts at 10s.
 * Batch 2 ⇒ worst-case Graph 20s + persist slack. 8s is reserved for email
 * so Graph timeouts cannot starve internal-email retries.
 */
export const INSTAGRAM_OUTBOX_DRAIN_DEADLINE_MS = 35_000;
export const INSTAGRAM_OUTBOX_GRAPH_BUDGET_MS = 26_000;
export const INSTAGRAM_OUTBOX_CLAIM_SLACK_MS = INSTAGRAM_SEND_TIMEOUT_MS + 2_000;
export const INSTAGRAM_OUTBOX_DRAIN_BATCH = 2;

export type InstagramOutboxDrainCounts = {
  claimed: number;
  sent: number;
  retryable: number;
  terminal: number;
};

export type InstagramOutboxPersistKind = "sent" | "retryable" | "terminal";

export function emptyInstagramOutboxDrainCounts(): InstagramOutboxDrainCounts {
  return { claimed: 0, sent: 0, retryable: 0, terminal: 0 };
}

export function instagramOutboxBackoffMs(attemptCount: number): number {
  const exp = Math.max(0, attemptCount - 1);
  return Math.min(
    INSTAGRAM_OUTBOX_BACKOFF_MAX_MS,
    INSTAGRAM_OUTBOX_BACKOFF_BASE_MS * 2 ** exp,
  );
}

export function nextInstagramAttemptAt(
  errorCode: string | null,
  attemptCount: number,
  now: Date = new Date(),
): string {
  const delayMs =
    errorCode === "timeout_unknown"
      ? INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS
      : instagramOutboxBackoffMs(attemptCount);
  return new Date(now.getTime() + delayMs).toISOString();
}

export function instagramOutboundClaimLeaseUntil(
  now: Date = new Date(),
): string {
  return new Date(now.getTime() + INSTAGRAM_OUTBOX_CLAIM_LEASE_MS).toISOString();
}

export type DrainClock = {
  nowMs: () => number;
};

function defaultClock(): DrainClock {
  return { nowMs: () => Date.now() };
}

export type DrainInstagramOutboxInput = {
  store: InstagramIngestStore;
  recipientId: string;
  conversationId: string;
  sendDeps?: InstagramSendDeps;
  reserved?: ReservedOutboundRow[];
  effects?: MachineSendEffect[];
  now?: Date;
  attending?: InstagramAttendingSession | null;
  typingMode?: "off_only" | "before_send" | "none";
  timing?: InstagramTimingSession;
};

function quickRepliesFromStoredPayload(
  messageBody: string,
  rawPayload: unknown,
): { text: string; quickReplies: InstagramQuickReply[] | null } {
  const sanitized = sanitizeInstagramOutboundPayload({
    text: messageBody,
    rawPayload,
  });
  return {
    text: sanitized?.text || messageBody,
    quickReplies: sanitized?.quick_replies ?? null,
  };
}

async function sendStoredOutbound(
  row: {
    id: string;
    messageBody: string;
    rawPayload?: unknown;
  },
  effect: MachineSendEffect | undefined,
  recipientId: string,
  sendDeps?: InstagramSendDeps,
): Promise<InstagramSendResult> {
  const fromStore = quickRepliesFromStoredPayload(row.messageBody, row.rawPayload);
  const quickReplies =
    effect?.type === "send_quick_replies" && effect.quickReplies?.length
      ? effect.quickReplies
      : fromStore.quickReplies;
  const text = effect?.text ?? fromStore.text;
  if (quickReplies && quickReplies.length > 0) {
    return sendInstagramQuickReplies({
      recipientId,
      text,
      quickReplies,
      deps: sendDeps,
    });
  }
  return sendInstagramText({
    recipientId,
    text,
    deps: sendDeps,
  });
}

export async function persistInstagramSendResult(
  store: InstagramIngestStore,
  outboundId: string,
  result: InstagramSendResult,
  attemptCount: number,
  now: Date,
): Promise<InstagramOutboxPersistKind> {
  if (result.ok) {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "sent",
      externalMessageId: result.metaMessageId,
      deliveryErrorCode: null,
      nextAttemptAt: null,
    });
    return "sent";
  }

  if (result.deliveryUnknown || result.errorCode === "timeout_unknown") {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "pending",
      deliveryErrorCode: "timeout_unknown",
      nextAttemptAt: nextInstagramAttemptAt("timeout_unknown", attemptCount, now),
      lastAttemptAt: now.toISOString(),
    });
    return "retryable";
  }

  if (
    !result.retryable ||
    isInstagramTerminalSendError(result.errorCode) ||
    attemptCount >= INSTAGRAM_OUTBOX_MAX_ATTEMPTS
  ) {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "failed",
      deliveryErrorCode:
        attemptCount >= INSTAGRAM_OUTBOX_MAX_ATTEMPTS && result.retryable
          ? "outbound_attempts_exhausted"
          : result.errorCode,
      nextAttemptAt: null,
      lastAttemptAt: now.toISOString(),
    });
    return "terminal";
  }

  await store.markOutboundMessage(outboundId, {
    deliveryStatus: "failed",
    deliveryErrorCode: result.errorCode,
    nextAttemptAt: nextInstagramAttemptAt(result.errorCode, attemptCount, now),
    lastAttemptAt: now.toISOString(),
  });
  return "retryable";
}

async function drainQueuedInstagramOutbounds(
  store: InstagramIngestStore,
  queued: Array<{
    id: string;
    messageBody: string;
    rawPayload?: unknown;
    recipientId: string;
    effect?: MachineSendEffect;
  }>,
  sendDeps: InstagramSendDeps | undefined,
  now: Date,
  options: {
    deadlineAtMs?: number;
    clock?: DrainClock;
    claimSlackMs?: number;
    typingMode?: "off_only" | "before_send" | "none";
    attending?: InstagramAttendingSession | null;
    timing?: InstagramTimingSession;
  } = {},
): Promise<InstagramOutboxDrainCounts> {
  const counts = emptyInstagramOutboxDrainCounts();
  const clock = options.clock ?? defaultClock();
  const slack = options.claimSlackMs ?? INSTAGRAM_OUTBOX_CLAIM_SLACK_MS;
  const typingMode = options.typingMode ?? "none";
  try {
    for (const item of queued) {
      if (
        options.deadlineAtMs != null &&
        clock.nowMs() + slack > options.deadlineAtMs
      ) {
        break;
      }
      if (!item.recipientId.trim()) {
        counts.claimed += 1;
        counts.terminal += 1;
        await store.markOutboundMessage(item.id, {
          deliveryStatus: "failed",
          deliveryErrorCode: "invalid_recipient",
          nextAttemptAt: null,
          lastAttemptAt: now.toISOString(),
        });
        continue;
      }
      const claimed = await store.claimInstagramOutboundSend({
        id: item.id,
        now: now.toISOString(),
        maxAttempts: INSTAGRAM_OUTBOX_MAX_ATTEMPTS,
      });
      if (claimed.outcome !== "claimed") continue;
      counts.claimed += 1;
      const retryAttending =
        typingMode === "before_send"
          ? startInstagramRetryTyping({
              recipientId: item.recipientId,
              deps: sendDeps,
              timing: options.timing,
            })
          : null;
      let result: InstagramSendResult;
      try {
        result = await timeInstagramMetric(
          options.timing,
          "instagram_graph_send_ms",
          () => sendStoredOutbound(item, item.effect, item.recipientId, sendDeps),
        );
      } catch {
        result = {
          ok: false,
          errorCode: "timeout_unknown",
          retryable: true,
          messagingWindowExpired: false,
          deliveryUnknown: true,
          httpStatus: null,
        };
      } finally {
        if (typingMode === "before_send") {
          await finishInstagramAttending(retryAttending);
        }
      }
      const resultAt = options.clock
        ? new Date(clock.nowMs())
        : new Date();
      const kind = await persistInstagramSendResult(
        store,
        item.id,
        result,
        claimed.attemptCount,
        resultAt,
      );
      counts[kind] += 1;
    }
    return counts;
  } finally {
    if (typingMode === "off_only") {
      await finishInstagramAttending(options.attending);
    }
  }
}

/**
 * Claim and send reserved/due Instagram chatbot outbounds for one conversation.
 * Safe for concurrent workers: claimInstagramOutboundSend is compare-and-set.
 */
export async function drainInstagramOutbox(
  input: DrainInstagramOutboxInput,
): Promise<InstagramOutboxDrainCounts> {
  const now = input.now ?? new Date();
  const effectsByIndex = input.effects ?? [];
  const reserved = input.reserved;

  const queued: Array<{
    id: string;
    messageBody: string;
    rawPayload?: unknown;
    recipientId: string;
    effect?: MachineSendEffect;
  }> = [];

  if (reserved) {
    for (let index = 0; index < reserved.length; index += 1) {
      const row = reserved[index];
      if (!row) continue;
      if (
        row.deliveryStatus === "sent" ||
        row.deliveryStatus === "delivered" ||
        row.deliveryStatus === "read"
      ) {
        continue;
      }
      queued.push({
        id: row.id,
        messageBody: effectsByIndex[index]?.text ?? "",
        effect: effectsByIndex[index],
        recipientId: input.recipientId,
      });
    }
  } else {
    const due = await input.store.listDueInstagramOutbounds(
      input.conversationId,
      now.toISOString(),
    );
    if ("errorCode" in due) return emptyInstagramOutboxDrainCounts();
    for (const row of due) {
      queued.push(dueRowToQueued(row, input.recipientId));
    }
  }

  const typingMode =
    input.typingMode ?? (reserved ? "off_only" : "before_send");
  return drainQueuedInstagramOutbounds(
    input.store,
    queued,
    input.sendDeps,
    now,
    {
      typingMode,
      attending: input.attending,
      timing: input.timing,
    },
  );
}

function dueRowToQueued(
  row: DueInstagramOutboundRow,
  fallbackRecipientId?: string,
) {
  return {
    id: row.id,
    messageBody: row.messageBody,
    rawPayload: row.rawPayload,
    recipientId: row.recipientExternalId || fallbackRecipientId || "",
  };
}

/**
 * Independent recovery drain: claim a bounded batch of due Instagram outbounds
 * across conversations. Concurrent callers cannot double-send (compare-and-set).
 */
export async function drainDueInstagramOutbox(input: {
  store: InstagramIngestStore;
  sendDeps?: InstagramSendDeps;
  now?: Date;
  limit?: number;
  deadlineAtMs?: number;
  clock?: DrainClock;
}): Promise<InstagramOutboxDrainCounts> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? INSTAGRAM_OUTBOX_DRAIN_BATCH;
  const due = await input.store.listDueInstagramOutboxBatch({
    nowIso: now.toISOString(),
    limit,
  });
  if ("errorCode" in due) return emptyInstagramOutboxDrainCounts();
  return drainQueuedInstagramOutbounds(
    input.store,
    due.map((row) => dueRowToQueued(row)),
    input.sendDeps,
    now,
    {
      deadlineAtMs: input.deadlineAtMs,
      clock: input.clock,
      typingMode: "before_send",
    },
  );
}
