import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { watiMemoryOutbox } from "@/lib/meta/__tests__/wati-memory-outbox";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import {
  drainDueWatiOutbox,
  drainWatiConversationOutbox,
  nextWatiAttemptAt,
  WATI_OUTBOX_TIMEOUT_GRACE_MS,
} from "@/lib/wati/outbox";
import * as watiSend from "@/lib/wati/send";
import { WATI_TEST_CHANNEL, WATI_TEST_WA_ID } from "@/lib/wati/__tests__/fixtures";

pinIdentitySchemaPhase("c");

const CONVERSATION_ID = "convo-wati-outbox";

function seedOutbound(
  store: ReturnType<typeof createMemoryChatbotStore>,
  row: Record<string, unknown>,
) {
  store.messages.push({
    conversationId: CONVERSATION_ID,
    channel: "whatsapp",
    direction: "outbound",
    recipientExternalId: WATI_TEST_WA_ID,
    ...row,
  });
}

function outboxStore(messages: Array<Record<string, unknown>>): InstagramIngestStore {
  return {
    messages,
    async markOutboundMessage(id: string, patch: Record<string, unknown>) {
      const row = messages.find((message) => message.id === id);
      if (!row) return;
      row.outboundClaimed = false;
      Object.assign(row, patch);
    },
    ...watiMemoryOutbox(messages),
  } as unknown as InstagramIngestStore;
}

describe("drainWatiConversationOutbox", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = "wati";
    process.env.WATI_CONVERSATION_TARGET_MODE = "recipient";
    process.env.WATI_CHANNEL_PHONE_NUMBER = WATI_TEST_CHANNEL;
    vi.spyOn(watiSend, "sendWatiInteractiveMessage").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.drain.qr",
      recipientId: WATI_TEST_WA_ID,
    });
    vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.drain.text",
      recipientId: WATI_TEST_WA_ID,
    });
  });

  afterEach(() => {
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WATI_CONVERSATION_TARGET_MODE;
    delete process.env.WATI_CHANNEL_PHONE_NUMBER;
    vi.restoreAllMocks();
  });

  it("retries failed text, buttons, and list, and never touches delivered or sent rows", async () => {
    const store = createMemoryChatbotStore("whatsapp", { identitySchema: "expanded" });
    seedOutbound(store, {
      id: "out-text-failed",
      messageBody: "Pick a persona",
      purpose: "prompt",
      deliveryStatus: "failed",
      rawPayload: null,
    });
    seedOutbound(store, {
      id: "out-buttons-failed",
      messageBody: "Is that the right month?",
      purpose: "prompt",
      deliveryStatus: "failed",
      rawPayload: {
        text: "Is that the right month?",
        quick_replies: [
          { content_type: "text", title: "Yes", payload: "CAMPAIGN_MONTH_YES" },
          { content_type: "text", title: "No", payload: "CAMPAIGN_MONTH_NO" },
        ],
      },
    });
    seedOutbound(store, {
      id: "out-list-failed",
      messageBody: "Who are you messaging as?",
      purpose: "prompt",
      deliveryStatus: "failed",
      rawPayload: {
        text: "Who are you messaging as?",
        quick_replies: [
          { content_type: "text", title: "I'm a creator", payload: "PERSONA_CREATOR" },
          { content_type: "text", title: "I'm a brand", payload: "PERSONA_BRAND" },
          { content_type: "text", title: "I'm an agency", payload: "PERSONA_AGENCY" },
          { content_type: "text", title: "Something else", payload: "PERSONA_OTHER" },
        ],
      },
    });
    seedOutbound(store, {
      id: "out-closing-delivered",
      messageBody: "Ticket ID: CF-2026-00040",
      purpose: "ticket",
      deliveryStatus: "delivered",
      rawPayload: {
        text: "Ticket ID: CF-2026-00040",
        quick_replies: [
          { content_type: "text", title: "Main menu", payload: "POST_MAIN_MENU" },
          { content_type: "text", title: "I'm done", payload: "POST_DONE" },
        ],
      },
    });
    seedOutbound(store, {
      id: "out-text-sent",
      messageBody: "Thanks, already delivered",
      purpose: "prompt",
      deliveryStatus: "sent",
      rawPayload: null,
    });
    seedOutbound(store, {
      id: "out-staff",
      messageBody: "Staff reply",
      purpose: "staff_reply",
      deliveryStatus: "failed",
      rawPayload: null,
    });

    const result = await drainWatiConversationOutbox({
      store,
      recipientId: WATI_TEST_WA_ID,
      conversationId: CONVERSATION_ID,
    });

    expect(result.drained).toBe(3);
    expect(result.retryableFailure).toBe(false);
    expect(watiSend.sendWatiSessionText).toHaveBeenCalledTimes(1);
    expect(watiSend.sendWatiSessionText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Pick a persona" }),
    );
    expect(watiSend.sendWatiInteractiveMessage).toHaveBeenCalledTimes(2);
    expect(watiSend.sendWatiInteractiveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Is that the right month?",
        quickReplies: expect.arrayContaining([
          expect.objectContaining({ title: "Yes" }),
        ]),
      }),
    );
    expect(watiSend.sendWatiInteractiveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Who are you messaging as?",
        quickReplies: expect.arrayContaining([
          expect.objectContaining({ title: "I'm a creator" }),
          expect.objectContaining({ title: "Something else" }),
        ]),
      }),
    );
    expect(
      vi.mocked(watiSend.sendWatiInteractiveMessage).mock.calls.some((call) =>
        String(call[0]?.text ?? "").includes("CF-2026-00040"),
      ),
    ).toBe(false);
    expect(
      vi.mocked(watiSend.sendWatiSessionText).mock.calls.some((call) =>
        String(call[0]?.text ?? "").includes("already delivered"),
      ),
    ).toBe(false);
    expect(
      vi.mocked(watiSend.sendWatiSessionText).mock.calls.some((call) =>
        String(call[0]?.text ?? "").includes("Staff reply"),
      ),
    ).toBe(false);
    expect(
      store.messages.find((row) => row.id === "out-closing-delivered")?.deliveryStatus,
    ).toBe("delivered");
    expect(store.messages.find((row) => row.id === "out-text-sent")?.deliveryStatus).toBe(
      "sent",
    );
    expect(store.messages.find((row) => row.id === "out-text-failed")?.deliveryStatus).toBe(
      "sent",
    );
    expect(
      store.messages.find((row) => row.id === "out-buttons-failed")?.deliveryStatus,
    ).toBe("sent");
    expect(store.messages.find((row) => row.id === "out-list-failed")?.deliveryStatus).toBe(
      "sent",
    );
  });

  it("does not let two workers send the same reserved row", async () => {
    const send = vi.mocked(watiSend.sendWatiSessionText).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        ok: true,
        metaMessageId: "wamid.out",
        recipientId: WATI_TEST_WA_ID,
      };
    });
    const messages = [
      {
        id: "out-1",
        conversationId: CONVERSATION_ID,
        direction: "outbound",
        channel: "whatsapp",
        recipientExternalId: WATI_TEST_WA_ID,
        deliveryStatus: "pending",
        messageBody: "Hello",
        deliveryAttemptCount: 0,
      },
    ];
    const store = outboxStore(messages);
    await Promise.all([
      drainWatiConversationOutbox({
        store,
        recipientId: WATI_TEST_WA_ID,
        conversationId: CONVERSATION_ID,
      }),
      drainWatiConversationOutbox({
        store,
        recipientId: WATI_TEST_WA_ID,
        conversationId: CONVERSATION_ID,
      }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(messages[0]?.deliveryStatus).toBe("sent");
  });

  it("keeps send_timeout pending until the grace period elapses", async () => {
    const now = new Date("2026-09-03T10:00:00.000Z");
    expect(Date.parse(nextWatiAttemptAt("send_timeout", 1, now))).toBe(
      now.getTime() + WATI_OUTBOX_TIMEOUT_GRACE_MS,
    );
    const messages = [
      {
        id: "out-1",
        conversationId: CONVERSATION_ID,
        direction: "outbound",
        channel: "whatsapp",
        recipientExternalId: WATI_TEST_WA_ID,
        deliveryStatus: "pending",
        deliveryErrorCode: "send_timeout",
        messageBody: "Hello",
        deliveryAttemptCount: 1,
        nextAttemptAt: new Date(now.getTime() + WATI_OUTBOX_TIMEOUT_GRACE_MS).toISOString(),
      },
    ];
    const store = outboxStore(messages);
    await drainWatiConversationOutbox({
      store,
      recipientId: WATI_TEST_WA_ID,
      conversationId: CONVERSATION_ID,
      now,
    });
    expect(watiSend.sendWatiSessionText).not.toHaveBeenCalled();
    expect(messages[0]?.deliveryStatus).toBe("pending");
  });

  it("skips terminal errors, exhausted attempts, and staff replies", async () => {
    const store = outboxStore([
      {
        id: "out-terminal",
        conversationId: CONVERSATION_ID,
        direction: "outbound",
        channel: "whatsapp",
        recipientExternalId: WATI_TEST_WA_ID,
        deliveryStatus: "failed",
        deliveryErrorCode: "http_401",
        messageBody: "Hello",
        deliveryAttemptCount: 1,
      },
      {
        id: "out-exhausted",
        conversationId: CONVERSATION_ID,
        direction: "outbound",
        channel: "whatsapp",
        recipientExternalId: WATI_TEST_WA_ID,
        deliveryStatus: "failed",
        deliveryErrorCode: "http_5xx",
        messageBody: "Retry me",
        deliveryAttemptCount: 5,
      },
      {
        id: "out-read",
        conversationId: CONVERSATION_ID,
        direction: "outbound",
        channel: "whatsapp",
        recipientExternalId: WATI_TEST_WA_ID,
        deliveryStatus: "read",
        messageBody: "Already read",
        deliveryAttemptCount: 1,
      },
    ]);
    const result = await drainDueWatiOutbox({ store });
    expect(result.claimed).toBe(0);
    expect(watiSend.sendWatiSessionText).not.toHaveBeenCalled();
  });

  it("reclaims a row after the 60s lease expires", async () => {
    const now = new Date("2026-09-03T10:01:00.000Z");
    const messages = [
      {
        id: "out-leased",
        conversationId: CONVERSATION_ID,
        direction: "outbound",
        channel: "whatsapp",
        recipientExternalId: WATI_TEST_WA_ID,
        deliveryStatus: "pending",
        messageBody: "Hello",
        deliveryAttemptCount: 1,
        nextAttemptAt: "2026-09-03T10:00:59.000Z",
      },
    ];
    const store = outboxStore(messages);
    const result = await drainWatiConversationOutbox({
      store,
      recipientId: WATI_TEST_WA_ID,
      conversationId: CONVERSATION_ID,
      now,
    });
    expect(result.claimed).toBe(1);
    expect(result.sent).toBe(1);
    expect(messages[0]?.deliveryStatus).toBe("sent");
  });
});
