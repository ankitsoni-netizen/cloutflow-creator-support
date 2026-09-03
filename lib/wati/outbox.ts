import "server-only";

import type { InstagramQuickReply, MachineSendEffect } from "@/lib/meta/conversation-machine";
import { sanitizeInstagramOutboundPayload } from "@/lib/meta/instagram-outbound-payload";
import type {
  DueInstagramOutboundRow,
  InstagramIngestStore,
  ReservedOutboundRow,
} from "@/lib/meta/instagram-store";
import {
  sendWhatsAppProviderReplyButtons,
  sendWhatsAppProviderText,
  type WhatsAppProviderSendDeps,
} from "@/lib/meta/whatsapp-provider";
import type { WhatsAppSendResult } from "@/lib/meta/whatsapp-send";
import { WATI_SEND_TIMEOUT_MS } from "@/lib/wati/constants";
import { isWatiTerminalSendError } from "@/lib/wati/outbox-errors";

export { isWatiTerminalSendError, WATI_TERMINAL_SEND_CODES } from "@/lib/wati/outbox-errors";

/**
 * WATI chatbot delivery is at-least-once.
 * A 10s abort is delivery-unknown (`send_timeout`): keep pending, wait for a
 * WATI message id or the grace-period retry. Terminal errors are never retried.
 *
 * Claim takes a 60s durable lease via next_attempt_at so a second worker cannot
 * send after the RPC transaction returns.
 */
export const WATI_OUTBOX_MAX_ATTEMPTS = 5;
export const WATI_OUTBOX_TIMEOUT_GRACE_MS = 30_000;
export const WATI_OUTBOX_BACKOFF_BASE_MS = 15_000;
export const WATI_OUTBOX_BACKOFF_MAX_MS = 15 * 60 * 1000;
export const WATI_OUTBOX_CLAIM_LEASE_MS = 60_000;
export const WATI_OUTBOX_DRAIN_DEADLINE_MS = 35_000;
export const WATI_OUTBOX_SEND_BUDGET_MS = 26_000;
export const WATI_OUTBOX_CLAIM_SLACK_MS = WATI_SEND_TIMEOUT_MS + 2_000;
export const WATI_OUTBOX_DRAIN_BATCH = 2;

const FINAL_DELIVERY = new Set(["sent", "delivered", "read"]);

export type WatiOutboxDrainCounts = {
  claimed: number;
  sent: number;
  retryable: number;
  terminal: number;
};

export type WatiOutboxPersistKind = "sent" | "retryable" | "terminal";

export type DrainWatiOutboxResult = WatiOutboxDrainCounts & {
  retryableFailure: boolean;
  drained: number;
  skipped: number;
};

export function emptyWatiOutboxDrainCounts(): WatiOutboxDrainCounts {
  return { claimed: 0, sent: 0, retryable: 0, terminal: 0 };
}

export function watiOutboxBackoffMs(attemptCount: number): number {
  const exp = Math.max(0, attemptCount - 1);
  return Math.min(
    WATI_OUTBOX_BACKOFF_MAX_MS,
    WATI_OUTBOX_BACKOFF_BASE_MS * 2 ** exp,
  );
}

export function nextWatiAttemptAt(
  errorCode: string | null,
  attemptCount: number,
  now: Date = new Date(),
): string {
  const delayMs =
    errorCode === "send_timeout" || errorCode === "timeout_unknown"
      ? WATI_OUTBOX_TIMEOUT_GRACE_MS
      : watiOutboxBackoffMs(attemptCount);
  return new Date(now.getTime() + delayMs).toISOString();
}

export function watiOutboundClaimLeaseUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + WATI_OUTBOX_CLAIM_LEASE_MS).toISOString();
}

export type DrainClock = {
  nowMs: () => number;
};

function defaultClock(): DrainClock {
  return { nowMs: () => Date.now() };
}

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

async function sendStoredWatiOutbound(
  row: { messageBody: string; rawPayload?: unknown },
  recipientId: string,
  sendDeps?: WhatsAppProviderSendDeps,
): Promise<WhatsAppSendResult> {
  const fromStore = quickRepliesFromStoredPayload(row.messageBody, row.rawPayload);
  if (fromStore.quickReplies && fromStore.quickReplies.length > 0) {
    return sendWhatsAppProviderReplyButtons({
      recipientId,
      text: fromStore.text,
      quickReplies: fromStore.quickReplies,
      deps: sendDeps,
    });
  }
  return sendWhatsAppProviderText({
    recipientId,
    text: fromStore.text,
    deps: sendDeps,
  });
}

export async function persistWatiSendResult(
  store: InstagramIngestStore,
  outboundId: string,
  result: WhatsAppSendResult,
  attemptCount: number,
  now: Date,
): Promise<WatiOutboxPersistKind> {
  if (result.ok) {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "sent",
      externalMessageId: result.metaMessageId,
      deliveryErrorCode: null,
      nextAttemptAt: null,
    });
    return "sent";
  }

  if (result.errorCode === "send_timeout" || result.errorCode === "timeout_unknown") {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "pending",
      deliveryErrorCode: result.errorCode,
      nextAttemptAt: nextWatiAttemptAt(result.errorCode, attemptCount, now),
      lastAttemptAt: now.toISOString(),
    });
    return "retryable";
  }

  if (
    !result.retryable ||
    isWatiTerminalSendError(result.errorCode) ||
    attemptCount >= WATI_OUTBOX_MAX_ATTEMPTS
  ) {
    await store.markOutboundMessage(outboundId, {
      deliveryStatus: "failed",
      deliveryErrorCode:
        attemptCount >= WATI_OUTBOX_MAX_ATTEMPTS && result.retryable
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
    nextAttemptAt: nextWatiAttemptAt(result.errorCode, attemptCount, now),
    lastAttemptAt: now.toISOString(),
  });
  return "retryable";
}

type QueuedWatiOutbound = {
  id: string;
  messageBody: string;
  rawPayload?: unknown;
  recipientId: string;
  deliveryStatus?: string;
  purpose?: string | null;
};

async function drainQueuedWatiOutbounds(
  store: InstagramIngestStore,
  queued: QueuedWatiOutbound[],
  sendDeps: WhatsAppProviderSendDeps | undefined,
  now: Date,
  options: { deadlineAtMs?: number; clock?: DrainClock } = {},
): Promise<DrainWatiOutboxResult> {
  const clock = options.clock ?? defaultClock();
  const slack = WATI_OUTBOX_CLAIM_SLACK_MS;
  const counts = emptyWatiOutboxDrainCounts();
  let skipped = 0;

  for (const item of queued) {
    if (
      options.deadlineAtMs != null &&
      clock.nowMs() + slack > options.deadlineAtMs
    ) {
      break;
    }
    if (item.purpose === "staff_reply") {
      skipped += 1;
      continue;
    }
    if (item.deliveryStatus && FINAL_DELIVERY.has(item.deliveryStatus)) {
      skipped += 1;
      continue;
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
    if (typeof store.claimWatiOutboundSend !== "function") {
      skipped += 1;
      continue;
    }
    const claimed = await store.claimWatiOutboundSend({
      id: item.id,
      now: now.toISOString(),
      maxAttempts: WATI_OUTBOX_MAX_ATTEMPTS,
    });
    if (claimed.outcome !== "claimed") {
      skipped += 1;
      continue;
    }
    counts.claimed += 1;
    let result: WhatsAppSendResult;
    try {
      result = await sendStoredWatiOutbound(item, item.recipientId, sendDeps);
    } catch {
      result = {
        ok: false,
        errorCode: "send_timeout",
        retryable: true,
        messagingWindowExpired: false,
        httpStatus: null,
      };
    }
    const kind = await persistWatiSendResult(
      store,
      item.id,
      result,
      claimed.attemptCount,
      options.clock ? new Date(clock.nowMs()) : new Date(),
    );
    counts[kind] += 1;
  }

  return {
    ...counts,
    retryableFailure: counts.retryable > 0,
    drained: counts.sent,
    skipped,
  };
}

function dueRowToQueued(
  row: DueInstagramOutboundRow,
  fallbackRecipientId?: string,
): QueuedWatiOutbound {
  return {
    id: row.id,
    messageBody: row.messageBody,
    rawPayload: row.rawPayload,
    recipientId: row.recipientExternalId || fallbackRecipientId || "",
    deliveryStatus: row.deliveryStatus,
    purpose: row.purpose,
  };
}

/**
 * Conversation-scoped recovery: claim and send due pending/failed WATI
 * automated text, button, and list messages. Delivered/sent/read and staff
 * replies never enter this drain.
 */
export async function drainWatiConversationOutbox(input: {
  store: InstagramIngestStore;
  recipientId: string;
  conversationId: string;
  sendDeps?: WhatsAppProviderSendDeps;
  now?: Date;
  reserved?: ReservedOutboundRow[];
  effects?: MachineSendEffect[];
}): Promise<DrainWatiOutboxResult> {
  const now = input.now ?? new Date();
  if (input.reserved) {
    const queued: QueuedWatiOutbound[] = [];
    for (let index = 0; index < input.reserved.length; index += 1) {
      const row = input.reserved[index];
      if (!row) continue;
      if (row.deliveryStatus && FINAL_DELIVERY.has(row.deliveryStatus)) {
        continue;
      }
      queued.push({
        id: row.id,
        messageBody: input.effects?.[index]?.text ?? "",
        rawPayload:
          input.effects?.[index]?.type === "send_quick_replies"
            ? {
                text: input.effects[index]?.text,
                quick_replies: input.effects[index]?.quickReplies,
              }
            : null,
        recipientId: input.recipientId,
        deliveryStatus: row.deliveryStatus,
      });
    }
    return drainQueuedWatiOutbounds(input.store, queued, input.sendDeps, now);
  }
  if (typeof input.store.listDueWatiOutbounds !== "function") {
    return { ...emptyWatiOutboxDrainCounts(), retryableFailure: false, drained: 0, skipped: 0 };
  }
  const due = await input.store.listDueWatiOutbounds(
    input.conversationId,
    now.toISOString(),
  );
  if ("errorCode" in due) {
    return { ...emptyWatiOutboxDrainCounts(), retryableFailure: false, drained: 0, skipped: 0 };
  }
  return drainQueuedWatiOutbounds(
    input.store,
    due.map((row) => dueRowToQueued(row, input.recipientId)),
    input.sendDeps,
    now,
  );
}

/**
 * Independent recovery drain across conversations. Concurrent callers cannot
 * double-send (compare-and-set claim lease).
 */
export async function drainDueWatiOutbox(input: {
  store: InstagramIngestStore;
  sendDeps?: WhatsAppProviderSendDeps;
  now?: Date;
  limit?: number;
  deadlineAtMs?: number;
  clock?: DrainClock;
}): Promise<WatiOutboxDrainCounts> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? WATI_OUTBOX_DRAIN_BATCH;
  if (typeof input.store.listDueWatiOutboxBatch !== "function") {
    return emptyWatiOutboxDrainCounts();
  }
  const due = await input.store.listDueWatiOutboxBatch({
    nowIso: now.toISOString(),
    limit,
  });
  if ("errorCode" in due) return emptyWatiOutboxDrainCounts();
  const result = await drainQueuedWatiOutbounds(
    input.store,
    due.map((row) => dueRowToQueued(row)),
    input.sendDeps,
    now,
    { deadlineAtMs: input.deadlineAtMs, clock: input.clock },
  );
  return {
    claimed: result.claimed,
    sent: result.sent,
    retryable: result.retryable,
    terminal: result.terminal,
  };
}
