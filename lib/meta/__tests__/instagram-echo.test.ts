import { describe, expect, it } from "vitest";
import { ingestInstagramEcho } from "@/lib/meta/instagram-echo";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import type { NormalizedInstagramEcho } from "@/lib/meta/types";

function echo(
  overrides: Partial<NormalizedInstagramEcho> = {},
): NormalizedInstagramEcho {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: "echo:mid.out.1",
    externalMessageId: "mid.out.1",
    externalConversationId: "12334",
    recipientId: "12334",
    senderId: "17841400008460000",
    messageBody: "Staff typed this in Instagram",
    timestamp: "2020-10-18T22:13:26.000Z",
    isEcho: true,
    isSelf: false,
    eventFragment: { message: { mid: "mid.out.1", is_echo: true } },
    ...overrides,
  };
}

function store(overrides: Partial<InstagramIngestStore> = {}): InstagramIngestStore {
  const events: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  return {
    async claimWebhookEvent(input) {
      const existing = events.find((row) => row.externalEventId === input.externalEventId);
      if (existing) return { outcome: "already_processed" as const };
      const id = "evt-1";
      events.push({ id, ...input, processingStatus: "processing" });
      return { outcome: "claimed" as const, id };
    },
    async markWebhookEvent() {},
    async findOutboundByExternalMessageId(id) {
      const row = messages.find((message) => message.externalMessageId === id);
      if (!row) return null;
      return {
        id: row.id as string,
        externalMessageId: id,
        deliveryStatus: String(row.deliveryStatus),
          idempotencyKey: null,
          recipientExternalId: "12334",
          conversationId: "convo-1",
        };
    },
    async markOutboundMessage(id, patch) {
      const row = messages.find((message) => message.id === id);
      if (row) Object.assign(row, patch);
    },
    async getConversation() {
      return {
        id: "convo-1",
        displayName: null,
        ticketId: "ticket-1",
        state: "ticket_open",
        routingIntent: "creator_support",
        currentIntakeField: null,
        lastPromptKey: null,
        lastActivityAt: null,
        lastProcessedExternalMessageId: null,
        collectedData: {},
        externalContactId: "12334",
        intakeSessionVersion: 0,
      };
    },
    async insertEchoOutboundMessage(input) {
      messages.push({ id: "echo-1", ...input });
      return { outcome: "inserted" as const };
    },
    async findPendingTimeoutOutbound() {
      return null;
    },
    ...overrides,
  } as InstagramIngestStore;
}

describe("ingestInstagramEcho", () => {
  it("correlates an echo with a stored outbound message instead of inserting a duplicate", async () => {
    const memory = store({
      async findOutboundByExternalMessageId() {
        return {
          id: "out-1",
          externalMessageId: "mid.out.1",
          deliveryStatus: "pending",
          idempotencyKey: "ig:crm:c1",
          recipientExternalId: "12334",
          conversationId: "convo-1",
        };
      },
    });
    const marked: Array<Record<string, unknown>> = [];
    memory.markOutboundMessage = async (_id, patch) => {
      marked.push(patch);
    };
    const inserted: unknown[] = [];
    memory.insertEchoOutboundMessage = async (input) => {
      inserted.push(input);
      return { outcome: "inserted" };
    };
    const result = await ingestInstagramEcho(echo(), memory, {
      webhookPayload: { object: "instagram" },
    });
    expect(result.outcome).toBe("duplicate");
    expect(inserted).toHaveLength(0);
    expect(marked[0]).toMatchObject({ deliveryStatus: "sent" });
  });

  it("stores an unmatched echo as outbound transcript without routing", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const memory = store({
      async insertEchoOutboundMessage(input) {
        inserted.push(input);
        return { outcome: "inserted" };
      },
    });
    const result = await ingestInstagramEcho(echo(), memory, {
      webhookPayload: { object: "instagram" },
    });
    expect(result.outcome).toBe("stored");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.externalMessageId).toBe("mid.out.1");
  });
});
