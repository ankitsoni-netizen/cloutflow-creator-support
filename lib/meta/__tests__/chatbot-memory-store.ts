import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { applyReserveInstagramOutboundAndSnapshot } from "@/lib/meta/instagram-reserve";
import { applyReserveWatiOutboundAndSnapshot } from "@/lib/wati/reserve";
import { instagramMemoryOutbox, instagramMemoryEmailOutbox } from "@/lib/meta/__tests__/instagram-memory-outbox";
import { watiMemoryOutbox } from "@/lib/meta/__tests__/wati-memory-outbox";
import { isInstagramEmailTerminalError } from "@/lib/meta/email-drain-purposes";
import {
  IDENTITY_AMBIGUOUS,
  IDENTITY_MISSING,
  conversationIdentityFromLookup,
  decidePhaseACanonicalIdentityPromotion,
  findActiveTicketForIdentity,
  findConversationForIdentity,
  outboundIdentityAllowsReply,
  resolvedRecipientAccountId,
  type ConversationIdentity,
} from "@/lib/meta/conversation-identity";
import {
  IDENTITY_SCHEMA_UNAVAILABLE,
  isIdentitySchemaPhaseC,
} from "@/lib/meta/identity-schema-phase";
import {
  applyWebhookEventClaim,
  applyWebhookEventMark,
} from "@/lib/meta/webhook-event-claim";

export type MemoryIdentitySchema = "current" | "expanded";

export function createMemoryChatbotStore(
  ticketChannel: "instagram" | "whatsapp" = "instagram",
  options: { identitySchema?: MemoryIdentitySchema } = {},
): InstagramIngestStore & {
  events: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  emails: Array<Record<string, unknown>>;
  getConversationCalls: number;
  findActiveCalls: number;
} {
  const identitySchema = options.identitySchema ?? "current";
  const requireExpandedSchema = () => {
    if (isIdentitySchemaPhaseC() && identitySchema !== "expanded") {
      return { errorCode: IDENTITY_SCHEMA_UNAVAILABLE };
    }
    return null;
  };
  const events: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const tickets: Array<Record<string, unknown>> = [];
  const emails: Array<Record<string, unknown>> = [];
  let ids = 0;
  const nextId = () => `id-${++ids}`;
  let ticketInsertChain = Promise.resolve();

  function mappedConversation(row: Record<string, unknown>) {
    return {
      id: row.id as string,
      displayName: (row.displayName as string | null) ?? null,
      ticketId: (row.ticketId as string | null) ?? null,
      state: String(row.state ?? "unclassified"),
      routingIntent: (row.routingIntent as string | null) ?? null,
      currentIntakeField: (row.currentIntakeField as string | null) ?? null,
      lastPromptKey: (row.lastPromptKey as string | null) ?? null,
      lastActivityAt: (row.lastActivityAt as string | null) ?? null,
      lastProcessedExternalMessageId:
        (row.lastProcessedExternalMessageId as string | null) ?? null,
      collectedData: (row.collectedData as Record<string, unknown>) ?? {},
      externalContactId: (row.externalContactId as string | null) ?? null,
      intakeSessionVersion: Number(row.intakeSessionVersion ?? 0) || 0,
      provider: (row.provider as string | null) ?? null,
      recipientAccountId: (row.recipientAccountId as string | null) ?? null,
      externalConversationId:
        (row.externalConversationId as string | null) ?? null,
      identityStatus: (row.identityStatus as string | null) ?? null,
    };
  }

  const store = {
    events,
    conversations,
    messages,
    tickets,
    emails,
    async claimWebhookEvent(input: {
      provider: string;
      externalEventId: string;
      payload: unknown;
      payloadHash: string | null;
    }) {
      return applyWebhookEventClaim(events, input, nextId);
    },
    async markWebhookEvent(id: string, status: "completed" | "failed", errorCode: string | null = null) {
      applyWebhookEventMark(events, id, status, errorCode);
    },
    getConversationCalls: 0,
    findActiveCalls: 0,
    async getConversation(
      channel: string,
      externalConversationId: string,
      lookup?: {
        externalContactId?: string | null;
        provider?: string | null;
        recipientAccountId?: string | null;
      },
    ) {
      store.getConversationCalls += 1;
      const schemaError = requireExpandedSchema();
      if (schemaError) return schemaError;
      const identity = conversationIdentityFromLookup({
        channel: channel as ConversationIdentity["channel"],
        externalConversationId,
        externalContactId: lookup?.externalContactId,
        provider: lookup?.provider,
        recipientAccountId: lookup?.recipientAccountId,
      });
      if (!identity) {
        return { errorCode: IDENTITY_MISSING };
      }
      const matched = findConversationForIdentity(conversations, identity);
      if (matched && "errorCode" in matched) return matched;
      if (!matched) return null;
      if (
        isIdentitySchemaPhaseC() &&
        !outboundIdentityAllowsReply(matched.identityStatus as string | null)
      ) {
        return { errorCode: IDENTITY_AMBIGUOUS };
      }
      return mappedConversation(matched);
    },
    async promoteEligiblePhaseACanonicalIdentity(identity: ConversationIdentity) {
      if (!isIdentitySchemaPhaseC()) {
        return { outcome: "not_found" as const };
      }
      const schemaError = requireExpandedSchema();
      if (schemaError) {
        return { outcome: "not_eligible" as const, errorCode: schemaError.errorCode };
      }
      const ticket = await store.findActiveInstagramTicket({
        externalConversationId: identity.externalConversationId,
        externalContactId: identity.externalContactId,
        sourceChannel: identity.channel,
        provider: identity.provider,
        recipientAccountId: identity.recipientAccountId,
      });
      const contactRows = conversations.filter(
        (row) =>
          row.channel === identity.channel &&
          String(row.externalContactId ?? "") === identity.externalContactId,
      );
      if (contactRows.length === 0) {
        return { outcome: "not_found" as const };
      }
      const decision = decidePhaseACanonicalIdentityPromotion(
        contactRows,
        identity,
        { hasCompetingTicketCandidate: ticket !== null },
      );
      if (decision.outcome !== "promote") {
        return {
          outcome: "not_eligible" as const,
          errorCode: IDENTITY_AMBIGUOUS,
        };
      }
      const row = decision.row;
      const stillEligible =
        row.identityStatus == null &&
        (row.provider == null || String(row.provider).trim() === "") &&
        (row.recipientAccountId == null ||
          String(row.recipientAccountId).trim() === "") &&
        row.ticketId == null &&
        row.externalConversationId === identity.externalConversationId &&
        row.externalContactId === identity.externalContactId;
      if (stillEligible) {
        row.provider = identity.provider;
        row.recipientAccountId = identity.recipientAccountId;
        row.identityStatus = "unambiguous";
        return {
          outcome: "promoted" as const,
          row: mappedConversation(row),
        };
      }
      if (
        row.identityStatus === "unambiguous" &&
        row.provider === identity.provider &&
        row.recipientAccountId === identity.recipientAccountId &&
        row.externalContactId === identity.externalContactId &&
        row.externalConversationId === identity.externalConversationId
      ) {
        return {
          outcome: "already_promoted" as const,
          row: mappedConversation(row),
        };
      }
      return {
        outcome: "not_eligible" as const,
        errorCode: IDENTITY_AMBIGUOUS,
      };
    },
    async insertConversation(input: Record<string, unknown>) {
      const schemaError = requireExpandedSchema();
      if (schemaError) {
        return { outcome: "failed" as const, errorCode: schemaError.errorCode };
      }
      const contactId = String(input.externalContactId ?? "").trim();
      const conversationId = String(input.externalConversationId ?? "").trim();
      if (!contactId || !conversationId) {
        return { outcome: "failed" as const, errorCode: IDENTITY_MISSING };
      }
      const incomingRecipient = String(input.recipientAccountId ?? "").trim();
      const duplicate = conversations.find((conversation) => {
        if (conversation.channel !== input.channel) return false;
        if (conversation.externalConversationId === conversationId) return true;
        if (conversation.externalContactId !== contactId) return false;
        if (
          isIdentitySchemaPhaseC() &&
          !outboundIdentityAllowsReply(
            conversation.identityStatus as string | null | undefined,
          )
        ) {
          return false;
        }
        const existingRecipient = String(
          conversation.recipientAccountId ?? "",
        ).trim();
        if (incomingRecipient && existingRecipient) {
          return incomingRecipient === existingRecipient;
        }
        return !incomingRecipient && !existingRecipient;
      });
      if (duplicate) return { outcome: "duplicate" as const };
      const id = nextId();
      const row = {
        id,
        ...input,
        state: input.state ?? "unclassified",
        collectedData: {},
        ticketId: null,
        routingIntent: "unclassified",
        intakeSessionVersion: 0,
        identityStatus:
          identitySchema === "expanded" && isIdentitySchemaPhaseC()
            ? (input.identityStatus as string | null | undefined) ??
              (String(input.provider ?? "").trim() &&
              String(input.recipientAccountId ?? "").trim()
                ? "unambiguous"
                : null)
            : null,
      };
      conversations.push(row);
      return {
        outcome: "inserted" as const,
        id,
        row: {
          id,
          displayName: (input.displayName as string | null) ?? null,
          ticketId: null,
          state: String(input.state ?? "unclassified"),
          routingIntent: "unclassified",
          currentIntakeField: null,
          lastPromptKey: null,
          lastActivityAt: (input.lastMessageAt as string | null) ?? null,
          lastProcessedExternalMessageId: null,
          collectedData: {},
          externalContactId: (input.externalContactId as string | null) ?? null,
          intakeSessionVersion: 0,
          identityStatus: (row.identityStatus as string | null) ?? null,
        },
      };
    },
    async updateConversation(id: string, patch: { displayName?: string | null }) {
      const row = conversations.find((conversation) => conversation.id === id);
      if (!row) return { outcome: "failed" as const, errorCode: "conversation_update_failed" };
      if (patch.displayName?.trim()) row.displayName = patch.displayName.trim();
      return { outcome: "updated" as const };
    },
    async saveConversationSnapshot(
      id: string,
      snapshot: Record<string, unknown>,
      lastMessageAt: string,
      displayName: string | null,
    ) {
      const row = conversations.find((conversation) => conversation.id === id);
      if (!row) return { outcome: "failed" as const, errorCode: "conversation_update_failed" };
      row.lastMessageAt = lastMessageAt;
      row.lastActivityAt = snapshot.lastActivityAt;
      row.state = snapshot.state;
      row.routingIntent = snapshot.routingIntent;
      row.currentIntakeField = snapshot.currentIntakeField;
      row.lastPromptKey = snapshot.lastPromptKey;
      row.lastProcessedExternalMessageId = snapshot.lastProcessedExternalMessageId;
      row.collectedData = snapshot.collected;
      row.ticketId = snapshot.ticketId;
      row.intakeSessionVersion = snapshot.intakeSessionVersion ?? row.intakeSessionVersion ?? 0;
      if (displayName?.trim()) row.displayName = displayName;
      return { outcome: "updated" as const };
    },
    async insertInboundMessage(input: Record<string, unknown>) {
      const duplicate = messages.find(
        (message) =>
          message.channel === input.channel &&
          message.externalMessageId === input.externalMessageId,
      );
      if (duplicate) return { outcome: "duplicate" as const, id: duplicate.id as string };
      const id = nextId();
      messages.push({
        id,
        ...input,
        direction: "inbound",
        ticketId: input.ticketId ?? null,
        deliveryStatus: "received",
      });
      return { outcome: "inserted" as const, id };
    },
    async getTicket(id: string) {
      const row = tickets.find((ticket) => ticket.id === id);
      if (!row) return null;
      return {
        id: row.id as string,
        status: String(row.status),
        ticketCode: row.ticketCode as string | null,
      };
    },
    async findActiveInstagramTicket(input: {
      externalConversationId: string;
      externalContactId: string;
      sourceChannel?: "instagram" | "whatsapp";
      provider?: string | null;
      recipientAccountId?: string | null;
    }) {
      store.findActiveCalls += 1;
      const schemaError = requireExpandedSchema();
      if (schemaError) return schemaError;
      const channel = input.sourceChannel ?? ticketChannel;
      const contactId = input.externalContactId.trim();
      const conversationId = input.externalConversationId.trim();
      if (!contactId || !conversationId) {
        return { errorCode: IDENTITY_MISSING };
      }
      const identity = conversationIdentityFromLookup({
        channel,
        externalConversationId: conversationId,
        externalContactId: contactId,
        provider: input.provider,
        recipientAccountId: input.recipientAccountId,
      });
      if (!identity) {
        return { errorCode: IDENTITY_MISSING };
      }
      const matched = findActiveTicketForIdentity(
        tickets,
        identity,
        channel,
        (ticket) =>
          ["open", "in_progress", "waiting"].includes(String(ticket.status)),
      );
      if (matched && "errorCode" in matched) return matched;
      if (!matched) return null;
      return {
        id: matched.id as string,
        status: String(matched.status),
        ticketCode: matched.ticketCode as string,
      };
    },
    async insertInstagramTicket(row: Record<string, unknown>) {
      const run = ticketInsertChain.then(() => {
        const schemaError = requireExpandedSchema();
        if (schemaError) {
          return { outcome: "failed" as const, errorCode: schemaError.errorCode };
        }
        const channel =
          row.source_channel === "whatsapp" ? "whatsapp" : ticketChannel;
        const contactId = String(row.external_contact_id ?? "").trim();
        const conversationId = String(row.external_conversation_id ?? "").trim();
        if (!contactId || !conversationId) {
          return {
            outcome: "failed" as const,
            errorCode: IDENTITY_MISSING,
          };
        }
        const metadata =
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as { recipientAccountId?: unknown; provider?: unknown })
            : null;
        const identity = conversationIdentityFromLookup({
          channel,
          externalConversationId: conversationId,
          externalContactId: contactId,
          provider:
            typeof metadata?.provider === "string" ? metadata.provider : null,
          recipientAccountId: resolvedRecipientAccountId(
            typeof metadata?.recipientAccountId === "string"
              ? metadata.recipientAccountId
              : String(row.recipient_account_id ?? ""),
            conversationId,
            contactId,
          ),
        });
        if (!identity) {
          return {
            outcome: "failed" as const,
            errorCode: IDENTITY_MISSING,
          };
        }
        const existing = findActiveTicketForIdentity(
          tickets,
          identity,
          channel,
          (ticket) =>
            ["open", "in_progress", "waiting"].includes(String(ticket.status)),
        );
        if (existing && "errorCode" in existing) {
          return { outcome: "failed" as const, errorCode: existing.errorCode };
        }
        if (existing) {
          return {
            outcome: "duplicate" as const,
            id: existing.id as string,
            ticketCode: String(existing.ticketCode ?? existing.ticket_code ?? ""),
          };
        }
        const id = nextId();
        const ticketCode = `CF-2026-${String(tickets.length + 1).padStart(5, "0")}`;
        tickets.push({
          id,
          status: "open",
          sourceChannel: row.source_channel ?? ticketChannel,
          ticketCode,
          ticket_code: ticketCode,
          ...row,
        });
        return { outcome: "inserted" as const, id, ticketCode };
      });
      ticketInsertChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async claimOutboundMessage(input: Record<string, unknown>) {
      const duplicate = messages.find(
        (message) => message.idempotencyKey === input.idempotencyKey,
      );
      if (duplicate) {
        return {
          outcome: "duplicate" as const,
          id: duplicate.id as string,
          deliveryStatus: String(duplicate.deliveryStatus ?? "pending"),
          externalMessageId: (duplicate.externalMessageId as string | null) ?? null,
          conversationId: (duplicate.conversationId as string | null) ?? null,
          idempotencyKey: (duplicate.idempotencyKey as string | null) ?? null,
        };
      }
      const id = nextId();
      messages.push({
        id,
        ...input,
        direction: "outbound",
        deliveryStatus: "pending",
        routingKind: input.routingKind ?? "support",
      });
      return { outcome: "claimed" as const, id };
    },
    async markOutboundMessage(id: string, patch: Record<string, unknown>) {
      const row = messages.find((message) => message.id === id);
      if (!row) return;
      row.outboundClaimed = false;
      Object.assign(row, patch);
      if (patch.deliveryStatus !== undefined) row.deliveryStatus = patch.deliveryStatus;
      if (patch.externalMessageId !== undefined) {
        row.externalMessageId = patch.externalMessageId;
      }
      if (patch.deliveryErrorCode !== undefined) {
        row.deliveryErrorCode = patch.deliveryErrorCode;
      }
      if (patch.nextAttemptAt !== undefined) row.nextAttemptAt = patch.nextAttemptAt;
      if (patch.lastAttemptAt !== undefined) row.lastAttemptAt = patch.lastAttemptAt;
      if (patch.deliveryAttemptCount !== undefined) {
        row.deliveryAttemptCount = patch.deliveryAttemptCount;
      }
    },
    async findOutboundByExternalMessageId(externalMessageId: string) {
      const row = messages.find(
        (message) => message.externalMessageId === externalMessageId,
      );
      if (!row) return null;
      return {
        id: row.id as string,
        externalMessageId: (row.externalMessageId as string | null) ?? null,
        deliveryStatus: String(row.deliveryStatus ?? ""),
        idempotencyKey: (row.idempotencyKey as string | null) ?? null,
        recipientExternalId: (row.recipientExternalId as string | null) ?? null,
        conversationId: (row.conversationId as string | null) ?? null,
      };
    },
    async findOutboundByIdempotencyKey(idempotencyKey: string) {
      const row = messages.find((message) => message.idempotencyKey === idempotencyKey);
      if (!row) return null;
      return {
        id: row.id as string,
        externalMessageId: (row.externalMessageId as string | null) ?? null,
        deliveryStatus: String(row.deliveryStatus ?? ""),
        idempotencyKey: (row.idempotencyKey as string | null) ?? null,
        recipientExternalId: (row.recipientExternalId as string | null) ?? null,
        conversationId: (row.conversationId as string | null) ?? null,
      };
    },
    async insertEchoOutboundMessage(input: Record<string, unknown>) {
      const duplicate = messages.find(
        (message) => message.externalMessageId === input.externalMessageId,
      );
      if (duplicate) return { outcome: "duplicate" as const };
      messages.push({ id: nextId(), ...input, direction: "outbound", purpose: "echo_unmatched" });
      return { outcome: "inserted" as const };
    },
    async markMessagesRoutingKind(input: {
      conversationId: string;
      fromKind: string;
      toKind: string;
    }) {
      for (const message of messages) {
        if (
          message.conversationId === input.conversationId &&
          message.routingKind === input.fromKind
        ) {
          message.routingKind = input.toKind;
        }
      }
    },
    async linkSupportMessagesToTicket(input: { conversationId: string; ticketId: string }) {
      for (const message of messages) {
        if (
          message.conversationId === input.conversationId &&
          message.routingKind === "support" &&
          !message.ticketId
        ) {
          message.ticketId = input.ticketId;
        }
      }
    },
    async listSupportTranscript(input: { conversationId: string; ticketId: string }) {
      return messages
        .filter(
          (message) =>
            message.conversationId === input.conversationId &&
            message.ticketId === input.ticketId &&
            message.purpose !== "internal_note",
        )
        .map((message) => ({
          direction: String(message.direction ?? ""),
          messageBody: String(message.messageBody ?? ""),
          createdAt: "2020-10-18T22:13:26.000Z",
        }));
    },
    async listFailedOutbounds(conversationId: string) {
      return messages
        .filter(
          (message) =>
            message.conversationId === conversationId &&
            message.direction === "outbound" &&
            message.deliveryStatus === "failed",
        )
        .map((message) => ({
          id: message.id as string,
          messageBody: String(message.messageBody ?? ""),
          purpose: (message.purpose as string | null) ?? null,
        }));
    },
    async listRetryableOutbounds(conversationId: string) {
      return messages
        .filter(
          (message) =>
            message.conversationId === conversationId &&
            message.direction === "outbound" &&
            (message.deliveryStatus === "failed" ||
              message.deliveryStatus === "pending") &&
            message.purpose !== "staff_reply",
        )
        .map((message) => ({
          id: message.id as string,
          messageBody: String(message.messageBody ?? ""),
          purpose: (message.purpose as string | null) ?? null,
          rawPayload: message.rawPayload ?? message.raw_payload ?? null,
          recipientExternalId:
            (message.recipientExternalId as string | null) ?? null,
          deliveryStatus: String(message.deliveryStatus ?? ""),
        }));
    },
    ...instagramMemoryOutbox(messages),
    ...watiMemoryOutbox(messages),
    ...instagramMemoryEmailOutbox(emails),
    async getConversationEmailContext(conversationId: string) {
      const row = conversations.find((conversation) => conversation.id === conversationId);
      if (!row) return null;
      return {
        id: String(row.id),
        collectedData: (row.collectedData as Record<string, unknown>) ?? {},
        externalConversationId:
          (row.externalConversationId as string | null) ?? null,
      };
    },
    async reserveOutboundAndSnapshot(input: {
      conversationId: string;
      snapshot: Record<string, unknown> & {
        lastProcessedExternalMessageId?: string | null;
        lastActivityAt?: string | null;
        state?: string;
        routingIntent?: string | null;
        currentIntakeField?: string | null;
        lastPromptKey?: string | null;
        collected?: unknown;
        ticketId?: string | null;
        intakeSessionVersion?: number;
      };
      lastMessageAt: string;
      displayName: string | null;
      expectedLastProcessedExternalMessageId?: string | null;
      outbounds: Array<Record<string, unknown>>;
    }) {
      const row = conversations.find(
        (conversation) => conversation.id === input.conversationId,
      );
      const result = applyReserveInstagramOutboundAndSnapshot({
        conversation: row
          ? {
              id: String(row.id),
              lastProcessedExternalMessageId:
                (row.lastProcessedExternalMessageId as string | null) ?? null,
              displayName: (row.displayName as string | null) ?? null,
            }
          : null,
        expectedLastProcessedExternalMessageId:
          input.expectedLastProcessedExternalMessageId ?? null,
        snapshot: input.snapshot as Parameters<
          typeof applyReserveInstagramOutboundAndSnapshot
        >[0]["snapshot"],
        lastMessageAt: input.lastMessageAt,
        displayName: input.displayName,
        outbounds: input.outbounds.map((outbound) => ({
          channel: String(outbound.channel ?? "instagram"),
          recipientExternalId: String(outbound.recipientExternalId ?? ""),
          senderAddress: (outbound.senderAddress as string | null) ?? null,
          messageBody: String(outbound.messageBody ?? ""),
          idempotencyKey: String(outbound.idempotencyKey ?? ""),
          purpose: String(outbound.purpose ?? "prompt"),
          ticketId: (outbound.ticketId as string | null) ?? null,
          routingKind: (outbound.routingKind as string | null) ?? "support",
          rawPayload: outbound.rawPayload ?? null,
        })),
        existingMessages: messages
          .filter((message) => message.idempotencyKey)
          .map((message) => ({
            id: String(message.id),
            conversationId: String(message.conversationId ?? ""),
            channel: String(message.channel ?? "instagram"),
            direction: "outbound" as const,
            senderName: "Cloutflow",
            senderAddress: (message.senderAddress as string | null) ?? null,
            recipientExternalId:
              (message.recipientExternalId as string | null) ?? null,
            messageBody: String(message.messageBody ?? ""),
            purpose: (message.purpose as string | null) ?? null,
            ticketId: (message.ticketId as string | null) ?? null,
            idempotencyKey: String(message.idempotencyKey),
            deliveryStatus: String(message.deliveryStatus ?? "pending"),
            routingKind: (message.routingKind as string | null) ?? "support",
            rawPayload: message.rawPayload ?? null,
          })),
        nextId,
      });
      if (result.outcome === "failed") {
        return { outcome: "failed" as const, errorCode: result.errorCode };
      }
      if (row) {
        row.lastMessageAt = result.conversation.lastMessageAt;
        row.lastActivityAt = result.conversation.lastActivityAt;
        row.state = result.conversation.state;
        row.routingIntent = result.conversation.routingIntent;
        row.currentIntakeField = result.conversation.currentIntakeField;
        row.lastPromptKey = result.conversation.lastPromptKey;
        row.lastProcessedExternalMessageId =
          result.conversation.lastProcessedExternalMessageId;
        row.collectedData = result.conversation.collectedData;
        row.ticketId = result.conversation.ticketId;
        row.intakeSessionVersion = result.conversation.intakeSessionVersion;
        if (result.conversation.displayName) {
          row.displayName = result.conversation.displayName;
        }
      }
      for (const message of result.insertedMessages) {
        messages.push({
          ...message,
          deliveryAttemptCount: 0,
          nextAttemptAt: null,
        });
      }
      return { outcome: "reserved" as const, outbounds: result.outbounds };
    },
    async reserveWatiOutboundAndSnapshot(input: {
      conversationId: string;
      snapshot: Record<string, unknown> & {
        lastProcessedExternalMessageId?: string | null;
        lastActivityAt?: string | null;
        state?: string;
        routingIntent?: string | null;
        currentIntakeField?: string | null;
        lastPromptKey?: string | null;
        collected?: unknown;
        ticketId?: string | null;
        intakeSessionVersion?: number;
      };
      lastMessageAt: string;
      displayName: string | null;
      expectedLastProcessedExternalMessageId?: string | null;
      outbounds: Array<Record<string, unknown>>;
    }) {
      const row = conversations.find(
        (conversation) => conversation.id === input.conversationId,
      );
      const result = applyReserveWatiOutboundAndSnapshot({
        conversation: row
          ? {
              id: String(row.id),
              lastProcessedExternalMessageId:
                (row.lastProcessedExternalMessageId as string | null) ?? null,
              displayName: (row.displayName as string | null) ?? null,
              channel: (row.channel as string | null) ?? "whatsapp",
              provider: (row.provider as string | null) ?? "wati",
            }
          : null,
        expectedLastProcessedExternalMessageId:
          input.expectedLastProcessedExternalMessageId ?? null,
        snapshot: input.snapshot as Parameters<
          typeof applyReserveWatiOutboundAndSnapshot
        >[0]["snapshot"],
        lastMessageAt: input.lastMessageAt,
        displayName: input.displayName,
        outbounds: input.outbounds.map((outbound) => ({
          channel: "whatsapp" as const,
          recipientExternalId: String(outbound.recipientExternalId ?? ""),
          senderAddress: (outbound.senderAddress as string | null) ?? null,
          messageBody: String(outbound.messageBody ?? ""),
          idempotencyKey: String(outbound.idempotencyKey ?? ""),
          purpose: String(outbound.purpose ?? "prompt"),
          ticketId: (outbound.ticketId as string | null) ?? null,
          routingKind: (outbound.routingKind as string | null) ?? "support",
          rawPayload: outbound.rawPayload ?? null,
        })),
        existingMessages: messages
          .filter((message) => message.idempotencyKey)
          .map((message) => ({
            id: String(message.id),
            conversationId: String(message.conversationId ?? ""),
            channel: String(message.channel ?? "whatsapp"),
            direction: "outbound" as const,
            senderName: "Cloutflow",
            senderAddress: (message.senderAddress as string | null) ?? null,
            recipientExternalId:
              (message.recipientExternalId as string | null) ?? null,
            messageBody: String(message.messageBody ?? ""),
            purpose: (message.purpose as string | null) ?? null,
            ticketId: (message.ticketId as string | null) ?? null,
            idempotencyKey: String(message.idempotencyKey),
            deliveryStatus: String(message.deliveryStatus ?? "pending"),
            routingKind: (message.routingKind as string | null) ?? "support",
            rawPayload: message.rawPayload ?? null,
          })),
        nextId,
      });
      if (result.outcome === "failed") {
        return { outcome: "failed" as const, errorCode: result.errorCode };
      }
      if (row) {
        row.lastMessageAt = result.conversation.lastMessageAt;
        row.lastActivityAt = result.conversation.lastActivityAt;
        row.state = result.conversation.state;
        row.routingIntent = result.conversation.routingIntent;
        row.currentIntakeField = result.conversation.currentIntakeField;
        row.lastPromptKey = result.conversation.lastPromptKey;
        row.lastProcessedExternalMessageId =
          result.conversation.lastProcessedExternalMessageId;
        row.collectedData = result.conversation.collectedData;
        row.ticketId = result.conversation.ticketId;
        row.intakeSessionVersion = result.conversation.intakeSessionVersion;
        if (result.conversation.displayName) {
          row.displayName = result.conversation.displayName;
        }
      }
      for (const message of result.insertedMessages) {
        messages.push({
          ...message,
          deliveryAttemptCount: 0,
          nextAttemptAt: null,
        });
      }
      return { outcome: "reserved" as const, outbounds: result.outbounds };
    },
    async claimEmailDelivery(input: Record<string, unknown>) {
      const duplicate = emails.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (duplicate) {
        const status = String(duplicate.deliveryStatus ?? "pending");
        if (isInstagramEmailTerminalError(duplicate.errorCode as string | null)) {
          return {
            outcome: "duplicate" as const,
            id: duplicate.id as string,
            deliveryStatus: status,
          };
        }
        if (status === "failed" || status === "skipped") {
          duplicate.deliveryStatus = "pending";
          duplicate.errorCode = null;
          return { outcome: "claimed" as const, id: duplicate.id as string };
        }
        return {
          outcome: "duplicate" as const,
          id: duplicate.id as string,
          deliveryStatus: status,
        };
      }
      const id = nextId();
      emails.push({ id, ...input, deliveryStatus: "pending" });
      return { outcome: "claimed" as const, id };
    },
    async markEmailDelivery(id: string, patch: Record<string, unknown>) {
      const row = emails.find((email) => email.id === id);
      if (!row) return;
      Object.assign(row, patch);
    },
  };

  return store as unknown as InstagramIngestStore & {
    events: typeof events;
    conversations: typeof conversations;
    messages: typeof messages;
    tickets: typeof tickets;
    emails: typeof emails;
    getConversationCalls: number;
    findActiveCalls: number;
  };
}
