import { describe, expect, it } from "vitest";
import {
  META_WHATSAPP_PROVIDER,
  WEBHOOK_STATUS_COMPLETED,
  WEBHOOK_STATUS_FAILED,
} from "@/lib/meta/constants";
import { persistNormalizedInboundMessage } from "@/lib/meta/store";
import type { MetaInboundStore } from "@/lib/meta/store";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import { webhookProviderForChannel } from "@/lib/meta/types";

function sampleEvent(
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  return {
    channel: "whatsapp",
    provider: META_WHATSAPP_PROVIDER,
    externalEventId: "wamid.1",
    externalMessageId: "wamid.1",
    externalConversationId: "16315551181",
    externalContactId: "16315551181",
    displayName: "Riya",
    senderName: "Riya",
    senderAddress: "16315551181",
    messageType: "text",
    messageBody: "Hello",
    timestamp: "2020-10-18T22:13:26.000Z",
    phoneNumberId: "123456123",
    recipientAccountId: null,
    eventFragment: { messaging_product: "whatsapp" },
    ...overrides,
  };
}

function createMemoryStore(): MetaInboundStore & {
  events: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
} {
  const events: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  let ids = 0;
  const nextId = () => `id-${++ids}`;

  const store: MetaInboundStore & {
    events: typeof events;
    conversations: typeof conversations;
    messages: typeof messages;
  } = {
    events,
    conversations,
    messages,
    async claimWebhookEvent(input) {
      const existing = events.find(
        (row) =>
          row.provider === input.provider &&
          row.externalEventId === input.externalEventId,
      );
      if (existing) {
        if (
          existing.processingStatus === WEBHOOK_STATUS_COMPLETED ||
          existing.processingStatus === "processed"
        ) {
          return { outcome: "already_processed" };
        }
        existing.processingStatus = "processing";
        existing.errorCode = null;
        existing.errorMessage = null;
        return { outcome: "retry", id: existing.id as string };
      }
      const id = nextId();
      events.push({
        id,
        provider: input.provider,
        externalEventId: input.externalEventId,
        payload: input.payload,
        payloadHash: input.payloadHash,
        processingStatus: "processing",
        errorCode: null,
        errorMessage: null,
      });
      return { outcome: "claimed", id };
    },
    async markWebhookEvent(id, status, errorCode = null) {
      const row = events.find((event) => event.id === id);
      if (!row) return;
      row.processingStatus = status;
      row.errorCode = status === WEBHOOK_STATUS_FAILED ? errorCode : null;
      row.errorMessage = status === WEBHOOK_STATUS_FAILED ? errorCode : null;
    },
    async getConversation(channel, externalConversationId) {
      const row = conversations.find(
        (conversation) =>
          conversation.channel === channel &&
          conversation.externalConversationId === externalConversationId,
      );
      if (!row) return null;
      return {
        id: row.id as string,
        displayName: (row.displayName as string | null) ?? null,
      };
    },
    async insertConversation(input) {
      const duplicate = conversations.find(
        (conversation) =>
          conversation.channel === input.channel &&
          conversation.externalConversationId === input.externalConversationId,
      );
      if (duplicate) return { outcome: "duplicate" };
      const id = nextId();
      conversations.push({
        id,
        channel: input.channel,
        externalConversationId: input.externalConversationId,
        externalContactId: input.externalContactId,
        displayName: input.displayName,
        lastMessageAt: input.lastMessageAt,
        state: "new",
        collectedData: {},
        ticketId: null,
      });
      return { outcome: "inserted", id };
    },
    async updateConversation(id, patch) {
      const row = conversations.find((conversation) => conversation.id === id);
      if (!row) {
        return { outcome: "failed", errorCode: "conversation_update_failed" };
      }
      row.lastMessageAt = patch.lastMessageAt;
      const nextName = patch.displayName?.trim();
      if (nextName) {
        row.displayName = nextName;
      }
      return { outcome: "updated" };
    },
    async insertInboundMessage(input) {
      const duplicate = messages.find(
        (message) =>
          message.channel === input.channel &&
          message.externalMessageId === input.externalMessageId,
      );
      if (duplicate) return { outcome: "duplicate" };
      messages.push({
        id: nextId(),
        conversationId: input.conversationId,
        ticketId: null,
        channel: input.channel,
        direction: "inbound",
        externalMessageId: input.externalMessageId,
        senderName: input.senderName,
        senderAddress: input.senderAddress,
        messageBody: input.messageBody,
        messageType: "text",
        deliveryStatus: "received",
        rawPayload: input.eventFragment,
      });
      return { outcome: "inserted" };
    },
  };

  return store;
}

const persistContext = { webhookPayload: { object: "whatsapp_business_account" } };

describe("persistNormalizedInboundMessage", () => {
  it("creates a conversation and inbound message using applied schema fields", async () => {
    const store = createMemoryStore();
    const result = await persistNormalizedInboundMessage(
      sampleEvent(),
      store,
      persistContext,
    );
    expect(result).toEqual({ outcome: "stored" });
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]).toMatchObject({
      state: "new",
      collectedData: {},
      ticketId: null,
    });
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]).toMatchObject({
      ticketId: null,
      direction: "inbound",
      senderName: "Riya",
      senderAddress: "16315551181",
      messageBody: "Hello",
      deliveryStatus: "received",
    });
    expect(store.events[0]?.provider).toBe(META_WHATSAPP_PROVIDER);
    expect(store.events[0]?.processingStatus).toBe(WEBHOOK_STATUS_COMPLETED);
    expect(store.events[0]?.payload).toEqual(persistContext.webhookPayload);
    expect(store.messages[0]?.rawPayload).toEqual({
      messaging_product: "whatsapp",
    });
  });

  it("does not duplicate channel_messages for a repeated webhook event", async () => {
    const store = createMemoryStore();
    const event = sampleEvent();
    const first = await persistNormalizedInboundMessage(
      event,
      store,
      persistContext,
    );
    const second = await persistNormalizedInboundMessage(
      event,
      store,
      persistContext,
    );
    expect(first.outcome).toBe("stored");
    expect(second.outcome).toBe("duplicate");
    expect(store.messages).toHaveLength(1);
    expect(store.conversations).toHaveLength(1);
  });

  it("does not duplicate messages when the same external_message_id arrives again", async () => {
    const store = createMemoryStore();
    await persistNormalizedInboundMessage(sampleEvent(), store, persistContext);
    store.events[0]!.processingStatus = WEBHOOK_STATUS_FAILED;
    const retry = await persistNormalizedInboundMessage(
      sampleEvent(),
      store,
      persistContext,
    );
    expect(retry.outcome).toBe("duplicate");
    expect(store.messages).toHaveLength(1);
    expect(store.events[0]?.processingStatus).toBe(WEBHOOK_STATUS_COMPLETED);
  });

  it("preserves existing conversation state, ticket, and collected data", async () => {
    const store = createMemoryStore();
    store.conversations.push({
      id: "existing-convo",
      channel: "whatsapp",
      externalConversationId: "16315551181",
      externalContactId: "16315551181",
      displayName: "Old Name",
      lastMessageAt: "2020-10-18T21:00:00.000Z",
      state: "collecting_email",
      collectedData: { email: "riya@example.com" },
      ticketId: "ticket-uuid",
    });

    const result = await persistNormalizedInboundMessage(
      sampleEvent({ displayName: "Riya Sharma" }),
      store,
      persistContext,
    );

    expect(result.outcome).toBe("stored");
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]).toMatchObject({
      state: "collecting_email",
      collectedData: { email: "riya@example.com" },
      ticketId: "ticket-uuid",
      displayName: "Riya Sharma",
      lastMessageAt: "2020-10-18T22:13:26.000Z",
    });
  });

  it("does not overwrite display_name with an empty inbound name", async () => {
    const store = createMemoryStore();
    store.conversations.push({
      id: "existing-convo",
      channel: "whatsapp",
      externalConversationId: "16315551181",
      externalContactId: "16315551181",
      displayName: "Existing",
      lastMessageAt: "2020-10-18T21:00:00.000Z",
      state: "new",
      collectedData: {},
      ticketId: null,
    });

    await persistNormalizedInboundMessage(
      sampleEvent({ displayName: null, senderName: null }),
      store,
      persistContext,
    );

    expect(store.conversations[0]?.displayName).toBe("Existing");
  });

  it("marks the webhook event failed with a sanitized error code", async () => {
    const store = createMemoryStore();
    store.insertInboundMessage = async () => ({
      outcome: "failed",
      errorCode: "message_insert_failed",
    });
    const result = await persistNormalizedInboundMessage(
      sampleEvent({ messageBody: "secret payment details" }),
      store,
      persistContext,
    );
    expect(result).toEqual({
      outcome: "failed",
      errorCode: "message_insert_failed",
    });
    expect(store.events[0]?.processingStatus).toBe(WEBHOOK_STATUS_FAILED);
    expect(store.events[0]?.errorCode).toBe("message_insert_failed");
    expect(store.events[0]?.errorMessage).toBe("message_insert_failed");
    expect(JSON.stringify(store.events[0])).not.toContain("secret payment details");
  });

  it("maps channels onto applied Meta provider values", () => {
    expect(webhookProviderForChannel("whatsapp")).toBe(META_WHATSAPP_PROVIDER);
    expect(webhookProviderForChannel("instagram")).toBe("meta_instagram");
    expect(webhookProviderForChannel("whatsapp")).not.toBe("wati");
  });
});
