import { getMetaInstagramAccountId } from "@/lib/meta/config";
import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";

export const CONVERSATION_STATE_CONFLICT = "conversation_state_conflict";
export const OUTBOUND_IDEMPOTENCY_CONFLICT = "outbound_idempotency_conflict";
export const OUTBOUND_ADDRESS_INVALID = "outbound_address_invalid";
export const CONVERSATION_NOT_FOUND = "conversation_not_found";

export function isNotDistinctFrom(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

export type OutboundDuplicateCandidate = {
  conversationId: string | null;
  channel: string | null;
  recipientExternalId: string | null;
  purpose: string | null;
  messageBody: string | null;
  routingKind: string | null;
  ticketId: string | null;
};

export function isCompatibleInstagramOutboundDuplicate(
  existing: OutboundDuplicateCandidate,
  candidate: OutboundDuplicateCandidate,
): boolean {
  return (
    isNotDistinctFrom(existing.conversationId, candidate.conversationId) &&
    existing.channel === "instagram" &&
    candidate.channel === "instagram" &&
    isNotDistinctFrom(existing.recipientExternalId, candidate.recipientExternalId) &&
    isNotDistinctFrom(existing.purpose, candidate.purpose) &&
    isNotDistinctFrom(existing.messageBody, candidate.messageBody) &&
    isNotDistinctFrom(
      existing.routingKind ?? "support",
      candidate.routingKind ?? "support",
    ) &&
    isNotDistinctFrom(existing.ticketId, candidate.ticketId)
  );
}

export function instagramOutboundAddressesAreAssigned(input: {
  senderAddress: string | null | undefined;
  recipientExternalId: string | null | undefined;
}): boolean {
  const sender = input.senderAddress?.trim() ?? "";
  const recipient = input.recipientExternalId?.trim() ?? "";
  return Boolean(sender && recipient && sender !== recipient);
}

export function parseReserveRpcError(
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
  return null;
}

export function shouldFallbackReserveRpc(
  error: { message?: string | null; code?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (parseReserveRpcError(error)) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /function .+ does not exist/i.test(message)
  );
}

export function instagramOutboundSenderAddress(input: {
  recipientAccountId?: string | null;
  env?: Record<string, string | undefined>;
}): string | null {
  const fromEvent = input.recipientAccountId?.trim() ?? "";
  if (fromEvent) return fromEvent;
  return getMetaInstagramAccountId(input.env);
}

export type InMemoryReservedMessage = {
  id: string;
  conversationId: string;
  channel: string;
  direction: "outbound";
  senderName: string;
  senderAddress: string | null;
  recipientExternalId: string | null;
  messageBody: string;
  purpose: string | null;
  ticketId: string | null;
  idempotencyKey: string;
  deliveryStatus: string;
  routingKind: string | null;
};

export type InMemoryReserveConversation = {
  id: string;
  lastProcessedExternalMessageId: string | null;
  lastMessageAt?: string;
  lastActivityAt?: string | null;
  state?: string;
  routingIntent?: string | null;
  currentIntakeField?: string | null;
  lastPromptKey?: string | null;
  collectedData?: unknown;
  ticketId?: string | null;
  intakeSessionVersion?: number;
  displayName?: string | null;
};

export type ReserveOutboundInput = {
  channel: string;
  recipientExternalId: string;
  senderAddress?: string | null;
  messageBody: string;
  idempotencyKey: string;
  purpose: string;
  ticketId?: string | null;
  routingKind?: string | null;
};

export type ReserveOutboundResult = {
  id: string;
  idempotencyKey: string;
  deliveryStatus: string;
  claimed: boolean;
};

export function applyReserveInstagramOutboundAndSnapshot(input: {
  conversation: InMemoryReserveConversation | null;
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
      conversation: InMemoryReserveConversation;
      outbounds: ReserveOutboundResult[];
      insertedMessages: InMemoryReservedMessage[];
    }
  | { outcome: "failed"; errorCode: string } {
  if (!input.conversation) {
    return { outcome: "failed", errorCode: CONVERSATION_NOT_FOUND };
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
    const channel = outbound.channel || "instagram";
    const ticketId = outbound.ticketId ?? null;
    const routingKind = outbound.routingKind ?? "support";
    if (
      !instagramOutboundAddressesAreAssigned({
        senderAddress: outbound.senderAddress,
        recipientExternalId: outbound.recipientExternalId,
      })
    ) {
      return { outcome: "failed", errorCode: OUTBOUND_ADDRESS_INVALID };
    }
    const duplicate = messages.find(
      (row) => row.idempotencyKey === outbound.idempotencyKey,
    );
    if (duplicate) {
      if (
        !isCompatibleInstagramOutboundDuplicate(
          {
            conversationId: duplicate.conversationId,
            channel: duplicate.channel,
            recipientExternalId: duplicate.recipientExternalId,
            purpose: duplicate.purpose,
            messageBody: duplicate.messageBody,
            routingKind: duplicate.routingKind,
            ticketId: duplicate.ticketId,
          },
          {
            conversationId: input.conversation.id,
            channel,
            recipientExternalId: outbound.recipientExternalId,
            purpose: outbound.purpose,
            messageBody: outbound.messageBody,
            routingKind,
            ticketId,
          },
        )
      ) {
        return { outcome: "failed", errorCode: OUTBOUND_IDEMPOTENCY_CONFLICT };
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
      channel,
      direction: "outbound",
      senderName: "Cloutflow",
      senderAddress: outbound.senderAddress?.trim() ? outbound.senderAddress.trim() : null,
      recipientExternalId: outbound.recipientExternalId,
      messageBody: outbound.messageBody,
      purpose: outbound.purpose,
      ticketId,
      idempotencyKey: outbound.idempotencyKey,
      deliveryStatus: "pending",
      routingKind,
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
