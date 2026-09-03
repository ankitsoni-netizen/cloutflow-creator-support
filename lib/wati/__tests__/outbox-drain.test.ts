import { describe, expect, it, vi } from "vitest";
import { handleWatiOutboxDrain } from "@/lib/wati/outbox-drain";
import { POST } from "@/app/api/internal/wati/outbox/drain/route";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { watiMemoryOutbox } from "@/lib/meta/__tests__/wati-memory-outbox";
import * as watiSend from "@/lib/wati/send";
import { NextRequest } from "next/server";
import { WATI_TEST_CHANNEL, WATI_TEST_WA_ID } from "@/lib/wati/__tests__/fixtures";

const DRAIN_SECRET = "wati-outbox-drain-test-secret";
const DRAIN_ENV = { WATI_OUTBOX_DRAIN_SECRET: DRAIN_SECRET };

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

function pendingTextRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "out-1",
    conversationId: "convo-1",
    direction: "outbound",
    channel: "whatsapp",
    recipientExternalId: WATI_TEST_WA_ID,
    deliveryStatus: "pending",
    messageBody: "How can I help?",
    deliveryAttemptCount: 0,
    rawPayload: null,
    ...overrides,
  };
}

describe("WATI outbox drain endpoint", () => {
  it("rejects missing authorization with 401", async () => {
    const result = await handleWatiOutboxDrain({
      authorization: null,
      env: DRAIN_ENV,
      store: outboxStore([]),
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
  });

  it("rejects the wrong bearer secret with 401", async () => {
    const result = await handleWatiOutboxDrain({
      authorization: "Bearer wrong-secret",
      env: DRAIN_ENV,
      store: outboxStore([pendingTextRow()]),
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 from the route without a secret", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/internal/wati/outbox/drain",
      { method: "POST" },
    );
    const response = await POST(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("drains eligible rows and returns counts only", async () => {
    process.env.WHATSAPP_PROVIDER = "wati";
    process.env.WATI_CONVERSATION_TARGET_MODE = "recipient";
    process.env.WATI_CHANNEL_PHONE_NUMBER = WATI_TEST_CHANNEL;
    const send = vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.out",
      recipientId: WATI_TEST_WA_ID,
    });
    const messages = [pendingTextRow()];
    const result = await handleWatiOutboxDrain({
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
    });
    expect(Object.keys(result.body).sort()).toEqual([
      "claimed",
      "retryable",
      "sent",
      "terminal",
    ]);
    expect(JSON.stringify(result.body)).not.toContain("How can I help?");
    expect(JSON.stringify(result.body)).not.toContain(WATI_TEST_WA_ID);
    expect(send).toHaveBeenCalledTimes(1);
    expect(messages[0]?.deliveryStatus).toBe("sent");
    send.mockRestore();
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WATI_CONVERSATION_TARGET_MODE;
    delete process.env.WATI_CHANNEL_PHONE_NUMBER;
  });
});
