import { describe, expect, it } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import type { InstagramIngestStore } from "@/lib/meta/instagram-ingest";
import { mapInstagramEventToTicketInsert } from "@/lib/meta/instagram-ticket";
import { toPlainTicketDescription } from "@/lib/meta/plain-text";
import { incompleteCollectedFields } from "@/lib/meta/collected-data";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import { persistNormalizedInboundMessage } from "@/lib/meta/store";
import type { MetaInboundStore } from "@/lib/meta/store";

function sampleInstagramEvent(
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: "mid.instagram.abc",
    externalMessageId: "mid.instagram.abc",
    externalConversationId: "IGSID123",
    externalContactId: "IGSID123",
    displayName: null,
    senderName: null,
    senderAddress: "IGSID123",
    messageType: "text",
    messageBody: "Need help with a campaign",
    timestamp: "2020-10-18T22:13:26.000Z",
    phoneNumberId: null,
    recipientAccountId: "INSTAGRAM_ACCOUNT_ID",
    eventFragment: { message: { mid: "mid.instagram.abc" } },
    ...overrides,
  };
}

function createMemoryInstagramStore(): InstagramIngestStore & {
  events: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
} {
  const events: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const tickets: Array<Record<string, unknown>> = [];
  let ids = 0;
  const nextId = () => `id-${++ids}`;

  const base = {
    events,
    conversations,
    messages,
    tickets,
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
      };
    },
    async insertConversation(input: {
      channel: string;
      externalConversationId: string;
      externalContactId: string;
      displayName: string | null;
      lastMessageAt: string;
    }) {
      const id = nextId();
      conversations.push({
        id,
        ...input,
        state: "new",
        collectedData: {},
        ticketId: null,
      });
      return { outcome: "inserted" as const, id };
    },
    async updateConversation(
      id: string,
      patch: {
        lastMessageAt: string;
        displayName: string | null;
        ticketId?: string | null;
        state?: string;
        collectedData?: Record<string, unknown>;
      },
    ) {
      const row = conversations.find((conversation) => conversation.id === id);
      if (!row) {
        return { outcome: "failed" as const, errorCode: "conversation_update_failed" };
      }
      row.lastMessageAt = patch.lastMessageAt;
      if (patch.displayName?.trim()) row.displayName = patch.displayName;
      if (patch.ticketId !== undefined) row.ticketId = patch.ticketId;
      if (patch.state) row.state = patch.state;
      if (patch.collectedData) row.collectedData = patch.collectedData;
      return { outcome: "updated" as const };
    },
    async insertInboundMessage(input: {
      conversationId: string;
      channel: string;
      externalMessageId: string;
      senderName: string | null;
      senderAddress: string;
      messageBody: string;
      eventFragment: Record<string, unknown>;
      ticketId?: string | null;
    }) {
      const duplicate = messages.find(
        (message) =>
          message.channel === input.channel &&
          message.externalMessageId === input.externalMessageId,
      );
      if (duplicate) return { outcome: "duplicate" as const };
      messages.push({
        id: nextId(),
        ...input,
        direction: "inbound",
        ticketId: input.ticketId ?? null,
      });
      return { outcome: "inserted" as const };
    },
    async getTicket(id: string) {
      const row = tickets.find((ticket) => ticket.id === id);
      if (!row) return null;
      return { id: row.id as string, status: String(row.status) };
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
      return { id: row.id as string, status: String(row.status) };
    },
    async insertInstagramTicket(row: Record<string, unknown>) {
      const id = nextId();
      tickets.push({
        id,
        status: "open",
        sourceChannel: "instagram",
        ...row,
      });
      return { outcome: "inserted" as const, id };
    },
  };

  return base as unknown as InstagramIngestStore & {
    events: typeof events;
    conversations: typeof conversations;
    messages: typeof messages;
    tickets: typeof tickets;
  };
}

const context = { webhookPayload: { object: "instagram" } };

describe("mapInstagramEventToTicketInsert", () => {
  it("creates an Instagram ticket without fake creator or campaign placeholders", () => {
    const insert = mapInstagramEventToTicketInsert(sampleInstagramEvent());
    expect(insert.source_channel).toBe("instagram");
    expect(insert.status).toBe("open");
    expect(insert.priority).toBe("normal");
    expect(insert.assigned_team).toBe("Creator Support");
    expect(insert.external_contact_id).toBe("IGSID123");
    expect(insert.external_conversation_id).toBe("IGSID123");
    expect(insert.creator_name).toBeNull();
    expect(insert.creator_phone).toBeNull();
    expect(insert.campaign_name).toBeNull();
    expect(insert.brand_name).toBeNull();
    expect(insert.campaign_month).toBeNull();
    expect(insert.platform).toBeNull();
    expect(insert.issue_description).toBe("Need help with a campaign");
    expect(insert.acknowledgement_email_requested).toBe(false);
    const serialized = JSON.stringify(insert);
    expect(serialized).not.toMatch(/Not applicable|Unknown Creator|N\/A|placeholder/i);
    expect(insert.metadata.incompleteFields).toEqual(
      expect.arrayContaining(["creatorName", "phone", "email", "campaignName"]),
    );
  });
});

describe("ingestInstagramInboundMessage", () => {
  it("creates one Instagram ticket for a first DM", async () => {
    const store = createMemoryInstagramStore();
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]?.ticketId).toBe(store.tickets[0]?.id);
    expect(store.conversations[0]?.ticketId).toBe(store.tickets[0]?.id);
    expect(store.conversations[0]?.state).toBe("ticket_created");
    expect(store.tickets[0]).toMatchObject({
      source_channel: "instagram",
      campaign_name: null,
      brand_name: null,
    });
  });

  it("attaches a follow-up DM to the existing conversation ticket", async () => {
    const store = createMemoryInstagramStore();
    await ingestInstagramInboundMessage(sampleInstagramEvent(), store, context);
    const followUp = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.instagram.def",
        externalMessageId: "mid.instagram.def",
        messageBody: "Following up",
      }),
      store,
      context,
    );
    expect(followUp.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.messages).toHaveLength(2);
    expect(store.messages[1]?.ticketId).toBe(store.tickets[0]?.id);
    expect(store.conversations).toHaveLength(1);
  });

  it("does not duplicate messages or tickets for a repeated event", async () => {
    const store = createMemoryInstagramStore();
    const event = sampleInstagramEvent();
    const first = await ingestInstagramInboundMessage(event, store, context);
    const second = await ingestInstagramInboundMessage(event, store, context);
    expect(first.outcome).toBe("stored");
    expect(second.outcome).toBe("duplicate");
    expect(store.tickets).toHaveLength(1);
    expect(store.messages).toHaveLength(1);
  });

  it("records a sanitized error when ticket insert fails", async () => {
    const store = createMemoryInstagramStore();
    store.insertInstagramTicket = async () => ({
      outcome: "failed",
      errorCode: "ticket_insert_failed",
    });
    const result = await ingestInstagramInboundMessage(
      sampleInstagramEvent({ messageBody: "secret creator email riya@example.com" }),
      store,
      context,
    );
    expect(result).toEqual({
      outcome: "failed",
      errorCode: "ticket_insert_failed",
    });
    expect(store.events[0]?.processingStatus).toBe("failed");
    expect(JSON.stringify(store.events[0])).not.toContain("riya@example.com");
  });
});

describe("plain ticket description", () => {
  it("does not treat inbound HTML as trusted markup", () => {
    expect(
      toPlainTicketDescription(`Please help <script>alert("x")</script> now`),
    ).toBe(`Please help alert("x") now`);
  });
});

describe("collected data incompleteness", () => {
  it("marks uncollected chatbot fields", () => {
    const insert = mapInstagramEventToTicketInsert(sampleInstagramEvent());
    const fields = insert.metadata.incompleteFields as string[];
    expect(incompleteCollectedFields).toBeTypeOf("function");
    expect(fields).toContain("phone");
    expect(fields).not.toContain("issueDescription");
  });
});

describe("generic persist remains ticket-free", () => {
  it("does not require Instagram ticket methods", async () => {
    const store = createMemoryInstagramStore() as unknown as MetaInboundStore;
    const result = await persistNormalizedInboundMessage(
      sampleInstagramEvent(),
      store,
      context,
    );
    expect(result.outcome).toBe("stored");
  });
});
