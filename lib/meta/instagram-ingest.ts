import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
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
import { isIntakeComplete } from "@/lib/meta/intake-validate";
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
          inboundMessageId: event.externalMessageId,
          inboundText: event.messageBody,
          event: {
            externalContactId: event.externalContactId,
            externalConversationId: event.externalConversationId,
          },
          deps: {
            store,
            recipientId: event.externalContactId,
            conversationId: conversation.row.id,
            sendDeps: ingestDeps.sendDeps,
            loadTicket: ingestDeps.loadTicket,
          },
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
      inboundMessageId: event.externalMessageId,
      inboundText: event.messageBody,
      event: {
        externalContactId: event.externalContactId,
        externalConversationId: event.externalConversationId,
      },
      deps: {
        store,
        recipientId: event.externalContactId,
        conversationId: conversation.row.id,
        sendDeps: ingestDeps.sendDeps,
        loadTicket: ingestDeps.loadTicket,
      },
    });

    if (applied.ticketId && applied.ticketId !== reduced.snapshot.ticketId) {
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
