import {
  WEBHOOK_PROCESSING_LEASE_MS,
  WEBHOOK_STATUS_COMPLETED,
  WEBHOOK_STATUS_FAILED,
  WEBHOOK_STATUS_IGNORED,
  WEBHOOK_STATUS_PROCESSED,
  WEBHOOK_STATUS_PROCESSING,
  WEBHOOK_STATUS_RECEIVED,
} from "@/lib/meta/constants";
import {
  IDENTITY_AMBIGUOUS,
  IDENTITY_MISSING,
} from "@/lib/meta/conversation-identity";

export type WebhookEventClaimInput = {
  provider: string;
  externalEventId: string;
  payload: unknown;
  payloadHash: string | null;
};

export type WebhookEventClaimResult =
  | { outcome: "claimed" | "retry"; id: string }
  | { outcome: "already_processed" };

export type WebhookEventClaimState = {
  id: string;
  processingStatus: string;
  processedAt?: string | null;
};

export type ExistingWebhookClaimDecision =
  | { action: "already_processed" }
  | { action: "lease_held" }
  | { action: "reclaim" };

/**
 * Deterministic identity rejections. Revalidate on reclaim; if still true,
 * acknowledge Meta (HTTP 200) instead of retrying forever.
 */
export function isTerminalWebhookIdentityError(
  errorCode: string | null | undefined,
): boolean {
  return errorCode === IDENTITY_MISSING || errorCode === IDENTITY_AMBIGUOUS;
}

/**
 * Instagram webhook HTTP class. Infrastructure and persistence failures stay
 * retryable. Identity missing/ambiguous/mismatch is fail-closed and terminal.
 */
export function isRetryableInstagramWebhookFailure(
  errorCode: string | null | undefined,
): boolean {
  if (isTerminalWebhookIdentityError(errorCode)) return false;
  return true;
}

export function isAcknowledgedWebhookStatus(status: string): boolean {
  return (
    status === WEBHOOK_STATUS_COMPLETED ||
    status === WEBHOOK_STATUS_PROCESSED ||
    status === WEBHOOK_STATUS_IGNORED
  );
}

function leaseStartMs(processedAt: string | null | undefined): number | null {
  if (!processedAt) return null;
  const parsed = Date.parse(processedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export function decideExistingWebhookEventClaim(
  row: WebhookEventClaimState,
  nowMs: number,
  leaseMs: number = WEBHOOK_PROCESSING_LEASE_MS,
): ExistingWebhookClaimDecision {
  const status = String(row.processingStatus ?? "");
  if (isAcknowledgedWebhookStatus(status)) {
    return { action: "already_processed" };
  }
  if (status === WEBHOOK_STATUS_PROCESSING) {
    const started = leaseStartMs(row.processedAt);
    if (started !== null && nowMs - started < leaseMs) {
      return { action: "lease_held" };
    }
    return { action: "reclaim" };
  }
  if (
    status === WEBHOOK_STATUS_FAILED ||
    status === WEBHOOK_STATUS_RECEIVED ||
    status.length === 0
  ) {
    return { action: "reclaim" };
  }
  return { action: "already_processed" };
}

/**
 * Compare-and-swap claim over an in-memory webhook_events table.
 * Must not await; callers rely on this running atomically on one event loop.
 */
export function applyWebhookEventClaim(
  events: Array<Record<string, unknown>>,
  input: WebhookEventClaimInput,
  nextId: () => string,
  nowMs: number = Date.now(),
): WebhookEventClaimResult {
  const existing = events.find(
    (row) =>
      row.provider === input.provider &&
      row.externalEventId === input.externalEventId,
  );
  const leaseAt = new Date(nowMs).toISOString();
  if (!existing) {
    const id = nextId();
    events.push({
      id,
      provider: input.provider,
      externalEventId: input.externalEventId,
      payload: input.payload,
      payloadHash: input.payloadHash,
      processingStatus: WEBHOOK_STATUS_PROCESSING,
      processedAt: leaseAt,
      errorCode: null,
      errorMessage: null,
    });
    return { outcome: "claimed", id };
  }

  const decision = decideExistingWebhookEventClaim(
    {
      id: String(existing.id),
      processingStatus: String(existing.processingStatus ?? ""),
      processedAt: (existing.processedAt as string | null | undefined) ?? null,
    },
    nowMs,
  );
  if (
    decision.action === "already_processed" ||
    decision.action === "lease_held"
  ) {
    return { outcome: "already_processed" };
  }

  existing.processingStatus = WEBHOOK_STATUS_PROCESSING;
  existing.errorCode = null;
  existing.errorMessage = null;
  existing.processedAt = leaseAt;
  return { outcome: "retry", id: existing.id as string };
}

export function applyWebhookEventMark(
  events: Array<Record<string, unknown>>,
  id: string,
  status: "completed" | "failed",
  errorCode: string | null = null,
  nowMs: number = Date.now(),
): void {
  const row = events.find((event) => event.id === id);
  if (!row) return;
  const failed = status === WEBHOOK_STATUS_FAILED;
  row.processingStatus = status;
  row.errorCode = failed ? errorCode : null;
  row.errorMessage = failed ? errorCode : null;
  row.processedAt = failed ? null : new Date(nowMs).toISOString();
}
