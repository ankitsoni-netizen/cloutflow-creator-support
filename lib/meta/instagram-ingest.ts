import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
import { detectRoutingCommand } from "@/lib/meta/commands";
import {
  emptyConversationSnapshot,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import { applyInstagramEffects, retryFailedInstagramOutbounds } from "@/lib/meta/instagram-effects";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  snapshotFromConversationRow,
  type InstagramConversationRow,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import { sha256Hex } from "@/lib/meta/signature";
import {
  intakePromptForCurrentStep,
  isIntakeComplete,
} from "@/lib/meta/intake-validate";
import {
  chatbotOutboundIdempotencyKey,
  intakeEffectType,
} from "@/lib/meta/prompt-keys";
import type { InstagramSendDeps } from "@/lib/meta/instagram-send";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import type { PersistContext, PersistResult } from "@/lib/meta/store";
import type { DbTicket } from "@/lib/tickets/types";

export type { InstagramIngestStore, InstagramTicketRow } from "@/lib/meta/instagram-store";
export { createAdminInstagramStore, createSupabaseInstagramStore } from "@/lib/meta/instagram-store";

export type InstagramIngestDeps = {
  sendDeps?: InstagramSendDeps;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
};

async function upsertConversation(
  store: InstagramIngestStore,
  event: NormalizedMetaInboundText,
): Promise<
  | { outcome: "ok"; row: InstagramConversationRow }
  | { outcome: "failed"; errorCode: string }
> {
  const existing = await store.getConversation(
    event.channel,
    event.externalConversationId,
  );
  if (existing && "errorCode" in existing) {
    return { outcome: "failed", errorCode: existing.errorCode };
  }

  if (existing) {
    return { outcome: "ok", row: existing };
  }

  const inserted = await store.insertConversation({
    channel: event.channel,
    externalConversationId: event.externalConversationId,
    externalContactId: event.externalContactId,
    displayName: event.displayName,
    lastMessageAt: event.timestamp,
    state: "unclassified",
  });
  if (inserted.outcome === "failed") {
    return { outcome: "failed", errorCode: inserted.errorCode };
  }

  const lookedUp = await store.getConversation(
    event.channel,
    event.externalConversationId,
  );
  if (!lookedUp || "errorCode" in lookedUp) {
    return { outcome: "failed", errorCode: "conversation_lookup_failed" };
  }
  return { outcome: "ok", row: lookedUp };
}

async function ticketStatusFor(
  store: InstagramIngestStore,
  event: NormalizedMetaInboundText,
  conversationTicketId: string | null,
): Promise<
  | { ticketId: string | null; status: string | null }
  | { errorCode: string }
> {
  if (conversationTicketId) {
    const linked = await store.getTicket(conversationTicketId);
    if (linked && "errorCode" in linked) return { errorCode: linked.errorCode };
    if (linked) return { ticketId: linked.id, status: linked.status };
  }

  const found = await store.findActiveInstagramTicket({
    externalConversationId: event.externalConversationId,
    externalContactId: event.externalContactId,
  });
  if (found && "errorCode" in found) return { errorCode: found.errorCode };
  if (found && isActiveTicketStatus(found.status)) {
    return { ticketId: found.id, status: found.status };
  }
  return { ticketId: conversationTicketId, status: found?.status ?? null };
}

function instagramEffectArgs(
  event: NormalizedMetaInboundText,
  store: InstagramIngestStore,
  conversationId: string,
  ingestDeps: InstagramIngestDeps,
) {
  return {
    inboundMessageId: event.externalMessageId,
    inboundText: event.messageBody,
    event: {
      externalContactId: event.externalContactId,
      externalConversationId: event.externalConversationId,
    },
    deps: {
      store,
      recipientId: event.externalContactId,
      conversationId,
      sendDeps: ingestDeps.sendDeps,
      loadTicket: ingestDeps.loadTicket,
    },
  };
}

async function recoverMissingIntakePrompt(input: {
  event: NormalizedMetaInboundText;
  store: InstagramIngestStore;
  conversationId: string;
  snapshot: ReturnType<typeof snapshotFromConversationRow>;
  ingestDeps: InstagramIngestDeps;
}): Promise<"ok" | "recovered" | { failed: string }> {
  const field = input.snapshot.currentIntakeField;
  if (input.snapshot.state !== "support_intake" || !field) return "ok";

  const command = detectRoutingCommand(
    input.event.messageBody,
    input.event.quickReplyPayload ?? null,
  );
  if (command === "cancel" || command === "restart") return "ok";

  const effectType = intakeEffectType(field);
  const expectedKey = chatbotOutboundIdempotencyKey(
    input.conversationId,
    input.snapshot.intakeSessionVersion,
    effectType,
  );
  const existing = await input.store.findOutboundByIdempotencyKey(expectedKey);
  if (existing && "errorCode" in existing) {
    return { failed: existing.errorCode };
  }
  if (
    existing &&
    existing.conversationId === input.conversationId &&
    (existing.deliveryStatus === "sent" ||
      existing.deliveryStatus === "delivered" ||
      existing.deliveryStatus === "pending")
  ) {
    return "ok";
  }

  const applied = await applyInstagramEffects({
    effects: [
      {
        type: "send_text",
        text: intakePromptForCurrentStep(field, input.snapshot.collected),
        promptKey: effectType,
      },
    ],
    snapshotTicketId: input.snapshot.ticketId,
    collected: input.snapshot.collected,
    intakeSessionVersion: input.snapshot.intakeSessionVersion,
    ...instagramEffectArgs(
      input.event,
      input.store,
      input.conversationId,
      input.ingestDeps,
    ),
  });
  if (applied.retryableFailure) {
    return { failed: "instagram_send_failed" };
  }

  const recoveredSnapshot = {
    ...input.snapshot,
    lastPromptKey: effectType,
    lastActivityAt: input.event.timestamp,
    lastProcessedExternalMessageId: input.event.externalMessageId,
  };
  const saved = await input.store.saveConversationSnapshot(
    input.conversationId,
    recoveredSnapshot,
    input.event.timestamp,
    input.event.displayName,
  );
  if (saved.outcome === "failed") {
    return { failed: saved.errorCode };
  }
  return "recovered";
}

export async function ingestInstagramInboundMessage(
  event: NormalizedMetaInboundText,
  store: InstagramIngestStore,
  context: PersistContext,
  ingestDeps: InstagramIngestDeps = {},
): Promise<PersistResult> {
  if (event.channel !== "instagram") {
    return { outcome: "failed", errorCode: "unsupported_channel" };
  }

  const claim = await store.claimWebhookEvent({
    provider: event.provider,
    externalEventId: event.externalEventId,
    payload: context.webhookPayload,
    payloadHash: (() => {
      try {
        return sha256Hex(JSON.stringify(context.webhookPayload));
      } catch {
        return null;
      }
    })(),
  });

  if (claim.outcome === "already_processed") {
    return { outcome: "duplicate" };
  }
  if (claim.outcome === "failed") {
    return { outcome: "failed", errorCode: claim.errorCode };
  }

  const eventId = claim.id;

  try {
    const conversation = await upsertConversation(store, event);
    if (conversation.outcome === "failed") {
      await store.markWebhookEvent(
        eventId,
        WEBHOOK_STATUS_FAILED,
        conversation.errorCode,
      );
      return { outcome: "failed", errorCode: conversation.errorCode };
    }

    const ticketInfo = await ticketStatusFor(
      store,
      event,
      conversation.row.ticketId,
    );
    if ("errorCode" in ticketInfo) {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, ticketInfo.errorCode);
      return { outcome: "failed", errorCode: ticketInfo.errorCode };
    }

    const inbound = await store.insertInboundMessage({
      conversationId: conversation.row.id,
      channel: event.channel,
      externalMessageId: event.externalMessageId,
      senderName: event.senderName,
      senderAddress: event.senderAddress,
      messageBody: event.messageBody,
      eventFragment: event.eventFragment,
      ticketId: ticketInfo.ticketId && isActiveTicketStatus(ticketInfo.status)
        ? ticketInfo.ticketId
        : null,
      routingKind: "unclassified",
      purpose: "inbound",
    });
    if (inbound.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, inbound.errorCode);
      return { outcome: "failed", errorCode: inbound.errorCode };
    }

    const snapshot = snapshotFromConversationRow(
      conversation.row,
      ticketInfo.status,
      event.displayName,
    );
    snapshot.ticketId = ticketInfo.ticketId;
    snapshot.ticketStatus = ticketInfo.status;
    if (!snapshot.suggestedSocialHandle) {
      snapshot.suggestedSocialHandle = event.displayName;
    }

    const recovered = await recoverMissingIntakePrompt({
      event,
      store,
      conversationId: conversation.row.id,
      snapshot,
      ingestDeps,
    });
    if (recovered !== "ok") {
      if (recovered === "recovered") {
        await store.markWebhookEvent(eventId, "completed");
        return { outcome: inbound.outcome === "duplicate" ? "duplicate" : "stored" };
      }
      await store.markWebhookEvent(
        eventId,
        WEBHOOK_STATUS_FAILED,
        recovered.failed,
      );
      return { outcome: "failed", errorCode: recovered.failed };
    }

    const reduced = reduceInstagramConversation(snapshot, {
      text: event.messageBody,
      quickReplyPayload: event.quickReplyPayload ?? null,
      timestamp: event.timestamp,
      messageId: event.externalMessageId,
    });

    if (inbound.outcome === "duplicate" && !reduced.processed) {
      const retried = await retryFailedInstagramOutbounds({
        store,
        recipientId: event.externalContactId,
        conversationId: conversation.row.id,
        sendDeps: ingestDeps.sendDeps,
      });
      if (retried.retryableFailure) {
        await store.markWebhookEvent(
          eventId,
          WEBHOOK_STATUS_FAILED,
          "instagram_send_failed",
        );
        return { outcome: "failed", errorCode: "instagram_send_failed" };
      }

      if (
        reduced.snapshot.state === "ticket_open" &&
        !reduced.snapshot.ticketId &&
        isIntakeComplete(reduced.snapshot.collected)
      ) {
        const applied = await applyInstagramEffects({
          effects: [{ type: "create_ticket" }],
          snapshotTicketId: null,
          collected: reduced.snapshot.collected,
          intakeSessionVersion: reduced.snapshot.intakeSessionVersion,
          ...instagramEffectArgs(
            event,
            store,
            conversation.row.id,
            ingestDeps,
          ),
        });
        if (applied.ticketId) {
          reduced.snapshot.ticketId = applied.ticketId;
          reduced.snapshot.state = "ticket_open";
          await store.saveConversationSnapshot(
            conversation.row.id,
            reduced.snapshot,
            event.timestamp,
            event.displayName,
          );
        }
        if (applied.retryableFailure) {
          await store.markWebhookEvent(
            eventId,
            WEBHOOK_STATUS_FAILED,
            "instagram_send_failed",
          );
          return { outcome: "failed", errorCode: "instagram_send_failed" };
        }
      }

      await store.markWebhookEvent(eventId, "completed");
      return { outcome: "duplicate" };
    }

    if (reduced.attachTicketId) {
      reduced.snapshot.ticketId = reduced.attachTicketId;
    }

    if (reduced.inboundRoutingKind !== "unclassified") {
      await store.markMessagesRoutingKind({
        conversationId: conversation.row.id,
        fromKind: "unclassified",
        toKind: reduced.inboundRoutingKind,
      });
    }

    const applied = await applyInstagramEffects({
      effects: reduced.effects,
      snapshotTicketId: reduced.snapshot.ticketId,
      collected: reduced.snapshot.collected,
      intakeSessionVersion: reduced.snapshot.intakeSessionVersion,
      ...instagramEffectArgs(event, store, conversation.row.id, ingestDeps),
    });

    if (applied.retryableFailure) {
      await store.markWebhookEvent(
        eventId,
        WEBHOOK_STATUS_FAILED,
        "instagram_send_failed",
      );
      return { outcome: "failed", errorCode: "instagram_send_failed" };
    }

    if (applied.ticketId) {
      reduced.snapshot.ticketId = applied.ticketId;
      reduced.snapshot.state = "ticket_open";
    }

    const saved = await store.saveConversationSnapshot(
      conversation.row.id,
      reduced.snapshot,
      event.timestamp,
      event.displayName,
    );
    if (saved.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, saved.errorCode);
      return { outcome: "failed", errorCode: saved.errorCode };
    }

    await store.markWebhookEvent(eventId, "completed");
    return {
      outcome: inbound.outcome === "duplicate" ? "duplicate" : "stored",
    };
  } catch {
    try {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, "unexpected_failure");
    } catch {
      // Keep a sanitized failure for Meta retry.
    }
    return { outcome: "failed", errorCode: "unexpected_failure" };
  }
}

export function emptySnapshotForTests() {
  return emptyConversationSnapshot();
}
