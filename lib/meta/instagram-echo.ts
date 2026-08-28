import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { sha256Hex } from "@/lib/meta/signature";
import type { NormalizedInstagramEcho } from "@/lib/meta/types";
import type { PersistContext, PersistResult } from "@/lib/meta/store";
import {
  IDENTITY_MISSING,
  instagramEchoIdentity,
} from "@/lib/meta/conversation-identity";

/**
 * Correlate Instagram echo / is_self webhooks with stored outbound messages.
 * Never runs routing or intake automation.
 */
export async function ingestInstagramEcho(
  echo: NormalizedInstagramEcho,
  store: InstagramIngestStore,
  context: PersistContext,
): Promise<PersistResult> {
  const claim = await store.claimWebhookEvent({
    provider: echo.provider,
    externalEventId: echo.externalEventId,
    payload: context.webhookPayload,
    payloadHash: (() => {
      try {
        return sha256Hex(JSON.stringify(context.webhookPayload));
      } catch {
        return null;
      }
    })(),
  });

  if (claim.outcome === "already_processed") return { outcome: "duplicate" };
  if (claim.outcome === "failed") {
    return { outcome: "failed", errorCode: claim.errorCode };
  }

  try {
    const existing = await store.findOutboundByExternalMessageId(
      echo.externalMessageId,
    );
    if (existing && "errorCode" in existing) {
      await store.markWebhookEvent(
        claim.id,
        WEBHOOK_STATUS_FAILED,
        existing.errorCode,
      );
      return { outcome: "failed", errorCode: existing.errorCode };
    }

    if (existing) {
      if (existing.deliveryStatus === "pending") {
        await store.markOutboundMessage(existing.id, {
          deliveryStatus: "sent",
          externalMessageId: echo.externalMessageId,
          deliveryErrorCode: null,
          nextAttemptAt: null,
        });
      }
      await store.markWebhookEvent(claim.id, "completed");
      return { outcome: "duplicate" };
    }

    const identity = instagramEchoIdentity(echo);
    if (!identity) {
      await store.markWebhookEvent(claim.id, WEBHOOK_STATUS_FAILED, IDENTITY_MISSING);
      return { outcome: "failed", errorCode: IDENTITY_MISSING };
    }

    const conversation = await store.getConversation(
      "instagram",
      identity.externalConversationId,
      {
        externalContactId: identity.externalContactId,
        provider: identity.provider,
        recipientAccountId: identity.recipientAccountId,
      },
    );
    if (conversation && "errorCode" in conversation) {
      await store.markWebhookEvent(
        claim.id,
        WEBHOOK_STATUS_FAILED,
        conversation.errorCode,
      );
      return { outcome: "failed", errorCode: conversation.errorCode };
    }

    if (!conversation) {
      await store.markWebhookEvent(claim.id, "completed");
      return { outcome: "stored" };
    }

    const pendingTimeout = await store.findPendingTimeoutOutbound({
      conversationId: conversation.id,
      messageBody: echo.messageBody,
    });
    if (pendingTimeout && "errorCode" in pendingTimeout) {
      await store.markWebhookEvent(
        claim.id,
        WEBHOOK_STATUS_FAILED,
        pendingTimeout.errorCode,
      );
      return { outcome: "failed", errorCode: pendingTimeout.errorCode };
    }
    if (pendingTimeout) {
      await store.markOutboundMessage(pendingTimeout.id, {
        deliveryStatus: "sent",
        externalMessageId: echo.externalMessageId,
        deliveryErrorCode: null,
        nextAttemptAt: null,
      });
      await store.markWebhookEvent(claim.id, "completed");
      return { outcome: "stored" };
    }

    const inserted = await store.insertEchoOutboundMessage({
      conversationId: conversation.id,
      ticketId: conversation.ticketId,
      externalMessageId: echo.externalMessageId,
      recipientExternalId: identity.externalContactId,
      senderAddress: identity.recipientAccountId,
      messageBody: echo.messageBody,
      eventFragment: echo.eventFragment,
    });
    if (inserted.outcome === "failed") {
      await store.markWebhookEvent(
        claim.id,
        WEBHOOK_STATUS_FAILED,
        inserted.errorCode ?? "echo_insert_failed",
      );
      return { outcome: "failed", errorCode: inserted.errorCode };
    }

    await store.markWebhookEvent(claim.id, "completed");
    return {
      outcome: inserted.outcome === "duplicate" ? "duplicate" : "stored",
    };
  } catch {
    try {
      await store.markWebhookEvent(claim.id, WEBHOOK_STATUS_FAILED, "unexpected_failure");
    } catch {
      // Sanitized failure for Meta retry.
    }
    return { outcome: "failed", errorCode: "unexpected_failure" };
  }
}
