import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";
import {
  durableInstagramOutboundPayload,
  instagramOutboundPayloadsCompatible,
} from "@/lib/meta/instagram-outbound-payload";
import {
  CONVERSATION_NOT_FOUND,
  CONVERSATION_STATE_CONFLICT,
  isNotDistinctFrom,
  OUTBOUND_ADDRESS_INVALID,
  OUTBOUND_IDEMPOTENCY_CONFLICT,
  type InMemoryReserveConversation,
  type InMemoryReservedMessage,
  type OutboundDuplicateCandidate,
  type ReserveOutboundInput,
  type ReserveOutboundResult,
} from "@/lib/meta/instagram-reserve";

export const INVALID_WATI_CHANNEL = "invalid_channel";
export const INVALID_WATI_PROVIDER = "invalid_provider";
export const MISSING_WATI_IDEMPOTENCY_KEY = "missing_idempotency_key";

export function parseWatiReserveRpcError(
  error: { message?: string | null; code?: string | null } | null | undefined,
): string | null {
  if (!error) return null;
  const message = typeof error.message === "string" ? error.message : "";
  if (message.includes(CONVERSATION_STATE_CONFLICT)) {
    return CONVERSATION_STATE_CONFLICT;
  }
  if (message.includes(OUTBOUND_IDEMPOTENCY_CONFLICT)) {
    return OUTBOUND_IDEMPOTENCY_CONFLICT;
  }
  if (message.includes(OUTBOUND_ADDRESS_INVALID)) {
    return OUTBOUND_ADDRESS_INVALID;
  }
  if (message.includes(CONVERSATION_NOT_FOUND)) {
    return CONVERSATION_NOT_FOUND;
  }
  if (message.includes(INVALID_WATI_CHANNEL)) return INVALID_WATI_CHANNEL;
  if (message.includes(INVALID_WATI_PROVIDER)) return INVALID_WATI_PROVIDER;
  if (message.includes(MISSING_WATI_IDEMPOTENCY_KEY)) {
    return MISSING_WATI_IDEMPOTENCY_KEY;
  }
  return null;
}

function isCompatibleWatiOutboundDuplicate(
  existing: OutboundDuplicateCandidate,
  candidate: OutboundDuplicateCandidate,
): boolean {
  return (
    isNotDistinctFrom(existing.conversationId, candidate.conversationId) &&
    existing.channel === "whatsapp" &&
    candidate.channel === "whatsapp" &&
    isNotDistinctFrom(existing.recipientExternalId, candidate.recipientExternalId) &&
    isNotDistinctFrom(existing.purpose, candidate.purpose) &&
    isNotDistinctFrom(existing.messageBody, candidate.messageBody) &&
    isNotDistinctFrom(
      existing.routingKind ?? "support",
      candidate.routingKind ?? "support",
    ) &&
    isNotDistinctFrom(existing.ticketId, candidate.ticketId) &&
    instagramOutboundPayloadsCompatible(existing.rawPayload, candidate.rawPayload)
  );
}

export type WatiInMemoryReserveConversation = InMemoryReserveConversation & {
  channel?: string | null;
  provider?: string | null;
};

export function applyReserveWatiOutboundAndSnapshot(input: {
  conversation: WatiInMemoryReserveConversation | null;
  expectedLastProcessedExternalMessageId: string | null;
  snapshot: ConversationSnapshot;
  lastMessageAt: string;
  displayName: string | null;
  outbounds: ReserveOutboundInput[];
  existingMessages: InMemoryReservedMessage[];
  nextId: () => string;
}):
  | {
      outcome: "reserved";
      conversation: WatiInMemoryReserveConversation;
      outbounds: ReserveOutboundResult[];
      insertedMessages: InMemoryReservedMessage[];
    }
  | { outcome: "failed"; errorCode: string } {
  if (!input.conversation) {
    return { outcome: "failed", errorCode: CONVERSATION_NOT_FOUND };
  }
  if ((input.conversation.channel ?? "whatsapp") !== "whatsapp") {
    return { outcome: "failed", errorCode: INVALID_WATI_CHANNEL };
  }
  if ((input.conversation.provider ?? "wati") !== "wati") {
    return { outcome: "failed", errorCode: INVALID_WATI_PROVIDER };
  }
  for (const outbound of input.outbounds) {
    if ((outbound.channel || "whatsapp") !== "whatsapp") {
      return { outcome: "failed", errorCode: INVALID_WATI_CHANNEL };
    }
    if (!outbound.idempotencyKey.trim()) {
      return { outcome: "failed", errorCode: MISSING_WATI_IDEMPOTENCY_KEY };
    }
    if (!outbound.recipientExternalId.trim()) {
      return { outcome: "failed", errorCode: OUTBOUND_ADDRESS_INVALID };
    }
  }
  if (
    !isNotDistinctFrom(
      input.conversation.lastProcessedExternalMessageId,
      input.expectedLastProcessedExternalMessageId,
    )
  ) {
    return { outcome: "failed", errorCode: CONVERSATION_STATE_CONFLICT };
  }

  const messages = input.existingMessages.map((row) => ({ ...row }));
  const insertedMessages: InMemoryReservedMessage[] = [];
  const reserved: ReserveOutboundResult[] = [];

  for (const outbound of input.outbounds) {
    const ticketId = outbound.ticketId ?? null;
    const routingKind = outbound.routingKind ?? "support";
    const durablePayload = durableInstagramOutboundPayload({
      text: outbound.messageBody,
      rawPayload: outbound.rawPayload,
    });
    const duplicate = messages.find(
      (row) => row.idempotencyKey === outbound.idempotencyKey,
    );
    if (duplicate) {
      if (
        !isCompatibleWatiOutboundDuplicate(
          {
            conversationId: duplicate.conversationId,
            channel: duplicate.channel,
            recipientExternalId: duplicate.recipientExternalId,
            purpose: duplicate.purpose,
            messageBody: duplicate.messageBody,
            routingKind: duplicate.routingKind,
            ticketId: duplicate.ticketId,
            rawPayload: duplicate.rawPayload ?? null,
          },
          {
            conversationId: input.conversation.id,
            channel: "whatsapp",
            recipientExternalId: outbound.recipientExternalId,
            purpose: outbound.purpose,
            messageBody: outbound.messageBody,
            routingKind,
            ticketId,
            rawPayload: durablePayload,
          },
        )
      ) {
        return { outcome: "failed", errorCode: OUTBOUND_IDEMPOTENCY_CONFLICT };
      }
      if (duplicate.rawPayload == null && durablePayload) {
        duplicate.rawPayload = durablePayload;
      }
      reserved.push({
        id: duplicate.id,
        idempotencyKey: outbound.idempotencyKey,
        deliveryStatus: duplicate.deliveryStatus || "pending",
        claimed: false,
      });
      continue;
    }

    const row: InMemoryReservedMessage = {
      id: input.nextId(),
      conversationId: input.conversation.id,
      channel: "whatsapp",
      direction: "outbound",
      senderName: "Cloutflow",
      senderAddress: outbound.senderAddress?.trim()
        ? outbound.senderAddress.trim()
        : null,
      recipientExternalId: outbound.recipientExternalId,
      messageBody: outbound.messageBody,
      purpose: outbound.purpose,
      ticketId,
      idempotencyKey: outbound.idempotencyKey,
      deliveryStatus: "pending",
      routingKind,
      rawPayload: durablePayload,
    };
    messages.push(row);
    insertedMessages.push(row);
    reserved.push({
      id: row.id,
      idempotencyKey: outbound.idempotencyKey,
      deliveryStatus: "pending",
      claimed: true,
    });
  }

  const nextName = input.displayName?.trim() || null;
  return {
    outcome: "reserved",
    conversation: {
      ...input.conversation,
      lastMessageAt: input.lastMessageAt,
      lastActivityAt: input.snapshot.lastActivityAt ?? input.lastMessageAt,
      state: input.snapshot.state,
      routingIntent: input.snapshot.routingIntent,
      currentIntakeField: input.snapshot.currentIntakeField,
      lastPromptKey: input.snapshot.lastPromptKey,
      lastProcessedExternalMessageId: input.snapshot.lastProcessedExternalMessageId,
      collectedData: input.snapshot.collected,
      ticketId: input.snapshot.ticketId,
      intakeSessionVersion: input.snapshot.intakeSessionVersion,
      displayName: nextName ?? input.conversation.displayName ?? null,
    },
    outbounds: reserved,
    insertedMessages,
  };
}
