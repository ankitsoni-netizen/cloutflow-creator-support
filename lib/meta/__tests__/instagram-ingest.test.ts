import { afterEach, describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { applyReserveInstagramOutboundAndSnapshot } from "@/lib/meta/instagram-reserve";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import {
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_ISSUE_CATEGORY_TEXT,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  CREATOR_REASON_TEXT,
  FLOW_BACK_PAYLOAD,
  INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
  activeTicketAttachText,
  creatorTicketRaisedText,
  personaWelcomeText,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import {
  CAMPAIGN_MONTH_NO_PAYLOAD,
  CAMPAIGN_MONTH_YES_PAYLOAD,
} from "@/lib/meta/month-confirmation";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import {
  IDENTITY_MISSING,
  conversationLookupIds,
  findActiveTicketForIdentity,
  type ConversationIdentity,
} from "@/lib/meta/conversation-identity";
import {
  instagramPostbackPayload,
  instagramTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import { chatbotOutboundIdempotencyKey } from "@/lib/meta/prompt-keys";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import * as instagramSend from "@/lib/meta/instagram-send";
import { INSTAGRAM_USERNAME_LOOKUP_TIMEOUT_MS } from "@/lib/meta/instagram-username";
import { instagramMemoryOutbox, instagramMemoryEmailOutbox } from "@/lib/meta/__tests__/instagram-memory-outbox";
import { drainDueInstagramOutbox, drainInstagramOutbox } from "@/lib/meta/instagram-outbox";
import * as afterResponse from "@/lib/meta/after-response";
import { ingestInstagramEcho } from "@/lib/meta/instagram-echo";
import {
  personaBackPromptKey,
  personaQuickReplies,
} from "@/lib/meta/instagram-persona-machine";

function sampleInstagramEvent(
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: "mid.instagram.abc",
    externalMessageId: "mid.instagram.abc",
    externalConversationId: "12334",
    externalContactId: "12334",
    displayName: null,
    senderName: null,
    senderAddress: "12334",
    messageType: "text",
    messageBody: "Need help with a campaign",
    timestamp: "2020-10-18T22:13:26.000Z",
    phoneNumberId: null,
    recipientAccountId: "17841400008460000",
    quickReplyPayload: null,
    eventFragment: { message: { mid: "mid.instagram.abc" } },
    ...overrides,
  };
}

const SAMPLE_IG_LOOKUP = identityLookupFromEvent(sampleInstagramEvent());

function createMemoryInstagramStore(): InstagramIngestStore & {
  events: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  emails: Array<Record<string, unknown>>;
  getConversationCalls: number;
  findActiveCalls: number;
} {
  const events: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const tickets: Array<Record<string, unknown>> = [];
  const emails: Array<Record<string, unknown>> = [];
  let ids = 0;
  const nextId = () => `id-${++ids}`;
  let ticketInsertChain = Promise.resolve();

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
      const existing = events.find(
        (row) =>
          row.provider === input.provider &&
          row.externalEventId === input.externalEventId,
      );
      if (existing) {
        if (
          existing.processingStatus === "completed" ||
          existing.processingStatus === "processed"
        ) {
          return { outcome: "already_processed" as const };
        }
        existing.processingStatus = "processing";
        return { outcome: "retry" as const, id: existing.id as string };
      }
      const id = nextId();
      events.push({
        id,
        provider: input.provider,
        externalEventId: input.externalEventId,
        payload: input.payload,
        payloadHash: input.payloadHash,
        processingStatus: "processing",
      });
      return { outcome: "claimed" as const, id };
    },
    async markWebhookEvent(id: string, status: "completed" | "failed", errorCode: string | null = null) {
      const row = events.find((event) => event.id === id);
      if (!row) return;
      row.processingStatus = status;
      row.errorCode = status === "failed" ? errorCode : null;
      row.errorMessage = status === "failed" ? errorCode : null;
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
      const contactId = lookup?.externalContactId?.trim() ?? "";
      const ids = contactId
        ? conversationLookupIds({
            provider: "meta_instagram",
            channel: "instagram",
            recipientAccountId: lookup?.recipientAccountId?.trim() || contactId,
            externalContactId: contactId,
            externalConversationId,
          })
        : [externalConversationId];
      const row = conversations.find(
        (conversation) =>
          conversation.channel === channel &&
          ids.includes(String(conversation.externalConversationId)) &&
          (!contactId || conversation.externalContactId === contactId),
      );
      if (!row) return null;
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
      };
    },
    async insertConversation(input: Record<string, unknown>) {
      const id = nextId();
      const row = {
        id,
        ...input,
        state: input.state ?? "unclassified",
        collectedData: {},
        ticketId: null,
        routingIntent: "unclassified",
        intakeSessionVersion: 0,
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
      const contactId = input.externalContactId.trim();
      const conversationId = input.externalConversationId.trim();
      if (!contactId || !conversationId) {
        return { errorCode: IDENTITY_MISSING };
      }
      const identity: ConversationIdentity = {
        provider: "meta_instagram",
        channel: "instagram",
        recipientAccountId: input.recipientAccountId?.trim() || contactId,
        externalContactId: contactId,
        externalConversationId: conversationId,
      };
      const matched = findActiveTicketForIdentity(
        tickets,
        identity,
        "instagram",
        (ticket) =>
          ["open", "in_progress", "waiting"].includes(String(ticket.status)),
      );
      if (matched && "errorCode" in matched) return matched;
      if (!matched) return null;
      return { id: matched.id as string, status: String(matched.status), ticketCode: matched.ticketCode as string };
    },
    async insertInstagramTicket(row: Record<string, unknown>) {
      const run = ticketInsertChain.then(() => {
        const existing = tickets.find(
          (ticket) =>
            (ticket.sourceChannel === "instagram" ||
              ticket.source_channel === "instagram") &&
            (ticket.externalContactId === row.external_contact_id ||
              ticket.external_contact_id === row.external_contact_id) &&
            (ticket.externalConversationId === row.external_conversation_id ||
              ticket.external_conversation_id === row.external_conversation_id ||
              ticket.externalConversationId === row.external_contact_id ||
              ticket.external_conversation_id === row.external_contact_id) &&
            ["open", "in_progress", "waiting"].includes(String(ticket.status)),
        );
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
          sourceChannel: "instagram",
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
    async listSupportTranscript() {
      return messages
        .filter((message) => message.routingKind === "support")
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
        }));
    },
    ...instagramMemoryOutbox(messages),
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
    async claimEmailDelivery(input: Record<string, unknown>) {
      const duplicate = emails.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (duplicate) {
        const status = String(duplicate.deliveryStatus ?? "pending");
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

const context = { webhookPayload: { object: "instagram" } };

describe("ingestInstagramInboundMessage routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the routing question on the first DM and creates no ticket", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(0);
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      recipientId: "12334",
      text: personaWelcomeText(null),
    });
    send.mockRestore();
  });

  it("does not send a duplicate routing prompt for a repeated webhook", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const event = sampleInstagramEvent();
    await ingestInstagramInboundMessage(event, store, context);
    const second = await ingestInstagramInboundMessage(event, store, context);
    expect(second.outcome).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send twice when the same message id arrives on a different webhook event", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "evt.first",
        externalMessageId: "mid.same",
      }),
      store,
      context,
    );
    const second = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "evt.retry",
        externalMessageId: "mid.same",
      }),
      store,
      context,
    );
    expect(second.outcome).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
  });

  it("does not create a ticket for brand selection", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.collab",
        externalMessageId: "mid.collab",
        messageBody: "I'm a brand",
        quickReplyPayload: "PERSONA_BRAND",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(0);
    expect(store.conversations[0]?.state).toBe("brand_action");
  });

  it("attaches a follow-up to an active Instagram ticket without routing", async () => {
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.tickets.push({
      id: "ticket-open",
      status: "open",
      sourceChannel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      ticketCode: "CF-2026-00001",
    });
    store.conversations.push({
      id: "convo-1",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      state: "ticket_open",
      ticketId: "ticket-open",
      routingIntent: "creator_support",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.previous",
      intakeSessionVersion: 1,
    });
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.follow",
        externalMessageId: "mid.follow",
        messageBody: "Following up",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.messages.some((message) => message.ticketId === "ticket-open")).toBe(
      true,
    );
    expect(store.conversations[0]?.state).toBe("ticket_open");
  });

  it("does not log tokens, signatures, or message bodies on send failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: false,
      errorCode: "http_5xx",
      retryable: true,
      messagingWindowExpired: false,
      deliveryUnknown: false,
      httpStatus: 500,
    });
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        messageBody: "secret creator email riya@example.com",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("riya@example.com");
    expect(logged).not.toContain("secret creator email");
    expect(JSON.stringify(store.events[0])).not.toContain("riya@example.com");
    errorSpy.mockRestore();
  });

  it("creates exactly one campaign-issue ticket with issue details and no duplicate on webhook retry", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.issue-cat",
        externalMessageId: "mid.issue-cat",
        messageBody: "Campaign issue",
        quickReplyPayload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Acme, August 2026, riya@example.com",
      }),
      store,
      context,
    );
    const created = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.month.yes",
        externalMessageId: "mid.month.yes",
        messageBody: "Yes",
        quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
      store,
      context,
    );
    expect(created.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.issue_type).toBe("other");
    expect(store.tickets[0]?.creator_email).toBe("riya@example.com");
    expect(store.tickets[0]?.brand_name).toBe("Acme");
    expect(store.tickets[0]?.campaign_month).toBe("2026-08-01");
    expect(store.tickets[0]?.campaign_name).toBeNull();
    expect(store.tickets[0]?.platform).toBe("instagram");
    expect(store.conversations[0]?.state).toBe("awaiting_post_completion");
    const confirmation = qrSend.mock.calls
      .map((call) => call[0]?.text)
      .find((text) => typeof text === "string" && text.includes("CF-2026-00001"));
    expect(confirmation).toBe(
      withPostCompletionQuestion(creatorTicketRaisedText("CF-2026-00001")),
    );

    const duplicate = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.month.yes",
        externalMessageId: "mid.month.yes",
        messageBody: "Yes",
        quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
      store,
      context,
    );
    expect(duplicate.outcome).toBe("duplicate");
    expect(store.tickets).toHaveLength(1);
  });

  it("returns to the persona menu after RESTART and increments the session version", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({ messageBody: "Need help with a campaign" }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    const conversationId = String(store.conversations[0]?.id);
    const versionBeforeRestart = Number(store.conversations[0]?.intakeSessionVersion ?? 0);
    const oldReasonKey = chatbotOutboundIdempotencyKey(
      conversationId,
      versionBeforeRestart,
      "awaiting_creator_reason",
    );
    expect(
      store.messages.some((message) => message.idempotencyKey === oldReasonKey),
    ).toBe(true);

    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.restart",
        externalMessageId: "mid.restart",
        messageBody: "RESTART",
      }),
      store,
      context,
    );
    const collected = store.conversations[0]?.collectedData as Record<string, unknown>;
    expect(collected.igPersona).toBeNull();
    expect(collected.campaignName).toBeNull();
    expect(collected.originalInboundText).toBe("Need help with a campaign");
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    const versionAfterRestart = Number(store.conversations[0]?.intakeSessionVersion ?? 0);
    expect(versionAfterRestart).toBeGreaterThan(versionBeforeRestart);
    const newMenuKey = chatbotOutboundIdempotencyKey(
      conversationId,
      versionAfterRestart,
      "awaiting_persona",
    );
    expect(
      store.messages.filter((message) => message.idempotencyKey === newMenuKey),
    ).toHaveLength(1);

    const duplicate = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.restart",
        externalMessageId: "mid.restart",
        messageBody: "RESTART",
      }),
      store,
      context,
    );
    expect(duplicate.outcome).toBe("duplicate");
    expect(
      store.messages.filter((message) => message.idempotencyKey === newMenuKey),
    ).toHaveLength(1);
  });

  it("does not create a second ticket when creator apply is selected", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.apply",
        externalMessageId: "mid.apply",
        messageBody: "Work with Cloutflow",
        quickReplyPayload: "CREATOR_NEW_WORK",
      }),
      store,
      context,
    );
    expect(store.tickets).toHaveLength(0);
    expect(store.conversations[0]?.state).toBe("awaiting_post_completion");
  });

  it("falls back to Hi there when username lookup fails", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({ displayName: null, senderName: null }),
      store,
      context,
      {
        sendDeps: {
          env: {
            META_GRAPH_API_VERSION: "v23.0",
            META_IG_ACCESS_TOKEN: "token",
            META_IG_ACCOUNT_ID: "17841400008460000",
          },
          fetchImpl: async () => {
            throw new Error("lookup failed");
          },
        },
      },
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledWith(
      expect.objectContaining({ text: personaWelcomeText(null) }),
    );
  });

  it("recovers a missing creator-reason prompt on the next inbound", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-stuck",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      state: "awaiting_creator_reason",
      routingIntent: "unclassified",
      currentIntakeField: null,
      lastPromptKey: "awaiting_creator_reason",
      lastProcessedExternalMessageId: "mid.persona.old",
      intakeSessionVersion: 1,
      collectedData: { igPersona: "creator" },
    });
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.recover",
        externalMessageId: "mid.recover",
        messageBody: "hello",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");
    expect(
      store.messages.some(
        (message) =>
          message.direction === "outbound" &&
          message.messageBody === CREATOR_REASON_TEXT,
      ),
    ).toBe(true);
    const logged = JSON.stringify(store.events);
    expect(logged).not.toContain("riya@example.com");
  });

  it("restarts a legacy support_intake conversation at the persona menu", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-legacy",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: "platform_details",
      lastProcessedExternalMessageId: "mid.creator.old",
      intakeSessionVersion: 1,
      collectedData: {
        creatorName: "Riya Sharma",
        email: "riya@example.com",
      },
    });
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.legacy",
        externalMessageId: "mid.legacy",
        messageBody: "hello",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(store.tickets).toHaveLength(0);
    const collected = store.conversations[0]?.collectedData as Record<string, unknown>;
    expect(collected.creatorName).toBeNull();
    expect(JSON.stringify(store.events)).not.toContain("riya@example.com");
  });

  it("does not re-fetch a conversation after insert returning the row", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    expect(store.getConversationCalls).toBe(1);
    expect(store.findActiveCalls).toBe(0);
  });

  it("persists the next persona state before calling Meta", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const statesAtSend: string[] = [];
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockImplementation(
      async () => {
        statesAtSend.push(String(store.conversations[0]?.state));
        return {
          ok: true,
          metaMessageId: "mid.qr",
          recipientId: "12334",
        };
      },
    );
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");
    expect(statesAtSend.at(-1)).toBe("awaiting_creator_reason");
    expect(qrSend).toHaveBeenCalled();
  });

  it("keeps the new state when Meta send fails so the next answer and retry stay aligned", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies");
    qrSend
      .mockResolvedValueOnce({
        ok: true,
        metaMessageId: "mid.menu",
        recipientId: "12334",
      })
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "http_5xx",
        retryable: true,
        messagingWindowExpired: false,
        deliveryUnknown: false,
        httpStatus: 500,
      })
      .mockResolvedValue({
        ok: true,
        metaMessageId: "mid.retry",
        recipientId: "12334",
      });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const failed = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(failed.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");

    const reasonOutbounds = store.messages.filter(
      (message) =>
        message.direction === "outbound" &&
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason"),
    );
    expect(reasonOutbounds).toHaveLength(1);
    expect(reasonOutbounds[0]?.deliveryStatus).toBe("failed");
    expect(reasonOutbounds[0]?.deliveryErrorCode).toBe("http_5xx");
    expect(reasonOutbounds[0]?.nextAttemptAt).toBeTruthy();

    const retried = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(retried.outcome).toBe("duplicate");
    expect(reasonOutbounds[0]?.deliveryStatus).toBe("failed");
    expect(
      qrSend.mock.calls.filter((call) => call[0]?.text === CREATOR_REASON_TEXT),
    ).toHaveLength(1);
  });

  it("does not advance persona state when the next prompt cannot be reserved", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const originalReserve = store.reserveOutboundAndSnapshot.bind(store);
    store.reserveOutboundAndSnapshot = async (input) => {
      if (
        input.outbounds.some((outbound) =>
          String(outbound.idempotencyKey ?? "").includes("awaiting_creator_reason"),
        )
      ) {
        return { outcome: "failed" as const, errorCode: "outbound_insert_failed" };
      }
      return originalReserve(input);
    };

    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("failed");
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(
      store.messages.some((message) =>
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason"),
      ),
    ).toBe(false);
  });

  it("timing logs from ingest never include personal data or secrets", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const { createInstagramTimingSession } = await import("@/lib/meta/timing");
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        messageBody: "secret creator email riya@example.com 9876543210",
      }),
      store,
      context,
      { timing: createInstagramTimingSession() },
    );
    const logged = info.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("instagram webhook timing");
    expect(logged).not.toContain("riya@example.com");
    expect(logged).not.toContain("9876543210");
    expect(logged).not.toContain("Need help");
    expect(logged).not.toContain("12334");
    expect(logged).not.toMatch(/sha256=/i);
    info.mockRestore();
  });

  it("maps outbound sender to Cloutflow's Instagram account and recipient to the creator", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const event = sampleInstagramEvent();
    await ingestInstagramInboundMessage(event, store, context);
    const outbound = store.messages.find(
      (message) => message.direction === "outbound",
    );
    expect(outbound?.senderAddress).toBe(event.recipientAccountId);
    expect(outbound?.recipientExternalId).toBe(event.externalContactId);
    expect(outbound?.senderAddress).not.toBe(outbound?.recipientExternalId);
  });

  it("retries the second rapid DM after a conversation state conflict", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-1",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      state: "unclassified",
      routingIntent: "unclassified",
      collectedData: {},
      lastProcessedExternalMessageId: null,
      intakeSessionVersion: 0,
    });
    const reserveCodes: string[] = [];
    let helloAtReserve: (() => void) | null = null;
    const helloReady = new Promise<void>((resolve) => {
      helloAtReserve = resolve;
    });
    let bothAtReserve: (() => void) | null = null;
    const bothReady = new Promise<void>((resolve) => {
      bothAtReserve = resolve;
    });
    const original = store.reserveOutboundAndSnapshot.bind(store);
    store.reserveOutboundAndSnapshot = async (input) => {
      const nextId = input.snapshot.lastProcessedExternalMessageId;
      if (nextId === "mid.hello") {
        helloAtReserve?.();
        await bothReady;
        const result = await original(input);
        reserveCodes.push(
          result.outcome === "failed" ? result.errorCode : "reserved",
        );
        return result;
      }
      if (nextId === "mid.creator") {
        await helloReady;
        bothAtReserve?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = await original(input);
        reserveCodes.push(
          result.outcome === "failed" ? result.errorCode : "reserved",
        );
        return result;
      }
      const result = await original(input);
      reserveCodes.push(
        result.outcome === "failed" ? result.errorCode : "reserved",
      );
      return result;
    };

    const [hello, creator] = await Promise.all([
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.hello",
          externalMessageId: "mid.hello",
          messageBody: "Hi",
        }),
        store,
        context,
      ),
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.creator",
          externalMessageId: "mid.creator",
          messageBody: "I'm a creator",
          quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
        }),
        store,
        context,
      ),
    ]);

    expect(hello.outcome).toBe("stored");
    expect(creator.outcome).toBe("stored");
    expect(reserveCodes).toContain("conversation_state_conflict");
    expect(reserveCodes.filter((code) => code === "reserved").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");
    expect(store.conversations[0]?.lastProcessedExternalMessageId).toBe("mid.creator");
    expect(store.conversations[0]?.routingIntent).toBe("unclassified");
    const logged = [...errorSpy.mock.calls, ...infoSpy.mock.calls]
      .map((call) => JSON.stringify(call))
      .join(" ");
    expect(logged).not.toContain("12334");
    expect(logged).not.toContain("17841400008460000");
    expect(logged).not.toContain("I'm a creator");
    expect(logged).not.toMatch(/ig:prompt:/);
  });
});

async function reachCreatorReason(
  store: ReturnType<typeof createMemoryInstagramStore>,
) {
  await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
  await ingestInstagramInboundMessage(
    sampleInstagramEvent({
      externalEventId: "mid.persona",
      externalMessageId: "mid.persona",
      messageBody: "I'm a creator",
      quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
    }),
    store,
    context,
  );
}

describe("Instagram DM reliability hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockSends() {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
  }

  it("does not consume a valid answer when the previous prompt is missing or failed", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await reachCreatorReason(store);
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");

    for (const message of store.messages) {
      if (
        message.direction === "outbound" &&
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason")
      ) {
        message.deliveryStatus = "failed";
        message.deliveryErrorCode = "http_5xx";
        message.nextAttemptAt = new Date(Date.now() + 60_000).toISOString();
      }
    }

    const answered = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
      store,
      context,
    );
    expect(answered.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_creator_issue_category");
    expect(store.conversations[0]?.lastProcessedExternalMessageId).toBe("mid.existing");
    const issuePrompts = qrSend.mock.calls.filter(
      (call) => call[0]?.text === CREATOR_ISSUE_CATEGORY_TEXT,
    );
    expect(issuePrompts).toHaveLength(1);
  });

  it.each(["image", "video", "audio", "sticker", "share", "attachment"] as const)(
    "sends the text-only fallback once for %s and does not advance state",
    async (kind) => {
      mockSends();
      const qrSend = vi.mocked(instagramSend.sendInstagramQuickReplies);
      const store = createMemoryInstagramStore();
      await reachCreatorReason(store);
      const fallbackCallsBefore = qrSend.mock.calls.filter(
        (call) => call[0]?.text === INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
      ).length;
      const first = await ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: `mid.${kind}`,
          externalMessageId: `mid.${kind}`,
          messageType: "unsupported",
          messageBody: `[${kind}]`,
          unsupportedKind: kind,
        }),
        store,
        context,
      );
      expect(first.outcome).toBe("stored");
      expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");
      const fallbackCalls = qrSend.mock.calls.filter(
        (call) => call[0]?.text === INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
      );
      expect(fallbackCalls).toHaveLength(fallbackCallsBefore + 1);
      expect(fallbackCalls.at(-1)?.[0]?.quickReplies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ payload: FLOW_BACK_PAYLOAD }),
        ]),
      );

      const duplicate = await ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: `mid.${kind}`,
          externalMessageId: `mid.${kind}`,
          messageType: "unsupported",
          messageBody: `[${kind}]`,
          unsupportedKind: kind,
        }),
        store,
        context,
      );
      expect(duplicate.outcome).toBe("duplicate");
      expect(
        qrSend.mock.calls.filter(
          (call) => call[0]?.text === INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
        ),
      ).toHaveLength(fallbackCallsBefore + 1);
    },
  );

  it("does not immediately resend a timeout_unknown outbound on the same webhook retry", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies");
    qrSend
      .mockResolvedValueOnce({
        ok: true,
        metaMessageId: "mid.menu",
        recipientId: "12334",
      })
      .mockResolvedValue({
        ok: false,
        errorCode: "timeout_unknown",
        retryable: false,
        messagingWindowExpired: false,
        deliveryUnknown: true,
        httpStatus: null,
      });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const timedOut = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(timedOut.outcome).toBe("stored");
    const reason = store.messages.find(
      (message) =>
        message.direction === "outbound" &&
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason"),
    );
    expect(reason?.deliveryStatus).toBe("pending");
    expect(reason?.deliveryErrorCode).toBe("timeout_unknown");
    expect(reason?.nextAttemptAt).toBeTruthy();
    const sendsBeforeRetry = qrSend.mock.calls.length;

    const retried = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(retried.outcome).toBe("duplicate");
    expect(qrSend.mock.calls.length).toBe(sendsBeforeRetry);
    expect(reason?.deliveryStatus).toBe("pending");
  });

  it("correlates an echo with a pending timeout_unknown outbound as sent", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies")
      .mockResolvedValueOnce({
        ok: true,
        metaMessageId: "mid.menu",
        recipientId: "12334",
      })
      .mockResolvedValue({
        ok: false,
        errorCode: "timeout_unknown",
        retryable: false,
        messagingWindowExpired: false,
        deliveryUnknown: true,
        httpStatus: null,
      });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    const reason = store.messages.find(
      (message) =>
        message.direction === "outbound" &&
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason"),
    );
    expect(reason?.deliveryStatus).toBe("pending");

    const echoed = await ingestInstagramEcho(
      {
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        externalEventId: "echo:mid.echo.reason",
        externalMessageId: "mid.echo.reason",
        externalConversationId: "12334",
        recipientId: "12334",
        senderId: "17841400008460000",
        messageBody: String(reason?.messageBody ?? ""),
        timestamp: "2020-10-18T22:13:26.000Z",
        isEcho: true,
        isSelf: false,
        eventFragment: { messaging_product: "instagram", type: "echo", hasId: true, hasAttachments: false },
      },
      store,
      context,
    );
    expect(echoed.outcome).toBe("stored");
    expect(reason?.deliveryStatus).toBe("sent");
    expect(reason?.externalMessageId).toBe("mid.echo.reason");
    expect(reason?.deliveryErrorCode).toBeNull();
  });

  it("does not keep retrying Meta after a terminal Graph error", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies");
    qrSend
      .mockResolvedValueOnce({
        ok: true,
        metaMessageId: "mid.menu",
        recipientId: "12334",
      })
      .mockResolvedValue({
        ok: false,
        errorCode: "http_401",
        retryable: false,
        messagingWindowExpired: false,
        deliveryUnknown: false,
        httpStatus: 401,
      });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const first = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(first.outcome).toBe("stored");
    const outbound = store.messages.find(
      (message) =>
        message.direction === "outbound" &&
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason"),
    );
    expect(outbound?.deliveryStatus).toBe("failed");
    expect(outbound?.deliveryErrorCode).toBe("http_401");

    const retried = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(retried.outcome).toBe("duplicate");
    expect(
      qrSend.mock.calls.filter((call) => call[0]?.text === CREATOR_REASON_TEXT),
    ).toHaveLength(1);
  });

  it("recovers a pending outbound without another creator DM", async () => {
    mockSends();
    vi.spyOn(afterResponse, "scheduleAfterResponse").mockResolvedValue(undefined);
    const store = createMemoryInstagramStore();
    const reserved = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
    );
    expect(reserved.outcome).toBe("stored");
    const pending = store.messages.filter((message) => message.direction === "outbound");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.deliveryStatus).toBe("pending");

    await drainInstagramOutbox({
      store,
      recipientId: "12334",
      conversationId: String(store.conversations[0]?.id),
    });
    expect(pending[0]?.deliveryStatus).toBe("sent");
  });

  it("recovers persona buttons after after() is skipped via scheduled drain", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    vi.spyOn(afterResponse, "scheduleAfterResponse").mockResolvedValue(undefined);
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    const pending = store.messages.find((message) => message.direction === "outbound");
    expect(pending?.deliveryStatus).toBe("pending");
    expect(pending?.rawPayload).toMatchObject({
      text: personaWelcomeText(null),
      quick_replies: personaQuickReplies(),
    });
    expect(JSON.stringify(pending?.rawPayload)).not.toContain("Authorization");
    expect(JSON.stringify(pending?.rawPayload)).not.toContain("access_token");
    expect(qrSend).not.toHaveBeenCalled();

    await drainDueInstagramOutbox({ store });
    expect(qrSend).toHaveBeenCalledTimes(1);
    expect(qrSend.mock.calls[0]?.[0]?.quickReplies).toEqual(personaQuickReplies());
    expect(qrSend.mock.calls[0]?.[0]?.text).toBe(personaWelcomeText(null));
    expect(pending?.deliveryStatus).toBe("sent");
  });

  it("creates one ticket for two simultaneous confirmations", async () => {
    mockSends();
    const store = createMemoryInstagramStore();
    await reachCreatorReason(store);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.issue-cat",
        externalMessageId: "mid.issue-cat",
        messageBody: "Campaign issue",
        quickReplyPayload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Acme, August 2026, riya@example.com",
      }),
      store,
      context,
    );

    const [first, second] = await Promise.all([
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.month.yes.a",
          externalMessageId: "mid.month.yes.a",
          messageBody: "Yes",
          quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
        }),
        store,
        context,
      ),
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.month.yes.b",
          externalMessageId: "mid.month.yes.b",
          messageBody: "Yes",
          quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
        }),
        store,
        context,
      ),
    ]);
    expect(first.outcome).toBe("stored");
    expect(second.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    const raised = store.messages.filter(
      (message) =>
        message.direction === "outbound" &&
        String(message.messageBody ?? "").includes("your ticket is raised"),
    );
    expect(raised).toHaveLength(1);
  });

  it("does not claim a second ticket after the active-ticket menu path", async () => {
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await reachCreatorReason(store);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.issue-cat",
        externalMessageId: "mid.issue-cat",
        messageBody: "Campaign issue",
        quickReplyPayload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Acme, August 2026, riya@example.com",
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.month.yes",
        externalMessageId: "mid.month.yes",
        messageBody: "Yes",
        quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
      store,
      context,
    );
    expect(store.tickets).toHaveLength(1);
    const ticketCode = String(store.tickets[0]?.ticketCode);

    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.menu",
        externalMessageId: "mid.menu",
        messageBody: "menu",
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona2",
        externalMessageId: "mid.persona2",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.existing2",
        externalMessageId: "mid.existing2",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
      store,
      context,
    );
    const attach = qrSend.mock.calls
      .map((call) => call[0]?.text)
      .filter(
        (text): text is string =>
          typeof text === "string" && text.includes(activeTicketAttachText(ticketCode)),
      );
    expect(attach.length).toBeGreaterThan(0);
    expect(store.tickets).toHaveLength(1);
  });

  it("recovers a live stuck awaiting_route conversation to the persona menu", async () => {
    mockSends();
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-legacy",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      state: "awaiting_route",
      routingIntent: "unclassified",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.old",
      intakeSessionVersion: 1,
    });
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.unstick",
        externalMessageId: "mid.unstick",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(
      (store.conversations[0]?.collectedData as { igPersona?: string | null } | undefined)
        ?.igPersona ?? null,
    ).toBeNull();
  });

  it("processes three rapid inbound messages without dropping later answers", async () => {
    mockSends();
    const store = createMemoryInstagramStore();
    const results = await Promise.all([
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.rapid.1",
          externalMessageId: "mid.rapid.1",
          messageBody: "Hi",
        }),
        store,
        context,
      ),
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.rapid.2",
          externalMessageId: "mid.rapid.2",
          messageBody: "I'm a creator",
          quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
        }),
        store,
        context,
      ),
      ingestInstagramInboundMessage(
        sampleInstagramEvent({
          externalEventId: "mid.rapid.3",
          externalMessageId: "mid.rapid.3",
          messageBody: "Existing campaign",
          quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
        }),
        store,
        context,
      ),
    ]);
    expect(results.every((result) => result.outcome === "stored")).toBe(true);
    expect(store.conversations[0]?.lastProcessedExternalMessageId).toMatch(
      /^mid\.rapid\.[123]$/,
    );
    expect(
      ["awaiting_persona", "awaiting_creator_reason", "awaiting_creator_issue_category"],
    ).toContain(store.conversations[0]?.state);
  });
});

describe("mapIntakeToInstagramTicketInsert", () => {
  it("stores collected fields without fake placeholders", () => {
    const insert = mapIntakeToInstagramTicketInsert({
      collected: emptyIntakeCollected({
        creatorName: "Riya Sharma",
        email: "riya@example.com",
        phoneNormalized: "+919876543210",
        phoneDisplay: "9876543210",
        platform: "youtube",
        socialHandle: "riya_creates",
        campaignName: "Summer Drop",
        brandName: "Acme",
        campaignMonth: "2026-08-01",
        originalInboundText: "Need help with a campaign",
      }),
      externalContactId: "12334",
      externalConversationId: "12334",
    });
    expect(insert.source_channel).toBe("instagram");
    expect(insert.status).toBe("open");
    expect(insert.priority).toBe("normal");
    expect(insert.assigned_team).toBe("Creator Support");
    expect(insert.platform).toBe("youtube");
    expect(insert.social_handle).toBe("riya_creates");
    expect(insert.issue_type).toBeNull();
    expect(insert.cloutflow_poc_name).toBeNull();
    expect(insert.issue_description).toBe("Need help with a campaign");
    expect(insert.creator_email).toBe("riya@example.com");
    expect(JSON.stringify(insert)).not.toMatch(/Not applicable|Unknown Creator|N\/A|placeholder/i);
  });

  it("maps creator campaign/payment issues onto compatible issue types without fake placeholders", () => {
    const payment = mapIntakeToInstagramTicketInsert({
      collected: emptyIntakeCollected({
        email: "riya@example.com",
        campaignName: "Summer Drop",
        brandName: "Acme",
        campaignMonth: "2026-08-01",
        issueDescription: "Payment is still pending",
        igPersona: "creator",
        igIssueCategory: "payment",
        issueType: "payment_delayed",
        cachedUsername: "riya_creates",
      }),
      externalContactId: "12334",
      externalConversationId: "12334",
    });
    expect(payment.issue_type).toBe("payment_delayed");
    expect(payment.issue_description).toBe("Payment is still pending");
    expect(payment.assigned_team).toBe("Creator Support");
    expect(payment.metadata.route).toBe("creator_payment_issue");
    expect(JSON.stringify(payment)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);

    const campaign = mapIntakeToInstagramTicketInsert({
      collected: emptyIntakeCollected({
        email: "riya@example.com",
        campaignName: "Summer Drop",
        brandName: "Acme",
        campaignMonth: "2026-08-01",
        issueDescription: "The brief changed",
        igPersona: "creator",
        igIssueCategory: "campaign",
        issueType: "other",
      }),
      externalContactId: "12334",
      externalConversationId: "12334",
    });
    expect(campaign.issue_type).toBe("other");
    expect(campaign.metadata.route).toBe("creator_campaign_issue");
  });
});

const IG_GRAPH_ENV = {
  META_GRAPH_API_VERSION: "v23.0",
  META_IG_ACCESS_TOKEN: "token",
  META_IG_ACCOUNT_ID: "17841400008460000",
};

function senderActionCallsFromFetch(
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
) {
  return fetchImpl.mock.calls
    .filter((call) => String(call[0]).includes("/me/messages"))
    .map((call) => JSON.parse(String(call[1]?.body)));
}

describe("Instagram sender actions and fast replies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows mark_seen and typing_on for the creator IGSID before Graph send completes", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.method ?? "POST") === "GET" || String(_url).includes("fields=username")) {
        return new Response(JSON.stringify({ username: "riya_creates" }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.sender_action === "typing_on") {
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push("typing_on");
      } else if (body.sender_action) {
        order.push(String(body.sender_action));
      }
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockImplementation(async () => {
      order.push("graph_send");
      return { ok: true, metaMessageId: "mid.prompt", recipientId: "12334" };
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context, {
      sendDeps: { env: IG_GRAPH_ENV, fetchImpl },
    });
    const actions = senderActionCallsFromFetch(fetchImpl);
    expect(actions.map((body) => body.sender_action)).toEqual(
      expect.arrayContaining(["mark_seen", "typing_on", "typing_off"]),
    );
    for (const body of actions) {
      expect(body.recipient).toEqual({ id: "12334" });
      expect(body).not.toHaveProperty("message");
    }
    expect(order.filter((item) => item === "graph_send")).toHaveLength(1);
    expect(order.at(-1)).toBe("typing_off");
    if (order.includes("typing_on")) {
      expect(order.indexOf("graph_send")).toBeLessThan(order.indexOf("typing_on"));
    }
    expect(store.messages.every((message) => !String(message.purpose ?? "").includes("typing"))).toBe(
      true,
    );
  });

  it("sends typing_off after a Graph send failure", async () => {
    const actions: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(_url).includes("fields=username")) {
        return new Response("{}", { status: 403 });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.sender_action) actions.push(String(body.sender_action));
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: false,
      errorCode: "http_5xx",
      retryable: true,
      messagingWindowExpired: false,
      deliveryUnknown: false,
      httpStatus: 500,
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context, {
      sendDeps: { env: IG_GRAPH_ENV, fetchImpl },
    });
    expect(actions).toContain("typing_on");
    expect(actions.at(-1)).toBe("typing_off");
  });

  it("does not let a sender-action timeout delay or fail the chatbot message", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("fields=username")) {
        return new Response("{}", { status: 403 });
      }
      if (String(url).includes("/me/messages")) {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return new Response("{}", { status: 200 });
    });
    let sentAt = 0;
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockImplementation(async () => {
      sentAt = Date.now();
      return { ok: true, metaMessageId: "mid.prompt", recipientId: "12334" };
    });
    const store = createMemoryInstagramStore();
    const started = Date.now();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    expect(result.outcome).toBe("stored");
    expect(sentAt - started).toBeLessThan(400);
    expect(
      store.messages.some(
        (message) =>
          message.direction === "outbound" && message.deliveryStatus === "sent",
      ),
    ).toBe(true);
  });

  it("does not fail ingestion when sender actions return 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/me/messages")) {
        return new Response("{}", { status: 401 });
      }
      return new Response("{}", { status: 403 });
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    expect(result.outcome).toBe("stored");
  });

  it("does not repeat typing on a duplicate webhook after the outbound is sent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("fields=username")) {
        return new Response("{}", { status: 403 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const event = sampleInstagramEvent();
    await ingestInstagramInboundMessage(event, store, context, {
      sendDeps: { env: IG_GRAPH_ENV, fetchImpl },
    });
    const typingOnAfterFirst = senderActionCallsFromFetch(fetchImpl).filter(
      (body) => body.sender_action === "typing_on",
    ).length;
    await ingestInstagramInboundMessage(event, store, context, {
      sendDeps: { env: IG_GRAPH_ENV, fetchImpl },
    });
    const typingOnAfterSecond = senderActionCallsFromFetch(fetchImpl).filter(
      (body) => body.sender_action === "typing_on",
    ).length;
    expect(typingOnAfterFirst).toBe(1);
    expect(typingOnAfterSecond).toBe(1);
  });

  it("does not show typing for an active-ticket silent follow-up", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.tickets.push({
      id: "ticket-open",
      status: "open",
      sourceChannel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      ticketCode: "CF-2026-00001",
    });
    store.conversations.push({
      id: "convo-1",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      state: "ticket_open",
      ticketId: "ticket-open",
      routingIntent: "creator_support",
      displayName: "riya_creates",
      collectedData: { cachedUsername: "riya_creates" },
      lastProcessedExternalMessageId: "mid.previous",
      intakeSessionVersion: 1,
    });
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.follow",
        externalMessageId: "mid.follow",
        messageBody: "Following up",
      }),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    expect(senderActionCallsFromFetch(fetchImpl)).toHaveLength(0);
    expect(instagramSend.sendInstagramText).not.toHaveBeenCalled();
  });

  it("shows typing for unsupported media fallback", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context, {
      sendDeps: { env: IG_GRAPH_ENV, fetchImpl },
    });
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.image",
        externalMessageId: "mid.image",
        messageType: "unsupported",
        messageBody: "[image]",
        unsupportedKind: "image",
      }),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    const typingOn = senderActionCallsFromFetch(fetchImpl).filter(
      (body) => body.sender_action === "typing_on",
    );
    expect(typingOn.length).toBeGreaterThanOrEqual(2);
    expect(
      store.messages.some(
        (message) =>
          message.direction === "outbound" &&
          message.messageBody === INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
      ),
    ).toBe(true);
  });

  it("drains only newly reserved outbound IDs on the immediate after() path", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const listDue = vi.spyOn(store, "listDueInstagramOutbounds");
    const listDueBatch = vi.spyOn(store, "listDueInstagramOutboxBatch");
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    expect(listDue).not.toHaveBeenCalled();
    expect(listDueBatch).not.toHaveBeenCalled();
    expect(
      store.messages.filter((message) => message.direction === "outbound"),
    ).toHaveLength(1);
  });

  it("falls back to Hi there without waiting for a slow username lookup", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("fields=username")) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, INSTAGRAM_USERNAME_LOOKUP_TIMEOUT_MS + 2000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return new Response(JSON.stringify({ username: "riya_creates" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(afterResponse, "scheduleAfterResponse").mockResolvedValue(undefined);
    const store = createMemoryInstagramStore();
    const started = Date.now();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({ displayName: null, senderName: null }),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    expect(result.outcome).toBe("stored");
    expect(Date.now() - started).toBeLessThan(500);
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    const pending = store.messages.find((message) => message.direction === "outbound");
    expect(pending?.messageBody).toBe(personaWelcomeText(null));
  });

  it("uses a cached conversation display_name and skips Graph username lookup", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(init?.method) === "GET" || String(url).includes("fields=username")) {
        throw new Error("username lookup should not run");
      }
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-cached",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
      displayName: "riya_creates",
      state: "unclassified",
      collectedData: { cachedUsername: "riya_creates" },
      lastProcessedExternalMessageId: null,
      intakeSessionVersion: 0,
    });
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context, {
      sendDeps: { env: IG_GRAPH_ENV, fetchImpl },
    });
    expect(fetchImpl.mock.calls.every((call) => !String(call[0]).includes("fields=username"))).toBe(
      true,
    );
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledWith(
      expect.objectContaining({ text: personaWelcomeText("riya_creates") }),
    );
  });

  it("keeps the webhook critical path fast when after() is deferred", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { ok: true, metaMessageId: "mid.prompt", recipientId: "12334" };
    });
    vi.spyOn(afterResponse, "scheduleAfterResponse").mockResolvedValue(undefined);
    const store = createMemoryInstagramStore();
    const started = Date.now();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(Date.now() - started).toBeLessThan(500);
    expect(
      store.messages.find((message) => message.direction === "outbound")?.deliveryStatus,
    ).toBe("pending");
  });

  it("still uses the durable outbox lease to prevent concurrent Graph sends", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, metaMessageId: "mid.out", recipientId: "12334" };
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const outbound = store.messages.find((message) => message.direction === "outbound");
    expect(outbound?.deliveryStatus).toBe("sent");
    outbound!.deliveryStatus = "pending";
    outbound!.outboundClaimed = false;
    outbound!.deliveryAttemptCount = 1;
    outbound!.nextAttemptAt = new Date(Date.now() + 60_000).toISOString();
    send.mockClear();
    await Promise.all([
      drainInstagramOutbox({
        store,
        recipientId: "12334",
        conversationId: String(store.conversations[0]?.id),
      }),
      drainInstagramOutbox({
        store,
        recipientId: "12334",
        conversationId: String(store.conversations[0]?.id),
      }),
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not add 1.5s to the webhook path on early reservation failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/me/messages")) {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return new Response("{}", { status: 403 });
    });
    const afterTasks: Array<() => Promise<void>> = [];
    vi.spyOn(afterResponse, "scheduleAfterResponse").mockImplementation(async (task) => {
      afterTasks.push(task);
    });
    const store = createMemoryInstagramStore();
    store.reserveOutboundAndSnapshot = async () => ({
      outcome: "failed",
      errorCode: "outbound_address_invalid",
    });
    const started = Date.now();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    expect(result.outcome).toBe("failed");
    expect(Date.now() - started).toBeLessThan(500);
    expect(afterTasks.length).toBeGreaterThan(0);
    await Promise.all(afterTasks.map((task) => task()));
    const typingOff = senderActionCallsFromFetch(fetchImpl).filter(
      (body) => body.sender_action === "typing_off",
    );
    expect(typingOff).toHaveLength(1);
  });

  it("lets the after() callback own unfinished sender-action promises", async () => {
    const pendingResolvers: Array<() => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("fields=username")) {
        return new Response("{}", { status: 403 });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.sender_action === "mark_seen" || body.sender_action === "typing_on") {
        await new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        });
      }
      return new Response("{}", { status: 200 });
    });
    const afterTasks: Array<() => Promise<void>> = [];
    vi.spyOn(afterResponse, "scheduleAfterResponse").mockImplementation(async (task) => {
      afterTasks.push(task);
    });
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
      { sendDeps: { env: IG_GRAPH_ENV, fetchImpl } },
    );
    expect(result.outcome).toBe("stored");
    expect(afterTasks.length).toBeGreaterThan(0);
    expect(
      senderActionCallsFromFetch(fetchImpl).filter(
        (body) => body.sender_action === "typing_off",
      ),
    ).toHaveLength(0);
    for (const resolve of pendingResolvers) resolve();
    await Promise.all(afterTasks.map((task) => task()));
    expect(
      senderActionCallsFromFetch(fetchImpl).filter(
        (body) => body.sender_action === "typing_off",
      ),
    ).toHaveLength(1);
  });

  it("FLOW_BACK revisits a prior prompt with a navigation key and ignores webhook retries", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({ messageBody: "Need help with a campaign" }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: "I'm a creator",
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
      store,
      context,
    );
    const conversationId = String(store.conversations[0]?.id);
    const version = Number(store.conversations[0]?.intakeSessionVersion ?? 0);
    const originalReasonKey = chatbotOutboundIdempotencyKey(
      conversationId,
      version,
      "awaiting_creator_reason",
    );
    expect(
      store.messages.some((message) => message.idempotencyKey === originalReasonKey),
    ).toBe(true);

    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.flow.back",
        externalMessageId: "mid.flow.back",
        messageBody: "Go back",
        quickReplyPayload: FLOW_BACK_PAYLOAD,
      }),
      store,
      context,
    );
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(Number(store.conversations[0]?.intakeSessionVersion ?? 0)).toBe(version);
    expect(store.tickets).toHaveLength(0);
    expect(store.emails).toHaveLength(0);
    const backKey = chatbotOutboundIdempotencyKey(
      conversationId,
      version,
      personaBackPromptKey("awaiting_persona", "mid.flow.back"),
    );
    expect(backKey).toBe(
      `ig:prompt:${conversationId}:v${version}:awaiting_persona:back:mid.flow.back`,
    );
    expect(
      store.messages.filter((message) => message.idempotencyKey === backKey),
    ).toHaveLength(1);
    expect(
      store.messages.filter((message) => message.idempotencyKey === originalReasonKey),
    ).toHaveLength(1);

    const duplicate = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.flow.back",
        externalMessageId: "mid.flow.back",
        messageBody: "Go back",
        quickReplyPayload: FLOW_BACK_PAYLOAD,
      }),
      store,
      context,
    );
    expect(duplicate.outcome).toBe("duplicate");
    expect(
      store.messages.filter((message) => message.idempotencyKey === backKey),
    ).toHaveLength(1);
    expect(store.conversations[0]?.state).toBe("awaiting_persona");
    expect(Number(store.conversations[0]?.intakeSessionVersion ?? 0)).toBe(version);
  });
});

describe("Instagram ingest first-delivery conversation persistence", () => {
  async function sendOnce(
    store: ReturnType<typeof createMemoryInstagramStore>,
    event: NormalizedMetaInboundText,
  ) {
    const outboundBefore = store.messages.filter(
      (message) => message.direction === "outbound",
    ).length;
    const result = await ingestInstagramInboundMessage(event, store, context);
    expect(result.outcome).toBe("stored");
    const snapshot = await reloadConversationSnapshot(
      store,
      "instagram",
      event.externalConversationId,
      identityLookupFromEvent(event),
    );
    expect(snapshot.lastProcessedExternalMessageId).toBe(event.externalMessageId);
    const webhook = store.events.find(
      (row) => row.externalEventId === event.externalEventId,
    );
    expect(webhook?.processingStatus).toBe("completed");
    const outboundAfter = store.messages.filter(
      (message) => message.direction === "outbound",
    );
    return {
      snapshot,
      newOutboundCount: outboundAfter.length - outboundBefore,
      outboundAfter,
    };
  }

  function mockSends() {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
  }

  async function playCreatorPaymentFlow(
    store: ReturnType<typeof createMemoryInstagramStore>,
    reply: (
      mid: string,
      text: string,
      payload?: string | null,
    ) => NormalizedMetaInboundText,
  ) {
    const hi = await sendOnce(store, reply("mid.hi", "Hi"));
    expect(hi.snapshot.state).toBe("awaiting_persona");
    expect(hi.newOutboundCount).toBe(1);

    const persona = await sendOnce(
      store,
      reply("mid.persona", PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD),
    );
    expect(persona.snapshot.state).toBe("awaiting_creator_reason");
    expect(persona.snapshot.collected.igPersona).toBe("creator");
    expect(persona.newOutboundCount).toBe(1);

    const existing = await sendOnce(
      store,
      reply("mid.existing", "Existing campaign", CREATOR_EXISTING_CAMPAIGN_PAYLOAD),
    );
    expect(existing.snapshot.state).toBe("awaiting_creator_issue_category");
    expect(existing.newOutboundCount).toBe(1);

    const payment = await sendOnce(
      store,
      reply("mid.payment", "Payment issue", CREATOR_PAYMENT_ISSUE_PAYLOAD),
    );
    expect(payment.snapshot.state).toBe("creator_campaign_details");
    expect(payment.snapshot.collected.igIssueCategory).toBe("payment");
    expect(payment.newOutboundCount).toBe(1);

    const campaign = await sendOnce(
      store,
      reply("mid.campaign", "Acme, August 2026, riya@example.com"),
    );
    expect(campaign.snapshot.state).toBe("awaiting_month_confirmation");
    expect(campaign.snapshot.collected.brandName).toBe("Acme");
    expect(campaign.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(campaign.snapshot.collected.email).toBe("riya@example.com");
    expect(campaign.snapshot.collected.campaignMonthConfirmed).toBe(false);
    expect(campaign.newOutboundCount).toBe(1);

    const yes = await sendOnce(
      store,
      reply("mid.month.yes", "Yes", CAMPAIGN_MONTH_YES_PAYLOAD),
    );
    expect(yes.snapshot.state).toBe("awaiting_post_completion");
    expect(yes.snapshot.collected.campaignMonthConfirmed).toBe(true);
    expect(yes.newOutboundCount).toBeGreaterThanOrEqual(1);
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.campaign_name).toBeNull();
    expect(store.tickets[0]?.brand_name).toBe("Acme");
    expect(store.tickets[0]?.campaign_month).toBe("2026-08-01");
    expect(store.tickets[0]?.creator_email).toBe("riya@example.com");
  }

  it("accepts every Instagram text reply on first delivery and reloads persisted state", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await playCreatorPaymentFlow(store, (mid, text, payload = null) =>
      sampleInstagramEvent({
        externalEventId: mid,
        externalMessageId: mid,
        messageBody: text,
        quickReplyPayload: payload,
      }),
    );
  });

  it("accepts Instagram quick-reply payload+title on first webhook delivery", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await playCreatorPaymentFlow(store, (mid, text, payload = null) => {
      const events = normalizeMetaWebhookPayload(
        instagramTextPayload({
          senderId: "12334",
          mid,
          text,
          quickReplyPayload: payload ?? undefined,
        }),
      );
      expect(events).toHaveLength(1);
      return events[0]!;
    });
  });

  it("accepts an Instagram postback title/payload on first delivery", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.hi",
        externalMessageId: "mid.hi",
        messageBody: "Hi",
      }),
    );
    const events = normalizeMetaWebhookPayload(
      instagramPostbackPayload({
        mid: "mid.persona.postback",
        title: PERSONA_CREATOR_TITLE,
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    expect(events).toHaveLength(1);
    const persona = await sendOnce(store, events[0]!);
    expect(persona.snapshot.state).toBe("awaiting_creator_reason");
    expect(persona.snapshot.collected.igPersona).toBe("creator");
    expect(persona.newOutboundCount).toBe(1);
  });

  it("accepts No → corrected month → Yes with each reply sent once", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await sendOnce(store, sampleInstagramEvent({ messageBody: "Hi" }));
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.issue",
        externalMessageId: "mid.issue",
        messageBody: "Campaign issue",
        quickReplyPayload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
    );
    const campaign = await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Acme, August 2026, riya@example.com",
      }),
    );
    expect(campaign.snapshot.state).toBe("awaiting_month_confirmation");

    const no = await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.month.no",
        externalMessageId: "mid.month.no",
        messageBody: "No",
        quickReplyPayload: CAMPAIGN_MONTH_NO_PAYLOAD,
      }),
    );
    expect(no.snapshot.state).toBe("creator_campaign_details");
    expect(no.snapshot.collected.campaignMonth).toBeNull();
    expect(no.newOutboundCount).toBe(1);

    const corrected = await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.campaign.2",
        externalMessageId: "mid.campaign.2",
        messageBody: "July 2026",
      }),
    );
    expect(corrected.snapshot.state).toBe("awaiting_month_confirmation");
    expect(corrected.snapshot.collected.campaignMonth).toBe("2026-07-01");
    expect(corrected.snapshot.collected.brandName).toBe("Acme");
    expect(corrected.newOutboundCount).toBe(1);

    const yes = await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.month.yes",
        externalMessageId: "mid.month.yes",
        messageBody: "Yes",
        quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    expect(yes.snapshot.state).toBe("awaiting_post_completion");
    expect(yes.snapshot.collected.campaignMonthConfirmed).toBe(true);
    expect(yes.newOutboundCount).toBeGreaterThanOrEqual(1);
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.campaign_name).toBeNull();
    expect(corrected.snapshot.lastPromptKey).not.toBe(campaign.snapshot.lastPromptKey);
  });

  it("ignores a webhook retry of the same external event without a second copy of the text", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    const first = sampleInstagramEvent({ messageBody: "Hi" });
    await sendOnce(store, first);
    const retry = await ingestInstagramInboundMessage(first, store, context);
    expect(retry.outcome).toBe("duplicate");
    const snapshot = await reloadConversationSnapshot(
      store,
      "instagram",
      "12334",
      SAMPLE_IG_LOOKUP,
    );
    expect(snapshot.state).toBe("awaiting_persona");
    expect(
      store.messages.filter((message) => message.direction === "outbound"),
    ).toHaveLength(1);
  });

  it("does not let an echo callback move conversation state", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await sendOnce(store, sampleInstagramEvent({ messageBody: "Hi" }));
    const before = await reloadConversationSnapshot(store, "instagram", "12334", SAMPLE_IG_LOOKUP);
    await ingestInstagramEcho(
      {
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        externalEventId: "echo:mid.prompt",
        externalMessageId: "mid.prompt",
        externalConversationId: "12334",
        recipientId: "12334",
        senderId: "17841400008460000",
        messageBody: personaWelcomeText(null),
        timestamp: "2020-10-18T22:13:27.000Z",
        isEcho: true,
        isSelf: false,
        eventFragment: { messaging_product: "instagram", type: "echo", hasId: true },
      },
      store,
      context,
    );
    const after = await reloadConversationSnapshot(store, "instagram", "12334", SAMPLE_IG_LOOKUP);
    expect(after.state).toBe(before.state);
    expect(after.lastProcessedExternalMessageId).toBe(
      before.lastProcessedExternalMessageId,
    );
    expect(store.tickets).toHaveLength(0);
  });

  it("does not let an echo callback advance month confirmation", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await sendOnce(store, sampleInstagramEvent({ messageBody: "Hi" }));
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.payment",
        externalMessageId: "mid.payment",
        messageBody: "Payment issue",
        quickReplyPayload: CREATOR_PAYMENT_ISSUE_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Acme, August 2026, riya@example.com",
      }),
    );
    const before = await reloadConversationSnapshot(
      store,
      "instagram",
      "12334",
      SAMPLE_IG_LOOKUP,
    );
    expect(before.state).toBe("awaiting_month_confirmation");
    const outboundBefore = store.messages.filter(
      (message) => message.direction === "outbound",
    ).length;
    await ingestInstagramEcho(
      {
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        externalEventId: "echo:mid.month.prompt",
        externalMessageId: "mid.prompt",
        externalConversationId: "12334",
        recipientId: "12334",
        senderId: "17841400008460000",
        messageBody: "I understood the campaign month as August 2026. Is that correct?",
        timestamp: "2020-10-18T22:13:27.000Z",
        isEcho: true,
        isSelf: false,
        eventFragment: { messaging_product: "instagram", type: "echo", hasId: true },
      },
      store,
      context,
    );
    const after = await reloadConversationSnapshot(
      store,
      "instagram",
      "12334",
      SAMPLE_IG_LOOKUP,
    );
    expect(after.state).toBe("awaiting_month_confirmation");
    expect(after.lastProcessedExternalMessageId).toBe(
      before.lastProcessedExternalMessageId,
    );
    expect(store.tickets).toHaveLength(0);
    expect(
      store.messages.filter((message) => message.direction === "outbound"),
    ).toHaveLength(outboundBefore);
  });

  it("creates the ticket from an Instagram postback Yes on first delivery", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryInstagramStore());
    await sendOnce(store, sampleInstagramEvent({ messageBody: "Hi" }));
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.persona",
        externalMessageId: "mid.persona",
        messageBody: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.existing",
        externalMessageId: "mid.existing",
        messageBody: "Existing campaign",
        quickReplyPayload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.payment",
        externalMessageId: "mid.payment",
        messageBody: "Payment issue",
        quickReplyPayload: CREATOR_PAYMENT_ISSUE_PAYLOAD,
      }),
    );
    await sendOnce(
      store,
      sampleInstagramEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Acme, August 2026, riya@example.com",
      }),
    );
    const events = normalizeMetaWebhookPayload(
      instagramPostbackPayload({
        mid: "mid.month.yes.postback",
        title: "Yes",
        payload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    expect(events).toHaveLength(1);
    const yes = await sendOnce(store, events[0]!);
    expect(yes.snapshot.state).toBe("awaiting_post_completion");
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.campaign_name).toBeNull();
    expect(yes.newOutboundCount).toBeGreaterThanOrEqual(1);
  });
});
