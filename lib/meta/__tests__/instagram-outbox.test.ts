import { describe, expect, it, vi } from "vitest";
import {
  drainInstagramOutbox,
  INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS,
  nextInstagramAttemptAt,
} from "@/lib/meta/instagram-outbox";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import * as instagramSend from "@/lib/meta/instagram-send";
import { instagramMemoryOutbox } from "@/lib/meta/__tests__/instagram-memory-outbox";
import {
  startInstagramAttendingIndicators,
} from "@/lib/meta/instagram-sender-actions";

function outboxStore(messages: Array<Record<string, unknown>>): InstagramIngestStore {
  return {
    messages,
    async markOutboundMessage(id: string, patch: Record<string, unknown>) {
      const row = messages.find((message) => message.id === id);
      if (!row) return;
      row.outboundClaimed = false;
      Object.assign(row, patch);
    },
    ...instagramMemoryOutbox(messages),
  } as unknown as InstagramIngestStore;
}

describe("Instagram outbox drain", () => {
  it("does not let two workers send the same reserved row", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, metaMessageId: "mid.out", recipientId: "12334" };
    });
    const messages = [
      {
        id: "out-1",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "Hello",
        deliveryAttemptCount: 0,
      },
    ];
    const store = outboxStore(messages);
    await Promise.all([
      drainInstagramOutbox({
        store,
        recipientId: "12334",
        conversationId: "convo-1",
      }),
      drainInstagramOutbox({
        store,
        recipientId: "12334",
        conversationId: "convo-1",
      }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(messages[0]?.deliveryStatus).toBe("sent");
    send.mockRestore();
  });

  it("keeps timeout_unknown pending until the grace period elapses", async () => {
    const now = new Date("2026-08-26T10:00:00.000Z");
    expect(Date.parse(nextInstagramAttemptAt("timeout_unknown", 1, now))).toBe(
      now.getTime() + INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS,
    );
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [
      {
        id: "out-1",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        deliveryErrorCode: "timeout_unknown",
        messageBody: "Hello",
        deliveryAttemptCount: 1,
        nextAttemptAt: new Date(now.getTime() + INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS).toISOString(),
      },
    ];
    const store = outboxStore(messages);
    await drainInstagramOutbox({
      store,
      recipientId: "12334",
      conversationId: "convo-1",
      now,
    });
    expect(send).not.toHaveBeenCalled();
    expect(messages[0]?.deliveryStatus).toBe("pending");
    send.mockRestore();
  });

  it("drains only the reserved outbound IDs without a due-table scan", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [
      {
        id: "out-reserved",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "Hello",
        deliveryAttemptCount: 0,
      },
      {
        id: "out-other",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "Later",
        deliveryAttemptCount: 0,
      },
    ];
    const store = outboxStore(messages);
    const listDue = vi.spyOn(store, "listDueInstagramOutbounds");
    await drainInstagramOutbox({
      store,
      recipientId: "12334",
      conversationId: "convo-1",
      reserved: [
        {
          id: "out-reserved",
          idempotencyKey: "ig:1",
          deliveryStatus: "pending",
          claimed: true,
        },
      ],
      effects: [{ type: "send_text", text: "Hello", promptKey: "awaiting_persona" }],
    });
    expect(listDue).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(messages[0]?.deliveryStatus).toBe("sent");
    expect(messages[1]?.deliveryStatus).toBe("pending");
    send.mockRestore();
  });

  it("keeps typing on until every newly reserved send attempt finishes, then typing_off once", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.sender_action) order.push(String(body.sender_action));
      return new Response("{}", { status: 200 });
    });
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockImplementation(async (options) => {
      order.push(`send:${options.text}`);
      return { ok: true, metaMessageId: `mid.${options.text}`, recipientId: "12334" };
    });
    const messages = [
      {
        id: "out-a",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "First",
        deliveryAttemptCount: 0,
      },
      {
        id: "out-b",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "Second",
        deliveryAttemptCount: 0,
      },
    ];
    const attending = startInstagramAttendingIndicators({
      recipientId: "12334",
      config: {
        accessToken: "token",
        accountId: "17841400008460000",
        graphVersion: "v23.0",
      },
      deps: { fetchImpl },
    });
    await drainInstagramOutbox({
      store: outboxStore(messages),
      recipientId: "12334",
      conversationId: "convo-1",
      sendDeps: { fetchImpl },
      attending,
      typingMode: "off_only",
      reserved: [
        { id: "out-a", idempotencyKey: "ig:a", deliveryStatus: "pending", claimed: true },
        { id: "out-b", idempotencyKey: "ig:b", deliveryStatus: "pending", claimed: true },
      ],
      effects: [
        { type: "send_text", text: "First", promptKey: "one" },
        { type: "send_text", text: "Second", promptKey: "two" },
      ],
    });
    expect(order.filter((item) => item.startsWith("send:"))).toEqual(["send:First", "send:Second"]);
    expect(order.filter((item) => item === "typing_off")).toHaveLength(1);
    expect(order.indexOf("send:First")).toBeLessThan(order.indexOf("typing_off"));
    expect(order.indexOf("send:Second")).toBeLessThan(order.indexOf("typing_off"));
    send.mockRestore();
  });

  it("sends typing_off once when claim throws before Graph send", async () => {
    const actions: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.sender_action) actions.push(String(body.sender_action));
      return new Response("{}", { status: 200 });
    });
    const send = vi.spyOn(instagramSend, "sendInstagramText");
    const store = outboxStore([
      {
        id: "out-1",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "Hello",
        deliveryAttemptCount: 0,
      },
    ]);
    store.claimInstagramOutboundSend = async () => {
      throw new Error("claim failed");
    };
    const attending = startInstagramAttendingIndicators({
      recipientId: "12334",
      config: {
        accessToken: "token",
        accountId: "17841400008460000",
        graphVersion: "v23.0",
      },
      deps: { fetchImpl },
    });
    await expect(
      drainInstagramOutbox({
        store,
        recipientId: "12334",
        conversationId: "convo-1",
        attending,
        typingMode: "off_only",
        reserved: [
          { id: "out-1", idempotencyKey: "ig:1", deliveryStatus: "pending", claimed: true },
        ],
        effects: [{ type: "send_text", text: "Hello", promptKey: "awaiting_persona" }],
      }),
    ).rejects.toThrow("claim failed");
    expect(send).not.toHaveBeenCalled();
    expect(actions.filter((action) => action === "typing_off")).toHaveLength(1);
    send.mockRestore();
  });

  it("sends typing_off once when drain persist throws", async () => {
    const actions: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.sender_action) actions.push(String(body.sender_action));
      return new Response("{}", { status: 200 });
    });
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const store = outboxStore([
      {
        id: "out-1",
        conversationId: "convo-1",
        direction: "outbound",
        channel: "instagram",
        deliveryStatus: "pending",
        messageBody: "Hello",
        deliveryAttemptCount: 0,
      },
    ]);
    store.markOutboundMessage = async () => {
      throw new Error("persist failed");
    };
    const attending = startInstagramAttendingIndicators({
      recipientId: "12334",
      config: {
        accessToken: "token",
        accountId: "17841400008460000",
        graphVersion: "v23.0",
      },
      deps: { fetchImpl },
    });
    await expect(
      drainInstagramOutbox({
        store,
        recipientId: "12334",
        conversationId: "convo-1",
        attending,
        typingMode: "off_only",
        reserved: [
          { id: "out-1", idempotencyKey: "ig:1", deliveryStatus: "pending", claimed: true },
        ],
        effects: [{ type: "send_text", text: "Hello", promptKey: "awaiting_persona" }],
      }),
    ).rejects.toThrow("persist failed");
    expect(actions.filter((action) => action === "typing_off")).toHaveLength(1);
  });
});
