import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { META_WHATSAPP_PROVIDER } from "@/lib/meta/constants";
import {
  ingestWhatsAppInboundMessage,
  ingestWhatsAppStatus,
} from "@/lib/meta/whatsapp-ingest";
import { processWhatsAppVerifiedPayload } from "@/lib/meta/whatsapp-webhook";
import { whatsappStatusPayload, whatsappTextPayload } from "@/lib/meta/__tests__/fixtures";
import * as instagramTicketMail from "@/lib/email/instagram-ticket-mail";
import type { DbTicket } from "@/lib/tickets/types";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import {
  PLATFORM_DETAILS_PROMPT_TEXT,
  WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT,
  WHATSAPP_ROUTING_QUESTION_TEXT,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  ticketCreatedWithEmailText,
  ticketCreatedWithoutEmailText,
} from "@/lib/meta/routing-copy";
import {
  chatbotOutboundIdempotencyKey,
  intakeEffectType,
} from "@/lib/meta/prompt-keys";
import type { NormalizedMetaInboundText, NormalizedWhatsAppStatus } from "@/lib/meta/types";
import * as whatsappSend from "@/lib/meta/whatsapp-send";
import * as watiSend from "@/lib/wati/send";

const WA_ID = "16315551181";
const PHONE_NUMBER_ID = "123456123";

beforeEach(() => {
  // Fail-closed provider selection requires an explicit transport.
  process.env.WHATSAPP_PROVIDER = "meta";
});

afterEach(() => {
  delete process.env.WHATSAPP_PROVIDER;
  vi.restoreAllMocks();
});
const CONVO_EXTERNAL_ID = `${PHONE_NUMBER_ID}:${WA_ID}`;

function sampleWhatsAppEvent(
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  return {
    channel: "whatsapp",
    provider: META_WHATSAPP_PROVIDER,
    externalEventId: "wamid.first",
    externalMessageId: "wamid.first",
    externalConversationId: CONVO_EXTERNAL_ID,
    externalContactId: WA_ID,
    displayName: "Riya Sharma",
    senderName: "Riya Sharma",
    senderAddress: WA_ID,
    messageType: "text",
    messageBody: "Need help with a campaign",
    timestamp: "2020-10-18T22:13:26.000Z",
    phoneNumberId: PHONE_NUMBER_ID,
    recipientAccountId: null,
    quickReplyPayload: null,
    eventFragment: { messaging_product: "whatsapp", type: "text", hasId: true },
    ...overrides,
  };
}

function createMemoryInstagramStore(): InstagramIngestStore & {
  events: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  emails: Array<Record<string, unknown>>;
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
    async getConversation(channel: string, externalConversationId: string) {
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
      conversations.push({
        id,
        ...input,
        state: input.state ?? "unclassified",
        collectedData: {},
        ticketId: null,
        routingIntent: "unclassified",
        intakeSessionVersion: 0,
      });
      return { outcome: "inserted" as const, id };
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
      const row = tickets.find(
        (ticket) =>
          (ticket.sourceChannel === "whatsapp" ||
            ticket.source_channel === "whatsapp") &&
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
        sourceChannel: row.source_channel ?? "whatsapp",
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
        (message) =>
          message.externalMessageId === externalMessageId &&
          message.direction === "outbound",
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
    async reserveOutboundAndSnapshot() {
      return { outcome: "failed" as const, errorCode: "not_used_for_whatsapp" };
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
  };
}

const context = { webhookPayload: { object: "whatsapp_business_account" } };

describe("ingestWhatsAppInboundMessage routing", () => {
  it("asks the routing question on the first DM and creates no ticket", async () => {
    const send = vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent(),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(0);
    expect(store.events[0]?.provider).toBe(META_WHATSAPP_PROVIDER);
    expect(store.conversations[0]?.state).toBe("awaiting_route");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      recipientId: WA_ID,
      text: WHATSAPP_ROUTING_QUESTION_TEXT,
    });
    expect(send.mock.calls[0]?.[0].quickReplies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: "ROUTE_COLLABORATION" }),
        expect.objectContaining({ payload: "ROUTE_CREATOR_SUPPORT" }),
      ]),
    );
    send.mockRestore();
  });

  it("does not send a duplicate routing prompt for a repeated webhook", async () => {
    const send = vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    const event = sampleWhatsAppEvent();
    await ingestWhatsAppInboundMessage(event, store, context);
    const second = await ingestWhatsAppInboundMessage(event, store, context);
    expect(second.outcome).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });

  it("does not create a ticket for collaboration selection", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context);
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.collab",
        externalMessageId: "mid.collab",
        messageBody: "Campaign / Collaboration",
        quickReplyPayload: "ROUTE_COLLABORATION",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(0);
    expect(store.conversations[0]?.state).toBe("collaboration");
  });

  it("reclassifies a collaboration conversation on SUPPORT", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context);
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.collab",
        externalMessageId: "mid.collab",
        messageBody: "Campaign / Collaboration",
        quickReplyPayload: "ROUTE_COLLABORATION",
      }),
      store,
      context,
    );
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.support",
        externalMessageId: "mid.support",
        messageBody: "SUPPORT",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(0);
    expect(store.conversations[0]?.state).toBe("support_intake");
    expect(store.conversations[0]?.currentIntakeField).toBe("creator_details");
  });

  it("attaches a follow-up to an active WhatsApp ticket without routing", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    store.tickets.push({
      id: "ticket-open",
      status: "open",
      sourceChannel: "whatsapp",
      source_channel: "whatsapp",
      externalConversationId: CONVO_EXTERNAL_ID,
      externalContactId: WA_ID,
      ticketCode: "CF-2026-00001",
    });
    store.conversations.push({
      id: "convo-1",
      channel: "whatsapp",
      externalConversationId: CONVO_EXTERNAL_ID,
      externalContactId: WA_ID,
      state: "ticket_open",
      ticketId: "ticket-open",
      routingIntent: "creator_support",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.previous",
      intakeSessionVersion: 1,
    });
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
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
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: false,
      errorCode: "http_5xx",
      retryable: true,
      messagingWindowExpired: false,
      httpStatus: 500,
    });
    const store = createMemoryInstagramStore();
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
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

  it("creates exactly one ticket after the three intake answers using the original DM", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    const original = "Need help with a campaign";
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({ messageBody: original }),
      store,
      context,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator",
        externalMessageId: "mid.creator",
        messageBody: "Riya Sharma, riya@example.com, 9876543210",
      }),
      store,
      context,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.platform",
        externalMessageId: "mid.platform",
        messageBody: "Instagram, @riya_creates",
      }),
      store,
      context,
    );
    const created = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Summer Drop, Acme, August 2026",
      }),
      store,
      context,
    );
    expect(created.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.issue_description).toBe(original);
    expect(store.tickets[0]?.platform).toBe("instagram");
    expect(store.tickets[0]?.external_contact_id).toBe(WA_ID);
    expect(store.tickets[0]?.source_channel).toBe("whatsapp");
    expect(store.conversations[0]?.state).toBe("ticket_open");
    const confirmation = textSend.mock.calls
      .map((call) => call[0]?.text)
      .find((text) => typeof text === "string" && text.includes("CF-2026-00001"));
    expect(confirmation).toBe(
      ticketCreatedWithoutEmailText("Riya", "CF-2026-00001"),
    );

    const duplicate = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Summer Drop, Acme, August 2026",
      }),
      store,
      context,
    );
    expect(duplicate.outcome).toBe("duplicate");
    expect(store.tickets).toHaveLength(1);
    textSend.mockRestore();
  });

  it("sends a new platform prompt after RESTART even when a legacy platform prompt exists", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({ messageBody: "Need help with a campaign" }),
      store,
      context,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator.1",
        externalMessageId: "mid.creator.1",
        messageBody: "Riya Sharma, riya@example.com, 9876543210",
      }),
      store,
      context,
    );

    const conversationId = String(store.conversations[0]?.id);
    const versionBeforeRestart = Number(store.conversations[0]?.intakeSessionVersion ?? 0);
    const oldPlatformKey = chatbotOutboundIdempotencyKey(
      conversationId,
      versionBeforeRestart,
      intakeEffectType("platform_details"),
      "wa",
    );
    expect(
      store.messages.some((message) => message.idempotencyKey === oldPlatformKey),
    ).toBe(true);

    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.restart",
        externalMessageId: "mid.restart",
        messageBody: "RESTART",
      }),
      store,
      context,
    );
    const collected = store.conversations[0]?.collectedData as Record<string, unknown>;
    expect(collected.creatorName).toBeNull();
    expect(collected.email).toBeNull();
    expect(collected.phoneNormalized).toBe("+16315551181");
    expect(collected.phonePrefill).toBe(true);
    expect(collected.platform).toBeNull();
    expect(collected.socialHandle).toBeNull();
    expect(collected.campaignName).toBeNull();
    expect(collected.brandName).toBeNull();
    expect(collected.campaignMonth).toBeNull();
    expect(collected.originalInboundText).toBe("Need help with a campaign");
    expect(store.conversations[0]?.state).toBe("support_intake");
    expect(store.conversations[0]?.currentIntakeField).toBe("creator_details");

    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator.2",
        externalMessageId: "mid.creator.2",
        messageBody: "Riya Sharma, riya@example.com, 9876543210",
      }),
      store,
      context,
    );

    const versionAfterRestart = Number(store.conversations[0]?.intakeSessionVersion ?? 0);
    expect(versionAfterRestart).toBeGreaterThan(versionBeforeRestart);
    const newPlatformKey = chatbotOutboundIdempotencyKey(
      conversationId,
      versionAfterRestart,
      intakeEffectType("platform_details"),
      "wa",
    );
    expect(newPlatformKey).not.toBe(oldPlatformKey);
    const platformOutbounds = store.messages.filter(
      (message) =>
        message.direction === "outbound" &&
        (message.idempotencyKey === oldPlatformKey ||
          message.idempotencyKey === newPlatformKey),
    );
    expect(platformOutbounds.map((message) => message.idempotencyKey)).toEqual(
      expect.arrayContaining([oldPlatformKey, newPlatformKey]),
    );
    expect(
      store.messages.filter((message) => message.idempotencyKey === newPlatformKey),
    ).toHaveLength(1);
    expect(store.conversations[0]?.currentIntakeField).toBe("platform_details");
    expect(
      store.messages.some(
        (message) =>
          message.idempotencyKey === newPlatformKey &&
          message.messageBody === PLATFORM_DETAILS_PROMPT_TEXT,
      ),
    ).toBe(true);

    const duplicate = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator.2",
        externalMessageId: "mid.creator.2",
        messageBody: "Riya Sharma, riya@example.com, 9876543210",
      }),
      store,
      context,
    );
    expect(duplicate.outcome).toBe("duplicate");
    expect(
      store.messages.filter((message) => message.idempotencyKey === newPlatformKey),
    ).toHaveLength(1);
  });

  it("does not advance to platform_details when the platform prompt cannot be reserved", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    const originalClaim = store.claimOutboundMessage.bind(store);
    store.claimOutboundMessage = async (input) => {
      if (String(input.idempotencyKey).includes("intake:platform_details")) {
        return { outcome: "failed" as const, errorCode: "outbound_insert_failed" };
      }
      return originalClaim(input);
    };

    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context);
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator",
        externalMessageId: "mid.creator",
        messageBody: "Riya Sharma, riya@example.com, 9876543210",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("failed");
    expect(store.conversations[0]?.currentIntakeField).toBe("creator_details");
    expect(store.conversations[0]?.state).toBe("support_intake");
  });

  it("recovers a missing platform prompt on the next inbound without manual edits", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-stuck",
      channel: "whatsapp",
      externalConversationId: CONVO_EXTERNAL_ID,
      externalContactId: WA_ID,
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: "platform_details",
      lastPromptKey: "intake:rs_legacy:platform_details",
      lastProcessedExternalMessageId: "mid.creator.old",
      intakeSessionVersion: 1,
      collectedData: {
        creatorName: "Riya Sharma",
        email: "riya@example.com",
        phoneNormalized: "+919876543210",
        platform: null,
        socialHandle: null,
        originalInboundText: "Need help with a campaign",
      },
    });
    store.messages.push({
      id: "legacy-platform",
      conversationId: "convo-stuck",
      direction: "outbound",
      idempotencyKey: "wa:prompt:convo-stuck:intake:rs_legacy:platform_details",
      deliveryStatus: "sent",
      messageBody: PLATFORM_DETAILS_PROMPT_TEXT,
    });

    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.recover",
        externalMessageId: "mid.recover",
        messageBody: "hello",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.currentIntakeField).toBe("platform_details");
    expect(store.conversations[0]?.state).toBe("support_intake");
    const recoveredKey = chatbotOutboundIdempotencyKey(
      "convo-stuck",
      1,
      intakeEffectType("platform_details"),
      "wa",
    );
    expect(
      store.messages.some(
        (message) =>
          message.idempotencyKey === recoveredKey &&
          message.messageBody === PLATFORM_DETAILS_PROMPT_TEXT,
      ),
    ).toBe(true);
    expect(textSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: PLATFORM_DETAILS_PROMPT_TEXT }),
    );
    const logged = JSON.stringify(store.events);
    expect(logged).not.toContain("riya@example.com");
    expect(logged).not.toContain("Need help with a campaign");
    textSend.mockRestore();
  });

  it("prefills creator phone from wa_id and asks only for name and email", async () => {
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context);
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    expect(textSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT }),
    );
    const afterRoute = store.conversations[0]?.collectedData as Record<string, unknown>;
    expect(afterRoute.creatorName).toBeNull();
    expect(afterRoute.phoneNormalized).toBe("+16315551181");
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator",
        externalMessageId: "mid.creator",
        messageBody: "Riya Sharma, riya@example.com",
      }),
      store,
      context,
    );
    const collected = store.conversations[0]?.collectedData as Record<string, unknown>;
    expect(collected.creatorName).toBe("Riya Sharma");
    expect(collected.email).toBe("riya@example.com");
    expect(collected.phoneNormalized).toBe("+16315551181");
    expect(store.conversations[0]?.currentIntakeField).toBe("platform_details");
    textSend.mockRestore();
  });

  it("asks the creator to reply with text when media arrives during intake", async () => {
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context);
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "wamid.image",
        externalMessageId: "wamid.image",
        messageType: "unsupported",
        unsupportedKind: "image",
        messageBody: "[image]",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_route");
    expect(store.tickets).toHaveLength(0);
    expect(textSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Please send the requested details as text so I can continue.",
      }),
    );
    textSend.mockRestore();
  });

  it("updates outbound delivery from a status webhook without creating inbound messages", async () => {
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-1",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.out.1",
      deliveryStatus: "sent",
      messageBody: "Thanks",
    });
    const status: NormalizedWhatsAppStatus = {
      channel: "whatsapp",
      provider: META_WHATSAPP_PROVIDER,
      externalEventId: "status:wamid.out.1:delivered",
      metaMessageId: "wamid.out.1",
      status: "delivered",
      timestamp: "2020-10-18T22:13:27.000Z",
      phoneNumberId: PHONE_NUMBER_ID,
      errorCode: null,
    };
    const result = await ingestWhatsAppStatus(status, store, context);
    expect(result.outcome).toBe("stored");
    expect(store.messages[0]?.deliveryStatus).toBe("delivered");
    expect(store.messages.filter((message) => message.direction === "inbound")).toHaveLength(0);
    expect(store.tickets).toHaveLength(0);
  });

  it("correlates WATI delivery callbacks by whatsappMessageId", async () => {
    const { WATI_WHATSAPP_PROVIDER } = await import("@/lib/wati/constants");
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-wati",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.wati.out",
      deliveryStatus: "sent",
      messageBody: "CRM reply",
      idempotencyKey: "wa:crm:legacy-only",
    });
    const result = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: WATI_WHATSAPP_PROVIDER,
        externalEventId: "sentMessageDELIVERED_v2:wamid.wati.out",
        metaMessageId: "wamid.wati.out",
        status: "delivered",
        timestamp: "2020-10-18T22:13:27.000Z",
        phoneNumberId: null,
        errorCode: null,
        localMessageId: null,
        watiEventId: "wati-internal-1",
      },
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.messages[0]?.deliveryStatus).toBe("delivered");
    expect(store.messages[0]?.externalMessageId).toBe("wamid.wati.out");
  });

  it("updates the same outbound row across sent/delivered/read with distinct event ids", async () => {
    const { WATI_WHATSAPP_PROVIDER } = await import("@/lib/wati/constants");
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-lifecycle",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.lifecycle",
      deliveryStatus: "pending",
      messageBody: "Hello",
    });
    const wamid = "wamid.lifecycle";
    const stages = [
      {
        externalEventId: `sessionMessageSent_v2:${wamid}`,
        status: "sent" as const,
      },
      {
        externalEventId: `sentMessageDELIVERED_v2:${wamid}`,
        status: "delivered" as const,
      },
      {
        externalEventId: `sentMessageREAD_v2:${wamid}`,
        status: "read" as const,
      },
    ];
    for (const stage of stages) {
      const result = await ingestWhatsAppStatus(
        {
          channel: "whatsapp",
          provider: WATI_WHATSAPP_PROVIDER,
          externalEventId: stage.externalEventId,
          metaMessageId: wamid,
          status: stage.status,
          timestamp: "2020-10-18T22:13:27.000Z",
          phoneNumberId: null,
          errorCode: null,
        },
        store,
        context,
      );
      expect(result.outcome).toBe("stored");
      expect(store.messages[0]?.deliveryStatus).toBe(stage.status);
      expect(store.messages[0]?.externalMessageId).toBe(wamid);
    }
    expect(new Set(stages.map((stage) => stage.externalEventId)).size).toBe(3);
    expect(store.events).toHaveLength(3);
    expect(store.events.every((event) => event.provider === "wati")).toBe(true);
  });

  it("does not process a duplicate delivered callback twice", async () => {
    const { WATI_WHATSAPP_PROVIDER } = await import("@/lib/wati/constants");
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-dup",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.dup",
      deliveryStatus: "sent",
      messageBody: "Hello",
    });
    const status = {
      channel: "whatsapp" as const,
      provider: WATI_WHATSAPP_PROVIDER,
      externalEventId: "sentMessageDELIVERED_v2:wamid.dup",
      metaMessageId: "wamid.dup",
      status: "delivered" as const,
      timestamp: "2020-10-18T22:13:27.000Z",
      phoneNumberId: null,
      errorCode: null,
    };
    const first = await ingestWhatsAppStatus(status, store, context);
    const second = await ingestWhatsAppStatus(status, store, context);
    expect(first.outcome).toBe("stored");
    expect(second.outcome).toBe("duplicate");
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.provider).toBe("wati");
    expect(store.events[0]?.externalEventId).toBe(
      "sentMessageDELIVERED_v2:wamid.dup",
    );
  });

  it("keeps legacy localMessageId correlation for older WATI rows", async () => {
    const { WATI_WHATSAPP_PROVIDER } = await import("@/lib/wati/constants");
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-legacy",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: null,
      deliveryStatus: "pending",
      messageBody: "Legacy",
      idempotencyKey: "wa:crm:comment-legacy",
    });
    const result = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: WATI_WHATSAPP_PROVIDER,
        externalEventId: "sessionMessageSent_v2:wamid.late",
        metaMessageId: "wamid.late",
        status: "sent",
        timestamp: "2020-10-18T22:13:27.000Z",
        phoneNumberId: null,
        errorCode: null,
        localMessageId: "wa:crm:comment-legacy",
        watiEventId: null,
      },
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.messages[0]?.deliveryStatus).toBe("sent");
    expect(store.messages[0]?.externalMessageId).toBe("wamid.late");
  });

  it("covers webhook_event_insert_failed regression by using provider=wati", async () => {
    const { WATI_WHATSAPP_PROVIDER } = await import("@/lib/wati/constants");
    expect(WATI_WHATSAPP_PROVIDER).toBe("wati");
    expect(WATI_WHATSAPP_PROVIDER).not.toBe("wati_whatsapp");
    // DB check allows: wati, meta, meta_whatsapp, meta_instagram, website, brevo
    const allowed = new Set([
      "wati",
      "meta",
      "meta_whatsapp",
      "meta_instagram",
      "website",
      "brevo",
    ]);
    expect(allowed.has(WATI_WHATSAPP_PROVIDER)).toBe(true);
    expect(allowed.has("wati_whatsapp")).toBe(false);

    const store = createMemoryInstagramStore();
    const result = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: WATI_WHATSAPP_PROVIDER,
        externalEventId: "sentMessageDELIVERED_v2:wamid.constraint",
        metaMessageId: "wamid.constraint",
        status: "delivered",
        timestamp: "2020-10-18T22:13:27.000Z",
        phoneNumberId: null,
        errorCode: null,
      },
      store,
      context,
    );
    // Unknown outbound still completes the webhook event (no insert failure).
    expect(result.outcome).toBe("duplicate");
    expect(store.events[0]?.provider).toBe("wati");
    expect(store.events[0]?.processingStatus).toBe("completed");
  });

  it("applies a WhatsApp status webhook through the verified payload processor", async () => {
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-status",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.HBgNMTYzMTU1NTExODE",
      deliveryStatus: "sent",
      messageBody: "Thanks",
    });
    const response = await processWhatsAppVerifiedPayload(whatsappStatusPayload(), {
      store,
    });
    expect(response.status).toBe(200);
    expect(store.messages[0]?.deliveryStatus).toBe("delivered");
    expect(store.messages.filter((message) => message.direction === "inbound")).toHaveLength(0);
    expect(store.tickets).toHaveLength(0);
  });

  it("records WhatsApp read status on the matching outbound message", async () => {
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-read",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.out.read",
      deliveryStatus: "delivered",
      messageBody: "Thanks",
    });
    const result = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: META_WHATSAPP_PROVIDER,
        externalEventId: "status:wamid.out.read:read",
        metaMessageId: "wamid.out.read",
        status: "read",
        timestamp: "2020-10-18T22:13:28.000Z",
        phoneNumberId: PHONE_NUMBER_ID,
        errorCode: null,
      },
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.messages[0]?.deliveryStatus).toBe("read");
    expect(store.tickets).toHaveLength(0);
  });

  it("does not create an inbound message from a failed status webhook", async () => {
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "in-1",
      conversationId: "convo-1",
      direction: "inbound",
      externalMessageId: "wamid.failed.1",
      deliveryStatus: "received",
      messageBody: "Hello",
    });
    const result = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: META_WHATSAPP_PROVIDER,
        externalEventId: "status:wamid.failed.1:failed",
        metaMessageId: "wamid.failed.1",
        status: "failed",
        timestamp: "2020-10-18T22:13:27.000Z",
        phoneNumberId: PHONE_NUMBER_ID,
        errorCode: "graph_131047",
      },
      store,
      context,
    );
    expect(result.outcome).toBe("duplicate");
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]?.direction).toBe("inbound");
    expect(store.messages[0]?.deliveryStatus).toBe("received");
    expect(store.tickets).toHaveLength(0);
  });

  it("ignores events for an unexpected phone_number_id without logging the number", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    send.mockClear();
    const store = createMemoryInstagramStore();
    const response = await processWhatsAppVerifiedPayload(whatsappTextPayload(), {
      env: {
        META_WHATSAPP_PHONE_NUMBER_ID: "999999999",
      },
      store,
    });
    expect(response.status).toBe(200);
    expect(store.tickets).toHaveLength(0);
    expect(store.messages).toHaveLength(0);
    expect(store.conversations).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("999999999");
    expect(logged).not.toContain("123456123");
    expect(logged).not.toContain("16315551181");
    errorSpy.mockRestore();
    send.mockRestore();
  });

  it("asks only for the missing creator details after a partial answer", async () => {
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context);
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.partial",
        externalMessageId: "mid.partial",
        messageBody: "Riya Sharma",
      }),
      store,
      context,
    );
    expect(store.conversations[0]?.currentIntakeField).toBe("creator_details");
    expect(textSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Please send a valid email address.",
      }),
    );
    textSend.mockRestore();
  });

  it("still creates the WhatsApp ticket when confirmation email fails", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    vi.spyOn(instagramTicketMail, "sendInstagramTicketConfirmationEmail").mockResolvedValue({
      outcome: "failed",
      errorCode: "brevo_failed",
    });
    const store = createMemoryInstagramStore();
    const loadTicket = async (id: string): Promise<DbTicket | null> => {
      const row = store.tickets.find((ticket) => ticket.id === id);
      if (!row) return null;
      return {
        id,
        ticket_code: String(row.ticketCode ?? row.ticket_code),
        creator_name: String(row.creator_name ?? "Riya Sharma"),
        creator_email: String(row.creator_email ?? "riya@example.com"),
        creator_phone: String(row.creator_phone ?? "+16315551181"),
        source_channel: "whatsapp",
        status: "open",
        social_handle: String(row.social_handle ?? "riya_creates"),
        platform: "instagram",
        issue_type: null,
        campaign_name: String(row.campaign_name ?? "Summer Drop"),
        brand_name: String(row.brand_name ?? "Acme"),
        campaign_month: String(row.campaign_month ?? "2026-08-01"),
        cloutflow_poc_name: null,
        cloutflow_poc_contact_number: null,
        request_category: "creator_support",
        company_name: null,
        requester_type: null,
        topic_or_module: null,
        intake_details: null,
        priority: "normal",
        assigned_team: "Creator Support",
        assigned_executive_id: null,
        assigned_executive_name: null,
        issue_description: String(row.issue_description ?? "Need help with a campaign"),
        internal_notes: null,
        acknowledgement_email_requested: true,
        acknowledgement_email_sent_at: null,
        resolution_summary: null,
        first_response_at: null,
        resolved_at: null,
        customer_last_notified_at: null,
        metadata: null,
        external_contact_id: WA_ID,
        external_conversation_id: CONVO_EXTERNAL_ID,
        created_at: "2020-10-18T22:13:26.000Z",
        updated_at: "2020-10-18T22:13:26.000Z",
      };
    };
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context, {
      loadTicket,
    });
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
      { loadTicket },
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator",
        externalMessageId: "mid.creator",
        messageBody: "Riya Sharma, riya@example.com",
      }),
      store,
      context,
      { loadTicket },
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.platform",
        externalMessageId: "mid.platform",
        messageBody: "Instagram, @riya_creates",
      }),
      store,
      context,
      { loadTicket },
    );
    const created = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Summer Drop, Acme, August 2026",
      }),
      store,
      context,
      { loadTicket },
    );
    expect(created.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.conversations[0]?.state).toBe("ticket_open");
    const confirmation = textSend.mock.calls
      .map((call) => call[0]?.text)
      .find((text) => typeof text === "string" && text.includes("CF-2026-"));
    expect(confirmation).toBe(ticketCreatedWithoutEmailText("Riya", "CF-2026-00001"));
    textSend.mockRestore();
  });

  it("sends the ticket code through WhatsApp with the email sentence when email succeeds", async () => {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    const textSend = vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
    const mailed = vi
      .spyOn(instagramTicketMail, "sendInstagramTicketConfirmationEmail")
      .mockResolvedValue({
        outcome: "sent",
        messageId: "brevo-wa-1",
      });
    const store = createMemoryInstagramStore();
    const loadTicket = async (id: string): Promise<DbTicket | null> => {
      const row = store.tickets.find((ticket) => ticket.id === id);
      if (!row) return null;
      return {
        id,
        ticket_code: String(row.ticketCode ?? row.ticket_code),
        creator_name: String(row.creator_name ?? "Riya Sharma"),
        creator_email: String(row.creator_email ?? "riya@example.com"),
        creator_phone: String(row.creator_phone ?? "+16315551181"),
        source_channel: "whatsapp",
        status: "open",
        social_handle: String(row.social_handle ?? "riya_creates"),
        platform: "instagram",
        issue_type: null,
        campaign_name: String(row.campaign_name ?? "Summer Drop"),
        brand_name: String(row.brand_name ?? "Acme"),
        campaign_month: String(row.campaign_month ?? "2026-08-01"),
        cloutflow_poc_name: null,
        cloutflow_poc_contact_number: null,
        request_category: "creator_support",
        company_name: null,
        requester_type: null,
        topic_or_module: null,
        intake_details: null,
        priority: "normal",
        assigned_team: "Creator Support",
        assigned_executive_id: null,
        assigned_executive_name: null,
        issue_description: String(row.issue_description ?? "Need help with a campaign"),
        internal_notes: null,
        acknowledgement_email_requested: true,
        acknowledgement_email_sent_at: null,
        resolution_summary: null,
        first_response_at: null,
        resolved_at: null,
        customer_last_notified_at: null,
        metadata: null,
        external_contact_id: WA_ID,
        external_conversation_id: CONVO_EXTERNAL_ID,
        created_at: "2020-10-18T22:13:26.000Z",
        updated_at: "2020-10-18T22:13:26.000Z",
      };
    };
    const deps = { loadTicket };
    await ingestWhatsAppInboundMessage(sampleWhatsAppEvent(), store, context, deps);
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
      deps,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.creator",
        externalMessageId: "mid.creator",
        messageBody: "Riya Sharma, riya@example.com",
      }),
      store,
      context,
      deps,
    );
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.platform",
        externalMessageId: "mid.platform",
        messageBody: "Instagram, @riya_creates",
      }),
      store,
      context,
      deps,
    );
    const created = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        externalEventId: "mid.campaign",
        externalMessageId: "mid.campaign",
        messageBody: "Summer Drop, Acme, August 2026",
      }),
      store,
      context,
      deps,
    );
    expect(created.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(mailed).toHaveBeenCalledTimes(1);
    expect(store.emails.some((row) => row.purpose === "whatsapp-ticket-confirmation")).toBe(
      true,
    );
    const confirmation = textSend.mock.calls
      .map((call) => call[0]?.text)
      .find((text) => typeof text === "string" && text.includes("CF-2026-"));
    expect(confirmation).toBe(ticketCreatedWithEmailText("Riya", "CF-2026-00001"));
  });
});

describe("mapIntakeToWhatsAppTicketInsert", () => {
  it("stores collected fields without fake placeholders", () => {
    const insert = mapIntakeToInstagramTicketInsert({
      collected: emptyIntakeCollected({
        creatorName: "Riya Sharma",
        email: "riya@example.com",
        phoneNormalized: "+16315551181",
        phoneDisplay: "16315551181",
        platform: "youtube",
        socialHandle: "riya_creates",
        campaignName: "Summer Drop",
        brandName: "Acme",
        campaignMonth: "2026-08-01",
        originalInboundText: "Need help with a campaign",
      }),
      externalContactId: WA_ID,
      externalConversationId: CONVO_EXTERNAL_ID,
      sourceChannel: "whatsapp",
    });
    expect(insert.source_channel).toBe("whatsapp");
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
});

describe("WATI interactive ingest parity", () => {
  it("sends native WATI buttons on the first routing prompt and does not also send text", async () => {
    process.env.WHATSAPP_PROVIDER = "wati";
    const interactive = vi
      .spyOn(watiSend, "sendWatiInteractiveMessage")
      .mockResolvedValue({
        ok: true,
        metaMessageId: "wamid.wati.route",
        recipientId: WA_ID,
      });
    const text = vi.spyOn(watiSend, "sendWatiSessionText");
    const metaButtons = vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons");
    const store = createMemoryInstagramStore();
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        provider: "wati",
        externalEventId: "messageReceived:wamid.first",
      }),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_route");
    expect(interactive).toHaveBeenCalledTimes(1);
    expect(interactive.mock.calls[0]?.[0]).toMatchObject({
      text: WHATSAPP_ROUTING_QUESTION_TEXT,
      quickReplies: expect.arrayContaining([
        expect.objectContaining({ title: "Campaign / Collab" }),
        expect.objectContaining({ title: "Creator Support" }),
      ]),
    });
    expect(text).not.toHaveBeenCalled();
    expect(metaButtons).not.toHaveBeenCalled();
  });

  it("advances Creator Support from a WATI interactive title with no Instagram payload", async () => {
    process.env.WHATSAPP_PROVIDER = "wati";
    vi.spyOn(watiSend, "sendWatiInteractiveMessage").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati.qr",
      recipientId: WA_ID,
    });
    vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati.text",
      recipientId: WA_ID,
    });
    const store = createMemoryInstagramStore();
    await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        provider: "wati",
        externalEventId: "messageReceived:wamid.first",
      }),
      store,
      context,
    );
    const routed = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({
        provider: "wati",
        externalEventId: "messageReceived:wamid.btn",
        externalMessageId: "wamid.btn",
        messageType: "interactive",
        messageBody: "Creator Support",
        quickReplyPayload: null,
      }),
      store,
      context,
    );
    expect(routed.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("support_intake");
    expect(store.conversations[0]?.currentIntakeField).toBe("creator_details");
    expect(store.tickets).toHaveLength(0);
  });

  it("correlates a WATI status callback for an interactive outbound WAMID", async () => {
    const { WATI_WHATSAPP_PROVIDER } = await import("@/lib/wati/constants");
    const store = createMemoryInstagramStore();
    store.messages.push({
      id: "out-interactive",
      conversationId: "convo-1",
      direction: "outbound",
      externalMessageId: "wamid.wati.interactive",
      deliveryStatus: "sent",
      messageBody: WHATSAPP_ROUTING_QUESTION_TEXT,
    });
    const result = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: WATI_WHATSAPP_PROVIDER,
        externalEventId: "sentMessageDELIVERED_v2:wamid.wati.interactive",
        metaMessageId: "wamid.wati.interactive",
        status: "delivered",
        timestamp: "2020-10-18T22:13:27.000Z",
        phoneNumberId: null,
        errorCode: null,
      },
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.messages[0]?.deliveryStatus).toBe("delivered");
    expect(store.messages[0]?.externalMessageId).toBe("wamid.wati.interactive");
  });
});
