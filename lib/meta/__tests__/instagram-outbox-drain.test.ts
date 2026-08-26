import { describe, expect, it, vi } from "vitest";
import {
  drainDueInstagramOutbox,
  drainInstagramOutbox,
  INSTAGRAM_OUTBOX_GRAPH_BUDGET_MS,
  INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS,
} from "@/lib/meta/instagram-outbox";
import { handleInstagramOutboxDrain } from "@/lib/meta/instagram-outbox-drain";
import { POST } from "@/app/api/internal/meta/instagram-outbox/drain/route";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import * as instagramSend from "@/lib/meta/instagram-send";
import {
  instagramMemoryEmailOutbox,
  instagramMemoryOutbox,
} from "@/lib/meta/__tests__/instagram-memory-outbox";
import { NextRequest } from "next/server";
import { personaQuickReplies } from "@/lib/meta/instagram-persona-machine";
import { personaWelcomeText } from "@/lib/meta/instagram-persona-copy";

const DRAIN_SECRET = "ig-outbox-drain-test-secret";
const DRAIN_ENV = { INSTAGRAM_OUTBOX_DRAIN_SECRET: DRAIN_SECRET };

function outboxStore(
  messages: Array<Record<string, unknown>>,
  emails: Array<Record<string, unknown>> = [],
): InstagramIngestStore {
  return {
    messages,
    emails,
    async markOutboundMessage(id: string, patch: Record<string, unknown>) {
      const row = messages.find((message) => message.id === id);
      if (!row) return;
      row.outboundClaimed = false;
      Object.assign(row, patch);
    },
    async markEmailDelivery(id: string, patch: Record<string, unknown>) {
      const row = emails.find((email) => email.id === id);
      if (!row) return;
      Object.assign(row, patch);
    },
    async listSupportTranscript() {
      return [];
    },
    ...instagramMemoryOutbox(messages),
    ...instagramMemoryEmailOutbox(emails),
  } as unknown as InstagramIngestStore;
}

function pendingPersonaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "out-1",
    conversationId: "convo-1",
    direction: "outbound",
    channel: "instagram",
    recipientExternalId: "12334",
    deliveryStatus: "pending",
    messageBody: personaWelcomeText(null),
    deliveryAttemptCount: 0,
    rawPayload: {
      text: personaWelcomeText(null),
      quick_replies: personaQuickReplies(),
    },
    ...overrides,
  };
}

describe("Instagram outbox drain endpoint", () => {
  it("rejects missing authorization with 401", async () => {
    const result = await handleInstagramOutboxDrain({
      authorization: null,
      env: DRAIN_ENV,
      store: outboxStore([]),
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
  });

  it("rejects the wrong bearer secret with 401", async () => {
    const result = await handleInstagramOutboxDrain({
      authorization: "Bearer wrong-secret",
      env: DRAIN_ENV,
      store: outboxStore([pendingPersonaRow()]),
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 from the route without a secret", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/internal/meta/instagram-outbox/drain",
      { method: "POST" },
    );
    const response = await POST(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("drains eligible rows and returns counts only", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [pendingPersonaRow()];
    const result = await handleInstagramOutboxDrain({
      authorization: `Bearer ${DRAIN_SECRET}`,
      env: DRAIN_ENV,
      store: outboxStore(messages),
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body).toEqual({
      claimed: 1,
      sent: 1,
      retryable: 0,
      terminal: 0,
      email: { claimed: 0, sent: 0, retryable: 0, terminal: 0 },
    });
    expect(Object.keys(result.body).sort()).toEqual([
      "claimed",
      "email",
      "retryable",
      "sent",
      "terminal",
    ]);
    expect(JSON.stringify(result.body)).not.toContain("12334");
    expect(JSON.stringify(result.body)).not.toContain(personaWelcomeText(null));
    expect(JSON.stringify(result.body)).not.toContain("out-1");
    expect(JSON.stringify(result.body)).not.toContain("Bearer");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.quickReplies).toEqual(personaQuickReplies());
    expect(messages[0]?.deliveryStatus).toBe("sent");
    send.mockRestore();
  });

  it("does not let concurrent drain calls double-send", async () => {
    const send = vi
      .spyOn(instagramSend, "sendInstagramQuickReplies")
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, metaMessageId: "mid.out", recipientId: "12334" };
      });
    const messages = [pendingPersonaRow()];
    const store = outboxStore(messages);
    const [first, second] = await Promise.all([
      handleInstagramOutboxDrain({
        authorization: `Bearer ${DRAIN_SECRET}`,
        env: DRAIN_ENV,
        store,
      }),
      handleInstagramOutboxDrain({
        authorization: `Bearer ${DRAIN_SECRET}`,
        env: DRAIN_ENV,
        store,
      }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const claimed =
      (first.status === 200 ? first.body.claimed : 0) +
      (second.status === 200 ? second.body.claimed : 0);
    expect(claimed).toBe(1);
    send.mockRestore();
  });

  it("keeps timeout_unknown pending until the 30-second grace elapses", async () => {
    const now = new Date("2026-08-26T10:00:00.000Z");
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [
      pendingPersonaRow({
        rawPayload: null,
        deliveryErrorCode: "timeout_unknown",
        deliveryAttemptCount: 1,
        nextAttemptAt: new Date(now.getTime() + INSTAGRAM_OUTBOX_TIMEOUT_GRACE_MS).toISOString(),
      }),
    ];
    const result = await handleInstagramOutboxDrain({
      authorization: `Bearer ${DRAIN_SECRET}`,
      env: DRAIN_ENV,
      store: outboxStore(messages),
      now,
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(messages[0]?.deliveryStatus).toBe("pending");
    send.mockRestore();
  });

  it("does not reclaim terminal Graph rows", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [
      pendingPersonaRow({
        rawPayload: null,
        deliveryStatus: "failed",
        deliveryErrorCode: "http_401",
        deliveryAttemptCount: 1,
      }),
    ];
    const result = await handleInstagramOutboxDrain({
      authorization: `Bearer ${DRAIN_SECRET}`,
      env: DRAIN_ENV,
      store: outboxStore(messages),
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("does not reclaim exhausted rows", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [
      pendingPersonaRow({
        rawPayload: null,
        deliveryStatus: "failed",
        deliveryErrorCode: "outbound_attempts_exhausted",
        deliveryAttemptCount: 5,
      }),
    ];
    const result = await handleInstagramOutboxDrain({
      authorization: `Bearer ${DRAIN_SECRET}`,
      env: DRAIN_ENV,
      store: outboxStore(messages),
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("stops claiming Graph rows when the drain budget is exhausted and still runs email", async () => {
    let nowMs = 0;
    const clock = { nowMs: () => nowMs };
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockImplementation(async () => {
      nowMs += INSTAGRAM_OUTBOX_GRAPH_BUDGET_MS;
      return { ok: true, metaMessageId: "mid.out", recipientId: "12334" };
    });
    const messages = [
      pendingPersonaRow({
        id: "out-1",
        rawPayload: null,
        messageBody: "First",
      }),
      pendingPersonaRow({
        id: "out-2",
        rawPayload: null,
        messageBody: "Second",
      }),
    ];
    const result = await handleInstagramOutboxDrain({
      authorization: `Bearer ${DRAIN_SECRET}`,
      env: DRAIN_ENV,
      store: outboxStore(messages),
      clock,
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.claimed).toBe(1);
    expect(result.body.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(messages[0]?.deliveryStatus).toBe("sent");
    expect(messages[1]?.deliveryStatus).toBe("pending");
    send.mockRestore();
  });
});

describe("Instagram outbox recovery send", () => {
  it("sends a legacy plain-text row as text", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const qr = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.qr",
      recipientId: "12334",
    });
    const messages = [
      pendingPersonaRow({
        messageBody: "Thanks, we queued that for the team.",
        rawPayload: null,
      }),
    ];
    await drainInstagramOutbox({
      store: outboxStore(messages),
      recipientId: "12334",
      conversationId: "convo-1",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.text).toBe("Thanks, we queued that for the team.");
    expect(qr).not.toHaveBeenCalled();
    send.mockRestore();
    qr.mockRestore();
  });

  it("reconstructs the original persona buttons from the reserved payload", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    const messages = [pendingPersonaRow()];
    await drainDueInstagramOutbox({ store: outboxStore(messages) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.quickReplies).toEqual(personaQuickReplies());
    expect(send.mock.calls[0]?.[0]?.text).toBe(personaWelcomeText(null));
    send.mockRestore();
  });
});
