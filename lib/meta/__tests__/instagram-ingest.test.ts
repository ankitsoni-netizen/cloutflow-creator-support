import { describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import { PLATFORM_DETAILS_PROMPT_TEXT, ROUTING_QUESTION_TEXT, ROUTE_CREATOR_SUPPORT_PAYLOAD, ticketCreatedWithoutEmailText } from "@/lib/meta/routing-copy";
import {
  chatbotOutboundIdempotencyKey,
  intakeEffectType,
} from "@/lib/meta/prompt-keys";
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

const context = { webhookPayload: { object: "instagram" } };

describe("ingestInstagramInboundMessage routing", () => {
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
    expect(store.conversations[0]?.state).toBe("awaiting_route");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      recipientId: "12334",
      text: ROUTING_QUESTION_TEXT,
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
    send.mockRestore();
  });

  it("does not create a ticket for collaboration selection", async () => {
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

  it("creates exactly one ticket after the three intake answers using the original DM", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const textSend = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    const original = "Need help with a campaign";
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({ messageBody: original }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.creator",
        externalMessageId: "mid.creator",
        messageBody: "Riya Sharma, riya@example.com, 9876543210",
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.platform",
        externalMessageId: "mid.platform",
        messageBody: "Instagram, @riya_creates",
      }),
      store,
      context,
    );
    const created = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
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
    expect(store.tickets[0]?.external_contact_id).toBe("12334");
    expect(store.conversations[0]?.state).toBe("ticket_open");
    const confirmation = textSend.mock.calls
      .map((call) => call[0]?.text)
      .find((text) => typeof text === "string" && text.includes("CF-2026-00001"));
    expect(confirmation).toBe(
      ticketCreatedWithoutEmailText("Riya", "CF-2026-00001"),
    );

    const duplicate = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
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
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
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
    );
    expect(
      store.messages.some((message) => message.idempotencyKey === oldPlatformKey),
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
    expect(collected.creatorName).toBeNull();
    expect(collected.email).toBeNull();
    expect(collected.phoneNormalized).toBeNull();
    expect(collected.platform).toBeNull();
    expect(collected.socialHandle).toBeNull();
    expect(collected.campaignName).toBeNull();
    expect(collected.brandName).toBeNull();
    expect(collected.campaignMonth).toBeNull();
    expect(collected.originalInboundText).toBe("Need help with a campaign");
    expect(store.conversations[0]?.state).toBe("support_intake");
    expect(store.conversations[0]?.currentIntakeField).toBe("creator_details");

    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
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

    const duplicate = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
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
    const originalClaim = store.claimOutboundMessage.bind(store);
    store.claimOutboundMessage = async (input) => {
      if (String(input.idempotencyKey).includes("intake:platform_details")) {
        return { outcome: "failed" as const, errorCode: "outbound_insert_failed" };
      }
      return originalClaim(input);
    };

    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.route",
        externalMessageId: "mid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      store,
      context,
    );
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
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
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const textSend = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: "12334",
    });
    const store = createMemoryInstagramStore();
    store.conversations.push({
      id: "convo-stuck",
      channel: "instagram",
      externalConversationId: "12334",
      externalContactId: "12334",
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
      idempotencyKey: "ig:prompt:convo-stuck:intake:rs_legacy:platform_details",
      deliveryStatus: "sent",
      messageBody: PLATFORM_DETAILS_PROMPT_TEXT,
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
    expect(store.conversations[0]?.currentIntakeField).toBe("platform_details");
    expect(store.conversations[0]?.state).toBe("support_intake");
    const recoveredKey = chatbotOutboundIdempotencyKey(
      "convo-stuck",
      1,
      intakeEffectType("platform_details"),
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
});
