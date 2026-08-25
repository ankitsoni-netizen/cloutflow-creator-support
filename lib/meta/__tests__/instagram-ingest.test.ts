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
  CREATOR_REASON_TEXT,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  PERSONA_CREATOR_PAYLOAD,
  creatorTicketRaisedText,
  personaWelcomeText,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import { chatbotOutboundIdempotencyKey } from "@/lib/meta/prompt-keys";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import * as instagramSend from "@/lib/meta/instagram-send";

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
    async getConversation(channel: string, externalConversationId: string) {
      store.getConversationCalls += 1;
      const row = conversations.find(
        (conversation) =>
          conversation.channel === channel &&
          conversation.externalConversationId === externalConversationId,
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
    async updateConversation() {
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
    }) {
      store.findActiveCalls += 1;
      const row = tickets.find(
        (ticket) =>
          ticket.sourceChannel === "instagram" &&
          (ticket.externalConversationId === input.externalConversationId ||
            ticket.externalContactId === input.externalContactId) &&
          ["open", "in_progress", "waiting"].includes(String(ticket.status)),
      );
      if (!row) return null;
      return { id: row.id as string, status: String(row.status), ticketCode: row.ticketCode as string };
    },
    async insertInstagramTicket(row: Record<string, unknown>) {
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
      row.deliveryStatus = patch.deliveryStatus;
      if (patch.externalMessageId !== undefined) {
        row.externalMessageId = patch.externalMessageId;
      }
      row.deliveryErrorCode = patch.deliveryErrorCode ?? null;
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
        messages.push({ ...message });
      }
      return { outcome: "reserved" as const, outbounds: result.outbounds };
    },
    async claimEmailDelivery(input: Record<string, unknown>) {
      const duplicate = emails.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (duplicate) {
        return {
          outcome: "duplicate" as const,
          id: duplicate.id as string,
          deliveryStatus: String(duplicate.deliveryStatus ?? "pending"),
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
    expect(result.outcome).toBe("failed");
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
    const issue = "The film deliverable was rejected without a reason";
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
        messageBody: "Summer Drop, Acme, August 2026, riya@example.com",
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.details",
        externalMessageId: "mid.details",
        messageBody: issue,
      }),
      store,
      context,
    );
    const created = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.confirm",
        externalMessageId: "mid.confirm",
        messageBody: "Yes, raise it",
        quickReplyPayload: CREATOR_TICKET_CONFIRM_PAYLOAD,
      }),
      store,
      context,
    );
    expect(created.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.issue_description).toBe(issue);
    expect(store.tickets[0]?.issue_type).toBe("other");
    expect(store.tickets[0]?.creator_email).toBe("riya@example.com");
    expect(store.tickets[0]?.campaign_name).toBe("Summer Drop");
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
        externalEventId: "mid.confirm",
        externalMessageId: "mid.confirm",
        messageBody: "Yes, raise it",
        quickReplyPayload: CREATOR_TICKET_CONFIRM_PAYLOAD,
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
    const recoveredKey = chatbotOutboundIdempotencyKey(
      "convo-stuck",
      1,
      "awaiting_creator_reason",
    );
    expect(
      store.messages.some(
        (message) =>
          message.idempotencyKey === recoveredKey &&
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
    expect(failed.outcome).toBe("failed");
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");

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
      qrSend.mock.calls.some((call) => call[0]?.text === CREATOR_REASON_TEXT),
    ).toBe(true);
    const reasonOutbounds = store.messages.filter(
      (message) =>
        message.direction === "outbound" &&
        String(message.idempotencyKey ?? "").includes("awaiting_creator_reason"),
    );
    expect(reasonOutbounds).toHaveLength(1);
    expect(reasonOutbounds[0]?.deliveryStatus).toBe("sent");
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
