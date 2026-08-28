import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER, META_WEBHOOK_EVENT_RECEIVED } from "@/lib/meta/constants";
import {
  IDENTITY_AMBIGUOUS,
  IDENTITY_MISSING,
  instagramExternalConversationId,
} from "@/lib/meta/conversation-identity";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import {
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
} from "@/lib/meta/instagram-persona-copy";
import * as instagramSend from "@/lib/meta/instagram-send";
import { handleInstagramWebhookPost } from "@/lib/meta/instagram-webhook";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import {
  instagramPostbackPayload,
  instagramTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import { NextRequest } from "next/server";

const PAGE = "17841400008460000";
const SENDER = "12334";
const VERIFY_TOKEN = "meta-ig-verify-token";
const APP_SECRET = "meta-app-secret-test";
const CONTEXT = { webhookPayload: { object: "instagram" } };

function testEnv(): Record<string, string | undefined> {
  return {
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: APP_SECRET,
  };
}

function sign(raw: string): string {
  const hex = createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex");
  return `sha256=${hex}`;
}

function signedPost(body: unknown): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/webhooks/meta/instagram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw),
    },
    body: raw,
  });
}

function mockSends() {
  vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.prompt",
    recipientId: SENDER,
  });
  vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.text",
    recipientId: SENDER,
  });
}

function eventFromPayload(payload: unknown): NormalizedMetaInboundText {
  const events = normalizeMetaWebhookPayload(payload).filter(
    (item) => item.channel === "instagram",
  );
  expect(events).toHaveLength(1);
  return events[0]!;
}

function awaitingPersonaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "convo-canonical",
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    recipientAccountId: PAGE,
    externalContactId: SENDER,
    externalConversationId: instagramExternalConversationId(PAGE, SENDER),
    identityStatus: "unambiguous",
    state: "awaiting_persona",
    ticketId: null,
    collectedData: {},
    routingIntent: "unclassified",
    lastProcessedExternalMessageId: "mid.hi",
    intakeSessionVersion: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Instagram failed-event retry lifecycle", () => {
  it("transitions from awaiting_persona on the first valid persona-selection delivery", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryChatbotStore());
    const hi = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.hi",
        text: "Hi",
      }),
    );
    const first = await ingestInstagramInboundMessage(hi, store, CONTEXT);
    expect(first.outcome).toBe("stored");
    const afterHi = await reloadConversationSnapshot(
      store,
      "instagram",
      hi.externalConversationId,
      identityLookupFromEvent(hi),
    );
    expect(afterHi.state).toBe("awaiting_persona");

    const persona = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.persona",
        text: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const selected = await ingestInstagramInboundMessage(persona, store, CONTEXT);
    expect(selected.outcome).toBe("stored");
    const afterPersona = await reloadConversationSnapshot(
      store,
      "instagram",
      persona.externalConversationId,
      identityLookupFromEvent(persona),
    );
    expect(afterPersona.state).toBe("awaiting_creator_reason");
    expect(afterPersona.collected.igPersona).toBe("creator");
    expect(
      store.messages.filter((row) => row.direction === "outbound"),
    ).toHaveLength(2);
  });

  it("reclaims a prior identity_ambiguous failure once canonical identity is unambiguous", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryChatbotStore());
    store.conversations.push(
      awaitingPersonaRow(),
      awaitingPersonaRow({
        id: "convo-legacy",
        externalConversationId: SENDER,
      }),
    );
    const persona = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.persona",
        text: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const first = await ingestInstagramInboundMessage(persona, store, CONTEXT);
    expect(first).toEqual({
      outcome: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(store.events[0]).toMatchObject({
      processingStatus: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(store.conversations.map((row) => row.state)).toEqual([
      "awaiting_persona",
      "awaiting_persona",
    ]);
    expect(store.tickets).toHaveLength(0);
    expect(
      store.messages.filter((row) => row.direction === "outbound"),
    ).toHaveLength(0);

    store.conversations.splice(
      store.conversations.findIndex((row) => row.id === "convo-legacy"),
      1,
    );

    const retry = await ingestInstagramInboundMessage(persona, store, CONTEXT);
    expect(retry.outcome).toBe("stored");
    const snapshot = await reloadConversationSnapshot(
      store,
      "instagram",
      persona.externalConversationId,
      identityLookupFromEvent(persona),
    );
    expect(snapshot.state).toBe("awaiting_creator_reason");
    expect(store.events[0]?.processingStatus).toBe("completed");
    expect(
      store.messages.filter((row) => row.direction === "outbound"),
    ).toHaveLength(1);
    expect(store.tickets).toHaveLength(0);

    const again = await ingestInstagramInboundMessage(persona, store, CONTEXT);
    expect(again.outcome).toBe("duplicate");
    expect(
      store.messages.filter((row) => row.direction === "outbound"),
    ).toHaveLength(1);
    expect(
      store.messages.filter((row) => row.externalMessageId === "mid.persona"),
    ).toHaveLength(1);
  });

  it("lets only one concurrent retry process a failed event", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryChatbotStore());
    store.conversations.push(awaitingPersonaRow());
    store.events.push({
      id: "evt-failed",
      provider: META_INSTAGRAM_PROVIDER,
      externalEventId: "mid.persona",
      processingStatus: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
      processedAt: null,
    });
    const persona = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.persona",
        text: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const [first, second] = await Promise.all([
      ingestInstagramInboundMessage(persona, store, CONTEXT),
      ingestInstagramInboundMessage(persona, store, CONTEXT),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["duplicate", "stored"]);
    expect(
      store.messages.filter((row) => row.direction === "outbound"),
    ).toHaveLength(1);
    expect(store.tickets).toHaveLength(0);
    const snapshot = await reloadConversationSnapshot(
      store,
      "instagram",
      persona.externalConversationId,
      identityLookupFromEvent(persona),
    );
    expect(snapshot.state).toBe("awaiting_creator_reason");
  });

  it("fails closed for a crafted missing sender without sending or transitioning", async () => {
    mockSends();
    const store = createMemoryChatbotStore();
    const event = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.missing",
        text: "Hi",
      }),
    );
    const result = await ingestInstagramInboundMessage(
      { ...event, externalContactId: "", senderAddress: "" },
      store,
      CONTEXT,
    );
    expect(result).toEqual({ outcome: "failed", errorCode: IDENTITY_MISSING });
    expect(store.conversations).toHaveLength(0);
    expect(store.tickets).toHaveLength(0);
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
    expect(instagramSend.sendInstagramText).not.toHaveBeenCalled();
  });

  it("fails closed for a crafted sender/recipient mismatch without sending", async () => {
    mockSends();
    const store = createMemoryChatbotStore();
    const event = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.mismatch",
        text: "Hi",
      }),
    );
    const result = await ingestInstagramInboundMessage(
      {
        ...event,
        recipientAccountId: SENDER,
        externalConversationId: instagramExternalConversationId(SENDER, SENDER),
      },
      store,
      CONTEXT,
    );
    expect(result).toEqual({ outcome: "failed", errorCode: IDENTITY_MISSING });
    expect(store.conversations).toHaveLength(0);
    expect(store.tickets).toHaveLength(0);
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
    expect(instagramSend.sendInstagramText).not.toHaveBeenCalled();
  });

  it("keeps genuine ambiguity fail-closed after reclaim and does not send", async () => {
    mockSends();
    const store = createMemoryChatbotStore();
    store.conversations.push(
      awaitingPersonaRow(),
      awaitingPersonaRow({
        id: "convo-legacy",
        externalConversationId: SENDER,
      }),
    );
    const persona = eventFromPayload(
      instagramTextPayload({
        senderId: SENDER,
        recipientId: PAGE,
        mid: "mid.persona",
        text: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    await ingestInstagramInboundMessage(persona, store, CONTEXT);
    const retry = await ingestInstagramInboundMessage(persona, store, CONTEXT);
    expect(retry).toEqual({
      outcome: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(store.conversations.every((row) => row.state === "awaiting_persona")).toBe(
      true,
    );
    expect(store.tickets).toHaveLength(0);
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });
});

describe("Instagram webhook HTTP class for failed events", () => {
  it("returns 200 and does not reprocess a completed event retry", async () => {
    mockSends();
    const store = createMemoryChatbotStore();
    const payload = instagramTextPayload({
      senderId: SENDER,
      recipientId: PAGE,
      mid: "mid.hi",
      text: "Hi",
    });
    const first = await handleInstagramWebhookPost(signedPost(payload), {
      env: testEnv(),
      instagramStore: store,
    });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    const outboundAfterFirst = store.messages.filter(
      (row) => row.direction === "outbound",
    ).length;

    const retry = await handleInstagramWebhookPost(signedPost(payload), {
      env: testEnv(),
      instagramStore: store,
    });
    expect(retry.status).toBe(200);
    expect(await retry.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(
      store.messages.filter((row) => row.direction === "outbound"),
    ).toHaveLength(outboundAfterFirst);
    expect(store.events[0]?.processingStatus).toBe("completed");
  });

  it("acknowledges terminal identity_ambiguous with 200 and does not log ids", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ingestSpy = vi
      .spyOn(await import("@/lib/meta/instagram-ingest"), "ingestInstagramInboundMessage")
      .mockResolvedValue({ outcome: "failed", errorCode: IDENTITY_AMBIGUOUS });
    const payload = instagramTextPayload({
      senderId: SENDER,
      recipientId: PAGE,
      mid: "mid.persona",
      text: PERSONA_CREATOR_TITLE,
      quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
    });
    const response = await handleInstagramWebhookPost(signedPost(payload), {
      env: testEnv(),
      instagramStore: createMemoryChatbotStore(),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("identity_ambiguous");
    expect(logged).not.toContain("mid.persona");
    expect(logged).not.toContain(SENDER);
    expect(logged).not.toContain(PAGE);
    ingestSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns 500 for persistence failures so Meta can retry", async () => {
    const ingestSpy = vi
      .spyOn(await import("@/lib/meta/instagram-ingest"), "ingestInstagramInboundMessage")
      .mockResolvedValue({
        outcome: "failed",
        errorCode: "conversation_lookup_failed",
      });
    const response = await handleInstagramWebhookPost(
      signedPost(
        instagramTextPayload({
          senderId: SENDER,
          recipientId: PAGE,
          mid: "mid.hi",
          text: "Hi",
        }),
      ),
      { env: testEnv(), instagramStore: createMemoryChatbotStore() },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Unable to process event");
    ingestSpy.mockRestore();
  });

  it("acknowledges missing sender/recipient envelopes without sending", async () => {
    mockSends();
    const ingestSpy = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const missing = await handleInstagramWebhookPost(
      signedPost({
        object: "instagram",
        entry: [
          {
            id: PAGE,
            time: 1603059206000,
            messaging: [
              {
                sender: {},
                recipient: { id: PAGE },
                timestamp: 1603059206000,
                message: { mid: "mid.missing", text: "Hi" },
              },
            ],
          },
        ],
      }),
      { env: testEnv(), instagramStore: createMemoryChatbotStore() },
    );
    const mismatch = await handleInstagramWebhookPost(
      signedPost(
        instagramTextPayload({
          senderId: PAGE,
          recipientId: PAGE,
          mid: "mid.mismatch",
          text: "Hi",
        }),
      ),
      { env: testEnv(), instagramStore: createMemoryChatbotStore() },
    );
    expect(missing.status).toBe(200);
    expect(mismatch.status).toBe(200);
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
    ingestSpy.mockRestore();
  });

  it("accepts an Instagram postback persona selection on first delivery through the webhook", async () => {
    mockSends();
    const store = withDurableConversationPersistence(createMemoryChatbotStore());
    const hi = await handleInstagramWebhookPost(
      signedPost(
        instagramTextPayload({
          senderId: SENDER,
          recipientId: PAGE,
          mid: "mid.hi",
          text: "Hi",
        }),
      ),
      { env: testEnv(), instagramStore: store },
    );
    expect(hi.status).toBe(200);
    const postback = await handleInstagramWebhookPost(
      signedPost(
        instagramPostbackPayload({
          senderId: SENDER,
          recipientId: PAGE,
          mid: "mid.persona.postback",
          title: PERSONA_CREATOR_TITLE,
          payload: PERSONA_CREATOR_PAYLOAD,
        }),
      ),
      { env: testEnv(), instagramStore: store },
    );
    expect(postback.status).toBe(200);
    const snapshot = await reloadConversationSnapshot(
      store,
      "instagram",
      instagramExternalConversationId(PAGE, SENDER),
      {
        externalContactId: SENDER,
        provider: META_INSTAGRAM_PROVIDER,
        recipientAccountId: PAGE,
      },
    );
    expect(snapshot.state).toBe("awaiting_creator_reason");
  });
});
