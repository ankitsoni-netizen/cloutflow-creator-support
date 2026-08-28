import { describe, expect, it } from "vitest";
import {
  WEBHOOK_PROCESSING_LEASE_MS,
  WEBHOOK_STATUS_COMPLETED,
  WEBHOOK_STATUS_FAILED,
  WEBHOOK_STATUS_IGNORED,
  WEBHOOK_STATUS_PROCESSED,
  WEBHOOK_STATUS_PROCESSING,
  WEBHOOK_STATUS_RECEIVED,
} from "@/lib/meta/constants";
import { IDENTITY_AMBIGUOUS, IDENTITY_MISSING } from "@/lib/meta/conversation-identity";
import {
  applyWebhookEventClaim,
  decideExistingWebhookEventClaim,
  isRetryableInstagramWebhookFailure,
  isTerminalWebhookIdentityError,
} from "@/lib/meta/webhook-event-claim";

const NOW = Date.parse("2026-08-28T16:00:00.000Z");

describe("Instagram webhook failure class", () => {
  it("treats identity missing and ambiguous as terminal", () => {
    expect(isTerminalWebhookIdentityError(IDENTITY_MISSING)).toBe(true);
    expect(isTerminalWebhookIdentityError(IDENTITY_AMBIGUOUS)).toBe(true);
    expect(isRetryableInstagramWebhookFailure(IDENTITY_MISSING)).toBe(false);
    expect(isRetryableInstagramWebhookFailure(IDENTITY_AMBIGUOUS)).toBe(false);
  });

  it("keeps persistence and unexpected failures retryable", () => {
    expect(isRetryableInstagramWebhookFailure("conversation_lookup_failed")).toBe(
      true,
    );
    expect(isRetryableInstagramWebhookFailure("webhook_event_insert_failed")).toBe(
      true,
    );
    expect(isRetryableInstagramWebhookFailure("unexpected_failure")).toBe(true);
    expect(isRetryableInstagramWebhookFailure(null)).toBe(true);
  });
});

describe("webhook event claim decision", () => {
  it("does not reprocess completed, processed, or ignored rows", () => {
    for (const status of [
      WEBHOOK_STATUS_COMPLETED,
      WEBHOOK_STATUS_PROCESSED,
      WEBHOOK_STATUS_IGNORED,
    ]) {
      expect(
        decideExistingWebhookEventClaim(
          { id: "evt", processingStatus: status, processedAt: new Date(NOW).toISOString() },
          NOW,
        ),
      ).toEqual({ action: "already_processed" });
    }
  });

  it("holds a valid processing lease instead of concurrent reclaim", () => {
    expect(
      decideExistingWebhookEventClaim(
        {
          id: "evt",
          processingStatus: WEBHOOK_STATUS_PROCESSING,
          processedAt: new Date(NOW - 1_000).toISOString(),
        },
        NOW,
      ),
    ).toEqual({ action: "lease_held" });
  });

  it("reclaims expired or missing processing leases", () => {
    expect(
      decideExistingWebhookEventClaim(
        {
          id: "evt",
          processingStatus: WEBHOOK_STATUS_PROCESSING,
          processedAt: new Date(NOW - WEBHOOK_PROCESSING_LEASE_MS - 1).toISOString(),
        },
        NOW,
      ),
    ).toEqual({ action: "reclaim" });
    expect(
      decideExistingWebhookEventClaim(
        {
          id: "evt",
          processingStatus: WEBHOOK_STATUS_PROCESSING,
          processedAt: null,
        },
        NOW,
      ),
    ).toEqual({ action: "reclaim" });
  });

  it("reclaims failed and received rows including prior identity_ambiguous", () => {
    expect(
      decideExistingWebhookEventClaim(
        { id: "evt", processingStatus: WEBHOOK_STATUS_FAILED, processedAt: null },
        NOW,
      ),
    ).toEqual({ action: "reclaim" });
    expect(
      decideExistingWebhookEventClaim(
        { id: "evt", processingStatus: WEBHOOK_STATUS_RECEIVED, processedAt: null },
        NOW,
      ),
    ).toEqual({ action: "reclaim" });
  });
});

describe("in-memory webhook event claim CAS", () => {
  it("lets only one worker reclaim a failed identity_ambiguous row", () => {
    const events: Array<Record<string, unknown>> = [
      {
        id: "evt-1",
        provider: "meta_instagram",
        externalEventId: "mid.persona",
        processingStatus: WEBHOOK_STATUS_FAILED,
        errorCode: IDENTITY_AMBIGUOUS,
        processedAt: null,
      },
    ];
    let next = 1;
    const first = applyWebhookEventClaim(
      events,
      {
        provider: "meta_instagram",
        externalEventId: "mid.persona",
        payload: {},
        payloadHash: null,
      },
      () => `id-${++next}`,
      NOW,
    );
    const second = applyWebhookEventClaim(
      events,
      {
        provider: "meta_instagram",
        externalEventId: "mid.persona",
        payload: {},
        payloadHash: null,
      },
      () => `id-${++next}`,
      NOW,
    );
    expect(first).toEqual({ outcome: "retry", id: "evt-1" });
    expect(second).toEqual({ outcome: "already_processed" });
    expect(events).toHaveLength(1);
    expect(events[0]?.processingStatus).toBe(WEBHOOK_STATUS_PROCESSING);
  });

  it("treats a completed retry as a no-op", () => {
    const events: Array<Record<string, unknown>> = [
      {
        id: "evt-1",
        provider: "meta_instagram",
        externalEventId: "mid.hi",
        processingStatus: WEBHOOK_STATUS_COMPLETED,
        processedAt: new Date(NOW).toISOString(),
      },
    ];
    const result = applyWebhookEventClaim(
      events,
      {
        provider: "meta_instagram",
        externalEventId: "mid.hi",
        payload: {},
        payloadHash: null,
      },
      () => "id-new",
      NOW,
    );
    expect(result).toEqual({ outcome: "already_processed" });
    expect(events[0]?.processingStatus).toBe(WEBHOOK_STATUS_COMPLETED);
  });
});
