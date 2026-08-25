import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
import { isGlobalMenuOrRestart } from "@/lib/meta/instagram-persona-commands";
import {
  emptyConversationSnapshot,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import { applyInstagramEffects, retryFailedInstagramOutbounds } from "@/lib/meta/instagram-effects";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  instagramPromptForState,
  INSTAGRAM_PERSONA_STATES,
} from "@/lib/meta/instagram-persona-machine";
import { lookupInstagramUsername } from "@/lib/meta/instagram-username";
import {
  snapshotFromConversationRow,
  type InstagramConversationRow,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import {
  CONVERSATION_STATE_CONFLICT,
  instagramOutboundSenderAddress,
} from "@/lib/meta/instagram-reserve";
import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";
import { sha256Hex } from "@/lib/meta/signature";
import { chatbotOutboundIdempotencyKey } from "@/lib/meta/prompt-keys";
import type { InstagramSendDeps } from "@/lib/meta/instagram-send";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import type { PersistContext, PersistResult } from "@/lib/meta/store";
import type { DbTicket } from "@/lib/tickets/types";
import type { InstagramTimingSession } from "@/lib/meta/timing";

export type { InstagramIngestStore, InstagramTicketRow } from "@/lib/meta/instagram-store";
export { createAdminInstagramStore, createSupabaseInstagramStore } from "@/lib/meta/instagram-store";

export type InstagramIngestDeps = {
  sendDeps?: InstagramSendDeps;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
  timing?: InstagramTimingSession;
};

async function upsertConversation(
  store: InstagramIngestStore,
  event: NormalizedMetaInboundText,
): Promise<
  | { outcome: "ok"; row: InstagramConversationRow; created: boolean }
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
    return { outcome: "ok", row: existing, created: false };
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

  if (inserted.outcome === "inserted" && inserted.row) {
    return { outcome: "ok", row: inserted.row, created: true };
  }

  const lookedUp = await store.getConversation(
    event.channel,
    event.externalConversationId,
  );
  if (!lookedUp || "errorCode" in lookedUp) {
    return { outcome: "failed", errorCode: "conversation_lookup_failed" };
  }
  return { outcome: "ok", row: lookedUp, created: false };
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
      outboundSenderAddress: instagramOutboundSenderAddress({
        recipientAccountId: event.recipientAccountId,
        env: ingestDeps.sendDeps?.env,
      }),
      sendDeps: ingestDeps.sendDeps,
      loadTicket: ingestDeps.loadTicket,
    },
  };
}

function hydrateWorkingSnapshot(
  row: InstagramConversationRow,
  ticketInfo: { ticketId: string | null; status: string | null },
  event: NormalizedMetaInboundText,
): ConversationSnapshot {
  const snapshot = snapshotFromConversationRow(
    row,
    ticketInfo.status,
    event.displayName,
  );
  snapshot.ticketId = ticketInfo.ticketId;
  snapshot.ticketStatus = ticketInfo.status;
  if (!snapshot.suggestedSocialHandle) {
    snapshot.suggestedSocialHandle = event.displayName;
  }
  if (!snapshot.collected.cachedUsername) {
    snapshot.collected.cachedUsername =
      row.displayName ?? event.displayName ?? snapshot.suggestedSocialHandle;
  }
  return snapshot;
}

async function finishAlreadyProcessedInbound(input: {
  event: NormalizedMetaInboundText;
  store: InstagramIngestStore;
  conversationId: string;
  snapshot: ReturnType<typeof snapshotFromConversationRow>;
  ingestDeps: InstagramIngestDeps;
  eventId: string;
}): Promise<PersistResult> {
  const retried = await retryFailedInstagramOutbounds({
    store: input.store,
    recipientId: input.event.externalContactId,
    conversationId: input.conversationId,
    sendDeps: input.ingestDeps.sendDeps,
  });
  if (retried.retryableFailure) {
    await input.store.markWebhookEvent(
      input.eventId,
      WEBHOOK_STATUS_FAILED,
      "instagram_send_failed",
    );
    return { outcome: "failed", errorCode: "instagram_send_failed" };
  }

  const snapshot = input.snapshot;
  if (
    (snapshot.state === "awaiting_post_completion" ||
      snapshot.state === "ticket_open") &&
    !snapshot.ticketId &&
    Boolean(snapshot.collected.igIssueCategory) &&
    Boolean(snapshot.collected.issueDescription) &&
    Boolean(snapshot.collected.campaignName)
  ) {
    const applied = await applyInstagramEffects({
      effects: [{ type: "create_ticket" }],
      snapshotTicketId: null,
      collected: snapshot.collected,
      intakeSessionVersion: snapshot.intakeSessionVersion,
      snapshotToPersist: snapshot,
      lastMessageAt: input.event.timestamp,
      displayName:
        input.event.displayName ?? snapshot.collected.cachedUsername,
      expectedLastProcessedExternalMessageId:
        snapshot.lastProcessedExternalMessageId,
      ...instagramEffectArgs(
        input.event,
        input.store,
        input.conversationId,
        input.ingestDeps,
      ),
    });
    if (applied.ticketId && !applied.snapshotPersisted) {
      await input.store.saveConversationSnapshot(
        input.conversationId,
        { ...snapshot, ticketId: applied.ticketId },
        input.event.timestamp,
        input.event.displayName ?? snapshot.collected.cachedUsername,
      );
    }
    if (applied.retryableFailure) {
      await input.store.markWebhookEvent(
        input.eventId,
        WEBHOOK_STATUS_FAILED,
        applied.errorCode ?? "instagram_send_failed",
      );
      return {
        outcome: "failed",
        errorCode: applied.errorCode ?? "instagram_send_failed",
      };
    }
  }

  await input.store.markWebhookEvent(input.eventId, "completed");
  return { outcome: "duplicate" };
}

async function recoverMissingIntakePrompt(input: {
  event: NormalizedMetaInboundText;
  store: InstagramIngestStore;
  conversationId: string;
  snapshot: ReturnType<typeof snapshotFromConversationRow>;
  ingestDeps: InstagramIngestDeps;
}): Promise<"ok" | "recovered" | { failed: string }> {
  if (input.snapshot.lastProcessedExternalMessageId === input.event.externalMessageId) {
    return "ok";
  }
  if (
    isGlobalMenuOrRestart(
      input.event.messageBody,
      input.event.quickReplyPayload ?? null,
    )
  ) {
    return "ok";
  }

  const personaStates = INSTAGRAM_PERSONA_STATES as readonly string[];
  if (!personaStates.includes(input.snapshot.state)) return "ok";
  if (
    input.snapshot.state === "completed" ||
    input.snapshot.state === "awaiting_post_completion"
  ) {
    return "ok";
  }

  const prompt = instagramPromptForState(input.snapshot);
  if (!prompt) return "ok";

  const expectedKey = chatbotOutboundIdempotencyKey(
    input.conversationId,
    input.snapshot.intakeSessionVersion,
    prompt.promptKey,
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
    effects: [prompt],
    snapshotTicketId: input.snapshot.ticketId,
    collected: input.snapshot.collected,
    intakeSessionVersion: input.snapshot.intakeSessionVersion,
    snapshotToPersist: {
      ...input.snapshot,
      lastPromptKey: prompt.promptKey,
      lastActivityAt: input.event.timestamp,
      lastProcessedExternalMessageId: input.event.externalMessageId,
    },
    lastMessageAt: input.event.timestamp,
    displayName: input.event.displayName,
    expectedLastProcessedExternalMessageId:
      input.snapshot.lastProcessedExternalMessageId,
    ...instagramEffectArgs(
      input.event,
      input.store,
      input.conversationId,
      input.ingestDeps,
    ),
  });
  if (applied.retryableFailure) {
    return { failed: applied.errorCode ?? "instagram_send_failed" };
  }
  if (!applied.snapshotPersisted) {
    const recoveredSnapshot = {
      ...input.snapshot,
      lastPromptKey: prompt.promptKey,
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
  const timing = ingestDeps.timing;
  timing?.mark("event_claimed");

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
    timing?.mark("conversation_loaded");

    const ticketInfo = conversation.created
      ? { ticketId: null as string | null, status: null as string | null }
      : await ticketStatusFor(store, event, conversation.row.ticketId);
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
    timing?.mark("inbound_stored");

    let snapshot = hydrateWorkingSnapshot(
      conversation.row,
      ticketInfo,
      event,
    );
    let conversationRow = conversation.row;
    const inboundAlreadyProcessed =
      inbound.outcome === "duplicate" &&
      snapshot.lastProcessedExternalMessageId === event.externalMessageId;
    if (inboundAlreadyProcessed) {
      timing?.mark("state_reduced");
      const duplicate = await finishAlreadyProcessedInbound({
        event,
        store,
        conversationId: conversation.row.id,
        snapshot,
        ingestDeps,
        eventId,
      });
      if (duplicate.outcome !== "failed") {
        timing?.mark("critical_path_completed");
      }
      return duplicate;
    }

    const hasActiveTicket = Boolean(
      ticketInfo.ticketId && isActiveTicketStatus(ticketInfo.status),
    );
    if (
      !hasActiveTicket &&
      !snapshot.collected.cachedUsername &&
      !snapshot.collected.usernameLookupAttempted
    ) {
      snapshot.collected.usernameLookupAttempted = true;
      const lookedUp = await lookupInstagramUsername(
        event.externalContactId,
        ingestDeps.sendDeps,
      );
      if (lookedUp) {
        snapshot.collected.cachedUsername = lookedUp;
        snapshot.suggestedSocialHandle = lookedUp;
      }
    }

    const recovered = await recoverMissingIntakePrompt({
      event,
      store,
      conversationId: conversationRow.id,
      snapshot,
      ingestDeps,
    });
    if (recovered !== "ok") {
      if (recovered === "recovered") {
        timing?.mark("state_reduced");
        timing?.mark("outbound_reserved");
        timing?.mark("meta_send_completed");
        timing?.mark("critical_path_completed");
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

    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const expectedLastProcessed = snapshot.lastProcessedExternalMessageId;
      const reduced = reduceInstagramConversation(snapshot, {
        text: event.messageBody,
        quickReplyPayload: event.quickReplyPayload ?? null,
        timestamp: event.timestamp,
        messageId: event.externalMessageId,
      });
      timing?.mark("state_reduced");

      if (reduced.attachTicketId) {
        reduced.snapshot.ticketId = reduced.attachTicketId;
      }

      const applied = await applyInstagramEffects({
        effects: reduced.effects,
        snapshotTicketId: reduced.snapshot.ticketId,
        collected: reduced.snapshot.collected,
        intakeSessionVersion: reduced.snapshot.intakeSessionVersion,
        snapshotToPersist: reduced.snapshot,
        lastMessageAt: event.timestamp,
        displayName:
          event.displayName ?? reduced.snapshot.collected.cachedUsername,
        timing,
        expectedLastProcessedExternalMessageId: expectedLastProcessed,
        ...instagramEffectArgs(event, store, conversationRow.id, ingestDeps),
      });

      if (
        applied.errorCode === CONVERSATION_STATE_CONFLICT &&
        attempt + 1 < maxAttempts
      ) {
        const fresh = await store.getConversation(
          event.channel,
          event.externalConversationId,
        );
        if (!fresh || "errorCode" in fresh) {
          await store.markWebhookEvent(
            eventId,
            WEBHOOK_STATUS_FAILED,
            fresh && "errorCode" in fresh
              ? fresh.errorCode
              : "conversation_lookup_failed",
          );
          return {
            outcome: "failed",
            errorCode:
              fresh && "errorCode" in fresh
                ? fresh.errorCode
                : "conversation_lookup_failed",
          };
        }
        const reloadedTicket = await ticketStatusFor(store, event, fresh.ticketId);
        if ("errorCode" in reloadedTicket) {
          await store.markWebhookEvent(
            eventId,
            WEBHOOK_STATUS_FAILED,
            reloadedTicket.errorCode,
          );
          return { outcome: "failed", errorCode: reloadedTicket.errorCode };
        }
        conversationRow = fresh;
        snapshot = hydrateWorkingSnapshot(fresh, reloadedTicket, event);
        continue;
      }

      if (applied.retryableFailure) {
        const errorCode = applied.errorCode ?? "instagram_send_failed";
        await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, errorCode);
        return { outcome: "failed", errorCode };
      }

      if (applied.ticketId) {
        reduced.snapshot.ticketId = applied.ticketId;
        if (reduced.snapshot.state !== "awaiting_post_completion") {
          reduced.snapshot.state =
            reduced.snapshot.state || "awaiting_post_completion";
        }
      }

      if (!applied.snapshotPersisted) {
        const saved = await store.saveConversationSnapshot(
          conversationRow.id,
          reduced.snapshot,
          event.timestamp,
          event.displayName,
        );
        if (saved.outcome === "failed") {
          await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, saved.errorCode);
          return { outcome: "failed", errorCode: saved.errorCode };
        }
      }

      if (reduced.inboundRoutingKind !== "unclassified") {
        await store.markMessagesRoutingKind({
          conversationId: conversationRow.id,
          fromKind: "unclassified",
          toKind: reduced.inboundRoutingKind,
        });
      }

      timing?.mark("critical_path_completed");
      await store.markWebhookEvent(eventId, "completed");
      return {
        outcome: inbound.outcome === "duplicate" ? "duplicate" : "stored",
      };
    }

    await store.markWebhookEvent(
      eventId,
      WEBHOOK_STATUS_FAILED,
      CONVERSATION_STATE_CONFLICT,
    );
    return { outcome: "failed", errorCode: CONVERSATION_STATE_CONFLICT };
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
