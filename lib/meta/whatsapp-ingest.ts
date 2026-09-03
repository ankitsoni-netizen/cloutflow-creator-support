import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
import {
  reduceChannelConversation,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import {
  applyWhatsAppEffects,
  retryFailedInstagramOutbounds,
} from "@/lib/meta/instagram-effects";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  IDENTITY_MISSING,
  channelIdentityFromInbound,
  type ConversationIdentity,
} from "@/lib/meta/conversation-identity";
import {
  snapshotFromConversationRow,
  type InstagramConversationRow,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import { sha256Hex } from "@/lib/meta/signature";
import {
  isIntakeComplete,
  parseIntakePhone,
} from "@/lib/meta/intake-validate";
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

function usesWatiPersonaMachine(provider: string): boolean {
  return provider === WATI_WHATSAPP_PROVIDER;
}

async function upsertConversation(
  store: InstagramIngestStore,
  event: NormalizedMetaInboundText,
  identity: ConversationIdentity,
): Promise<
  | { outcome: "ok"; row: InstagramConversationRow }
  | { outcome: "failed"; errorCode: string }
> {
  const lookup = {
    externalContactId: identity.externalContactId,
    provider: identity.provider,
    recipientAccountId: identity.recipientAccountId,
  };
  const existing = await store.getConversation(
    identity.channel,
    identity.externalConversationId,
    lookup,
  );
  if (existing && "errorCode" in existing) {
    return { outcome: "failed", errorCode: existing.errorCode };
  }
  if (existing) return { outcome: "ok", row: existing };

  const inserted = await store.insertConversation({
    channel: identity.channel,
    externalConversationId: identity.externalConversationId,
    externalContactId: identity.externalContactId,
    displayName: event.displayName,
    lastMessageAt: event.timestamp,
    state: "unclassified",
    provider: identity.provider,
    recipientAccountId: identity.recipientAccountId,
  });
  if (inserted.outcome === "failed") {
    return { outcome: "failed", errorCode: inserted.errorCode };
  }
  const lookedUp = await store.getConversation(
    identity.channel,
    identity.externalConversationId,
    lookup,
  );
  if (!lookedUp || "errorCode" in lookedUp) {
    return { outcome: "failed", errorCode: "conversation_lookup_failed" };
  }
  return { outcome: "ok", row: lookedUp };
}

async function ticketStatusFor(
  store: InstagramIngestStore,
  identity: ConversationIdentity,
  conversationTicketId: string | null,
): Promise<
  | { ticketId: string | null; status: string | null }
  | { errorCode: string }
> {
  const found = await store.findActiveInstagramTicket({
    externalConversationId: identity.externalConversationId,
    externalContactId: identity.externalContactId,
    sourceChannel: "whatsapp",
    provider: identity.provider,
    recipientAccountId: identity.recipientAccountId,
  });
  if (found && "errorCode" in found) return { errorCode: found.errorCode };

  if (conversationTicketId) {
    const linked = await store.getTicket(conversationTicketId);
    if (linked && "errorCode" in linked) return { errorCode: linked.errorCode };
    if (linked && isActiveTicketStatus(linked.status)) {
      if (found && found.id === linked.id) {
        return { ticketId: linked.id, status: linked.status };
      }
      if (!found) return { ticketId: null, status: null };
    }
  }
  if (found && isActiveTicketStatus(found.status)) {
    return { ticketId: found.id, status: found.status };
  }
  return { ticketId: null, status: found?.status ?? null };
}

function whatsappEffectArgs(
  event: NormalizedMetaInboundText,
  store: InstagramIngestStore,
  conversationId: string,
  ingestDeps: WhatsAppIngestDeps,
) {
  const identity = channelIdentityFromInbound(event);
  const contactId = identity?.externalContactId ?? event.externalContactId;
  return {
    inboundMessageId: event.externalMessageId,
    inboundText: event.messageBody,
    event: {
      externalContactId: contactId,
      externalConversationId:
        identity?.externalConversationId ?? event.externalConversationId,
      recipientAccountId: identity?.recipientAccountId ?? event.recipientAccountId,
      provider: identity?.provider ?? event.provider,
    },
    deps: {
      store,
      recipientId: contactId,
      conversationId,
      sendDeps: ingestDeps.sendDeps,
      loadTicket: ingestDeps.loadTicket,
    },
  };
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
  const identity = channelIdentityFromInbound(event);
  if (!identity) {
    await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, IDENTITY_MISSING);
    return { outcome: "failed", errorCode: IDENTITY_MISSING };
  }

  try {
    const conversation = await upsertConversation(store, event, identity);
    if (conversation.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, conversation.errorCode);
      return { outcome: "failed", errorCode: conversation.errorCode };
    }

    const ticketInfo = await ticketStatusFor(
      store,
      identity,
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

    const watiPersona = usesWatiPersonaMachine(event.provider);

    if (event.messageType === "unsupported" && !watiPersona) {
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
        const saved = await store.saveConversationSnapshot(
          conversation.row.id,
          {
            ...snapshot,
            lastActivityAt: event.timestamp,
            lastProcessedExternalMessageId: event.externalMessageId,
          },
          event.timestamp,
          event.displayName,
        );
        if (saved.outcome === "failed") {
          await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, saved.errorCode);
          return { outcome: "failed", errorCode: saved.errorCode };
        }
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

    const reduced = watiPersona
      ? reduceInstagramConversation(snapshot, {
          text: event.messageBody,
          quickReplyPayload: event.quickReplyPayload ?? null,
          timestamp: event.timestamp,
          messageId: event.externalMessageId,
          unsupportedKind:
            event.unsupportedKind ??
            (event.messageType === "unsupported" ? "unsupported" : null),
        })
      : reduceChannelConversation(
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
          const saved = await store.saveConversationSnapshot(
            conversation.row.id,
            reduced.snapshot,
            event.timestamp,
            event.displayName,
          );
          if (saved.outcome === "failed") {
            await store.markWebhookEvent(
              eventId,
              WEBHOOK_STATUS_FAILED,
              saved.errorCode,
            );
            return { outcome: "failed", errorCode: saved.errorCode };
          }
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

    if (applied.ticketId) {
      reduced.snapshot.ticketId = applied.ticketId;
      if (watiPersona) {
        if (reduced.snapshot.state !== "awaiting_post_completion") {
          reduced.snapshot.state =
            reduced.snapshot.state || "awaiting_post_completion";
        }
      } else {
        reduced.snapshot.state = "ticket_open";
      }
    }

    if (applied.retryableFailure) {
      if (watiPersona && applied.ticketId) {
        const linked = await store.saveConversationSnapshot(
          conversation.row.id,
          reduced.snapshot,
          event.timestamp,
          event.displayName,
        );
        if (linked.outcome === "failed") {
          await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, linked.errorCode);
          return { outcome: "failed", errorCode: linked.errorCode };
        }
      }
      await store.markWebhookEvent(
        eventId,
        WEBHOOK_STATUS_FAILED,
        "whatsapp_send_failed",
      );
      return { outcome: "failed", errorCode: "whatsapp_send_failed" };
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
