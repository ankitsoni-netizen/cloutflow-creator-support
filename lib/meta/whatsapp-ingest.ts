import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
import { detectRoutingCommand } from "@/lib/meta/commands";
import {
  reduceChannelConversation,
} from "@/lib/meta/conversation-machine";
import {
  applyWhatsAppEffects,
  retryFailedInstagramOutbounds,
} from "@/lib/meta/instagram-effects";
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
  parseIntakePhone,
} from "@/lib/meta/intake-validate";
import {
  channelOutboundKey,
  intakeEffectType,
} from "@/lib/meta/prompt-keys";
import { WHATSAPP_INTAKE_COPY } from "@/lib/meta/routing-copy";
import type { WhatsAppProviderSendDeps } from "@/lib/meta/whatsapp-provider";
import type {
  NormalizedMetaInboundText,
  NormalizedWhatsAppStatus,
} from "@/lib/meta/types";
import type { PersistContext, PersistResult } from "@/lib/meta/store";
import type { DbTicket } from "@/lib/tickets/types";

export type WhatsAppIngestDeps = {
  sendDeps?: WhatsAppProviderSendDeps;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
};

function suggestedPhoneFromWaId(waId: string): string | null {
  return parseIntakePhone(waId)?.normalized ?? parseIntakePhone(`+${waId}`)?.normalized ?? null;
}

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
  if (existing) return { outcome: "ok", row: existing };

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
    sourceChannel: "whatsapp",
  });
  if (found && "errorCode" in found) return { errorCode: found.errorCode };
  if (found && isActiveTicketStatus(found.status)) {
    return { ticketId: found.id, status: found.status };
  }
  return { ticketId: conversationTicketId, status: found?.status ?? null };
}

function whatsappEffectArgs(
  event: NormalizedMetaInboundText,
  store: InstagramIngestStore,
  conversationId: string,
  ingestDeps: WhatsAppIngestDeps,
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
  ingestDeps: WhatsAppIngestDeps;
}): Promise<"ok" | "recovered" | { failed: string }> {
  const field = input.snapshot.currentIntakeField;
  if (input.snapshot.state !== "support_intake" || !field) return "ok";

  const command = detectRoutingCommand(
    input.event.messageBody,
    input.event.quickReplyPayload ?? null,
  );
  if (command === "cancel" || command === "restart") return "ok";

  const effectType = intakeEffectType(field);
  const expectedKey = channelOutboundKey(
    "wa",
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
      existing.deliveryStatus === "read" ||
      existing.deliveryStatus === "pending")
  ) {
    return "ok";
  }

  const applied = await applyWhatsAppEffects({
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
    ...whatsappEffectArgs(
      input.event,
      input.store,
      input.conversationId,
      input.ingestDeps,
    ),
  });
  if (applied.retryableFailure) {
    return { failed: "whatsapp_send_failed" };
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

async function handleUnsupportedInbound(input: {
  event: NormalizedMetaInboundText;
  store: InstagramIngestStore;
  conversationId: string;
  snapshot: ReturnType<typeof snapshotFromConversationRow>;
  ingestDeps: WhatsAppIngestDeps;
}): Promise<PersistResult> {
  const promptKey = `media:${input.event.externalMessageId}`;
  const applied = await applyWhatsAppEffects({
    effects: [
      {
        type: "send_text",
        text: WHATSAPP_INTAKE_COPY.mediaIntakeText,
        promptKey,
      },
    ],
    snapshotTicketId: input.snapshot.ticketId,
    collected: input.snapshot.collected,
    intakeSessionVersion: input.snapshot.intakeSessionVersion,
    ...whatsappEffectArgs(
      input.event,
      input.store,
      input.conversationId,
      input.ingestDeps,
    ),
  });
  if (applied.retryableFailure) {
    return { outcome: "failed", errorCode: "whatsapp_send_failed" };
  }
  const saved = await input.store.saveConversationSnapshot(
    input.conversationId,
    {
      ...input.snapshot,
      lastActivityAt: input.event.timestamp,
      lastProcessedExternalMessageId: input.event.externalMessageId,
    },
    input.event.timestamp,
    input.event.displayName,
  );
  if (saved.outcome === "failed") {
    return { outcome: "failed", errorCode: saved.errorCode };
  }
  return { outcome: "stored" };
}

export async function ingestWhatsAppStatus(
  event: NormalizedWhatsAppStatus,
  store: InstagramIngestStore,
  context: PersistContext,
): Promise<PersistResult> {
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
  if (claim.outcome === "already_processed") return { outcome: "duplicate" };
  if (claim.outcome === "failed") {
    return { outcome: "failed", errorCode: claim.errorCode };
  }

  try {
    let outbound = await store.findOutboundByExternalMessageId(event.metaMessageId);
    if (outbound && "errorCode" in outbound) {
      await store.markWebhookEvent(claim.id, WEBHOOK_STATUS_FAILED, outbound.errorCode);
      return { outcome: "failed", errorCode: outbound.errorCode };
    }
    // Secondary: WATI internal event id when send response stored ConversationEventDto.id.
    if (
      !outbound &&
      event.watiEventId &&
      event.watiEventId !== event.metaMessageId
    ) {
      const byWatiId = await store.findOutboundByExternalMessageId(event.watiEventId);
      if (byWatiId && "errorCode" in byWatiId) {
        await store.markWebhookEvent(claim.id, WEBHOOK_STATUS_FAILED, byWatiId.errorCode);
        return { outcome: "failed", errorCode: byWatiId.errorCode };
      }
      outbound = byWatiId;
    }
    // Legacy only: correlate by localMessageId → outbound idempotency key.
    if (!outbound && event.localMessageId) {
      const byLocal = await store.findOutboundByIdempotencyKey(event.localMessageId);
      if (byLocal && "errorCode" in byLocal) {
        await store.markWebhookEvent(claim.id, WEBHOOK_STATUS_FAILED, byLocal.errorCode);
        return { outcome: "failed", errorCode: byLocal.errorCode };
      }
      outbound = byLocal;
    }
    if (outbound) {
      const nextStatus =
        event.status === "deleted" ? "failed" : event.status;
      const patch: {
        deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed";
        deliveryErrorCode?: string | null;
        externalMessageId?: string | null;
      } = {
        deliveryStatus: nextStatus,
        deliveryErrorCode:
          event.status === "failed" || event.status === "deleted"
            ? event.errorCode ?? event.status
            : null,
      };
      // Prefer WhatsApp message id once known.
      if (event.metaMessageId) {
        patch.externalMessageId = event.metaMessageId;
      }
      await store.markOutboundMessage(outbound.id, patch);
    }
    await store.markWebhookEvent(claim.id, "completed");
    return { outcome: outbound ? "stored" : "duplicate" };
  } catch {
    await store.markWebhookEvent(claim.id, WEBHOOK_STATUS_FAILED, "unexpected_failure");
    return { outcome: "failed", errorCode: "unexpected_failure" };
  }
}

export async function ingestWhatsAppInboundMessage(
  event: NormalizedMetaInboundText,
  store: InstagramIngestStore,
  context: PersistContext,
  ingestDeps: WhatsAppIngestDeps = {},
): Promise<PersistResult> {
  if (event.channel !== "whatsapp") {
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

  if (claim.outcome === "already_processed") return { outcome: "duplicate" };
  if (claim.outcome === "failed") {
    return { outcome: "failed", errorCode: claim.errorCode };
  }

  const eventId = claim.id;

  try {
    const conversation = await upsertConversation(store, event);
    if (conversation.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, conversation.errorCode);
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
      ticketId:
        ticketInfo.ticketId && isActiveTicketStatus(ticketInfo.status)
          ? ticketInfo.ticketId
          : null,
      routingKind: "unclassified",
      purpose: event.messageType === "unsupported" ? "unsupported_inbound" : "inbound",
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
    snapshot.suggestedPhone = suggestedPhoneFromWaId(event.externalContactId);
    if (!snapshot.suggestedSocialHandle) {
      snapshot.suggestedSocialHandle = event.displayName;
    }

    if (event.messageType === "unsupported") {
      if (isActiveTicketStatus(ticketInfo.status) && ticketInfo.ticketId) {
        const applied = await applyWhatsAppEffects({
          effects: [{ type: "notify_help_inbound" }],
          snapshotTicketId: ticketInfo.ticketId,
          collected: snapshot.collected,
          intakeSessionVersion: snapshot.intakeSessionVersion,
          ...whatsappEffectArgs(event, store, conversation.row.id, ingestDeps),
        });
        if (applied.retryableFailure) {
          await store.markWebhookEvent(
            eventId,
            WEBHOOK_STATUS_FAILED,
            "whatsapp_send_failed",
          );
          return { outcome: "failed", errorCode: "whatsapp_send_failed" };
        }
        await store.saveConversationSnapshot(
          conversation.row.id,
          {
            ...snapshot,
            lastActivityAt: event.timestamp,
            lastProcessedExternalMessageId: event.externalMessageId,
          },
          event.timestamp,
          event.displayName,
        );
        await store.markWebhookEvent(eventId, "completed");
        return { outcome: inbound.outcome === "duplicate" ? "duplicate" : "stored" };
      }
      const media = await handleUnsupportedInbound({
        event,
        store,
        conversationId: conversation.row.id,
        snapshot,
        ingestDeps,
      });
      if (media.outcome === "failed") {
        await store.markWebhookEvent(
          eventId,
          WEBHOOK_STATUS_FAILED,
          media.errorCode ?? "whatsapp_send_failed",
        );
        return media;
      }
      await store.markWebhookEvent(eventId, "completed");
      return media;
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
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, recovered.failed);
      return { outcome: "failed", errorCode: recovered.failed };
    }

    const reduced = reduceChannelConversation(
      snapshot,
      {
        text: event.messageBody,
        quickReplyPayload: event.quickReplyPayload ?? null,
        timestamp: event.timestamp,
        messageId: event.externalMessageId,
      },
      WHATSAPP_INTAKE_COPY,
    );

    if (inbound.outcome === "duplicate" && !reduced.processed) {
      const retried = await retryFailedInstagramOutbounds(
        {
          store,
          recipientId: event.externalContactId,
          conversationId: conversation.row.id,
          sendDeps: ingestDeps.sendDeps,
        },
        "whatsapp",
      );
      if (retried.retryableFailure) {
        await store.markWebhookEvent(
          eventId,
          WEBHOOK_STATUS_FAILED,
          "whatsapp_send_failed",
        );
        return { outcome: "failed", errorCode: "whatsapp_send_failed" };
      }
      if (
        reduced.snapshot.state === "ticket_open" &&
        !reduced.snapshot.ticketId &&
        isIntakeComplete(reduced.snapshot.collected)
      ) {
        const applied = await applyWhatsAppEffects({
          effects: [{ type: "create_ticket" }],
          snapshotTicketId: null,
          collected: reduced.snapshot.collected,
          intakeSessionVersion: reduced.snapshot.intakeSessionVersion,
          ...whatsappEffectArgs(event, store, conversation.row.id, ingestDeps),
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
            "whatsapp_send_failed",
          );
          return { outcome: "failed", errorCode: "whatsapp_send_failed" };
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

    const applied = await applyWhatsAppEffects({
      effects: reduced.effects,
      snapshotTicketId: reduced.snapshot.ticketId,
      collected: reduced.snapshot.collected,
      intakeSessionVersion: reduced.snapshot.intakeSessionVersion,
      ...whatsappEffectArgs(event, store, conversation.row.id, ingestDeps),
    });

    if (applied.retryableFailure) {
      await store.markWebhookEvent(
        eventId,
        WEBHOOK_STATUS_FAILED,
        "whatsapp_send_failed",
      );
      return { outcome: "failed", errorCode: "whatsapp_send_failed" };
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
