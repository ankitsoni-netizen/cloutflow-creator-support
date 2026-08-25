import { describe, expect, it, vi } from "vitest";
import { emptyConversationSnapshot } from "@/lib/meta/conversation-machine";
import {
  createSupabaseInstagramStore,
  type OutboundReserveInput,
} from "@/lib/meta/instagram-store";
import {
  applyReserveInstagramOutboundAndSnapshot,
  CONVERSATION_STATE_CONFLICT,
  instagramOutboundAddressesAreAssigned,
  instagramOutboundSenderAddress,
  OUTBOUND_ADDRESS_INVALID,
  OUTBOUND_IDEMPOTENCY_CONFLICT,
  parseReserveRpcError,
} from "@/lib/meta/instagram-reserve";
import type { SupabaseClient } from "@supabase/supabase-js";

const ACCOUNT_ID = "17841400008460000";
const CREATOR_IGSID = "12334";

function snapshot(_lastProcessed: string | null, messageId = "mid.next") {
  return {
    ...emptyConversationSnapshot(),
    state: "awaiting_persona",
    lastProcessedExternalMessageId: messageId,
    lastActivityAt: "2026-08-25T12:00:00.000Z",
    lastPromptKey: "awaiting_persona",
  };
}

function outbound(overrides: Partial<OutboundReserveInput> = {}): OutboundReserveInput {
  return {
    channel: "instagram",
    recipientExternalId: CREATOR_IGSID,
    senderAddress: ACCOUNT_ID,
    messageBody: "How can I help?",
    idempotencyKey: "ig:convo-1:v0:awaiting_persona",
    purpose: "awaiting_persona",
    ticketId: null,
    routingKind: "support",
    ...overrides,
  };
}

describe("reserve Instagram outbound and snapshot", () => {
  it("lets one writer win and rejects the other stale snapshot as retryable", () => {
    const conversation = {
      id: "convo-1",
      lastProcessedExternalMessageId: null as string | null,
    };
    const ids = { n: 0 };
    const nextId = () => `out-${++ids.n}`;
    const first = applyReserveInstagramOutboundAndSnapshot({
      conversation,
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [outbound({ idempotencyKey: "ig:convo-1:v0:a" })],
      existingMessages: [],
      nextId,
    });
    expect(first.outcome).toBe("reserved");
    if (first.outcome !== "reserved") return;
    conversation.lastProcessedExternalMessageId =
      first.conversation.lastProcessedExternalMessageId;
    const second = applyReserveInstagramOutboundAndSnapshot({
      conversation,
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.b"),
      lastMessageAt: "2026-08-25T12:00:01.000Z",
      displayName: null,
      outbounds: [outbound({ idempotencyKey: "ig:convo-1:v0:b" })],
      existingMessages: first.insertedMessages,
      nextId,
    });
    expect(second).toEqual({
      outcome: "failed",
      errorCode: CONVERSATION_STATE_CONFLICT,
    });
    expect(conversation.lastProcessedExternalMessageId).toBe("mid.a");
    expect(parseReserveRpcError({ message: CONVERSATION_STATE_CONFLICT })).toBe(
      CONVERSATION_STATE_CONFLICT,
    );
  });

  it("processes the second message after reload from the winning snapshot", () => {
    const conversation = {
      id: "convo-1",
      lastProcessedExternalMessageId: "mid.a",
    };
    const firstOutbound = {
      id: "out-1",
      conversationId: "convo-1",
      channel: "instagram",
      direction: "outbound" as const,
      senderName: "Cloutflow",
      senderAddress: ACCOUNT_ID,
      recipientExternalId: CREATOR_IGSID,
      messageBody: "How can I help?",
      purpose: "awaiting_persona",
      ticketId: null,
      idempotencyKey: "ig:convo-1:v0:a",
      deliveryStatus: "pending",
      routingKind: "support",
    };
    const retried = applyReserveInstagramOutboundAndSnapshot({
      conversation,
      expectedLastProcessedExternalMessageId: "mid.a",
      snapshot: snapshot("mid.a", "mid.b"),
      lastMessageAt: "2026-08-25T12:00:01.000Z",
      displayName: null,
      outbounds: [
        outbound({
          idempotencyKey: "ig:convo-1:v0:b",
          purpose: "awaiting_creator_reason",
          messageBody: "What brings you here?",
        }),
      ],
      existingMessages: [firstOutbound],
      nextId: () => "out-2",
    });
    expect(retried.outcome).toBe("reserved");
    if (retried.outcome !== "reserved") return;
    expect(retried.conversation.lastProcessedExternalMessageId).toBe("mid.b");
    expect(retried.insertedMessages).toHaveLength(1);
    expect(retried.outbounds[0]?.claimed).toBe(true);
  });

  it("accepts a duplicate idempotency key for the same outbound", () => {
    const existing = {
      id: "out-1",
      conversationId: "convo-1",
      channel: "instagram",
      direction: "outbound" as const,
      senderName: "Cloutflow",
      senderAddress: ACCOUNT_ID,
      recipientExternalId: CREATOR_IGSID,
      messageBody: "How can I help?",
      purpose: "awaiting_persona",
      ticketId: null,
      idempotencyKey: "ig:convo-1:v0:awaiting_persona",
      deliveryStatus: "pending",
      routingKind: "support",
    };
    const result = applyReserveInstagramOutboundAndSnapshot({
      conversation: {
        id: "convo-1",
        lastProcessedExternalMessageId: null,
      },
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [outbound()],
      existingMessages: [existing],
      nextId: () => "out-2",
    });
    expect(result.outcome).toBe("reserved");
    if (result.outcome !== "reserved") return;
    expect(result.outbounds[0]).toMatchObject({
      id: "out-1",
      claimed: false,
    });
    expect(result.insertedMessages).toHaveLength(0);
  });

  it("rejects the same key when conversation, recipient, body, purpose, routing, or ticket differ", () => {
    const existing = {
      id: "out-1",
      conversationId: "convo-1",
      channel: "instagram",
      direction: "outbound" as const,
      senderName: "Cloutflow",
      senderAddress: ACCOUNT_ID,
      recipientExternalId: CREATOR_IGSID,
      messageBody: "How can I help?",
      purpose: "awaiting_persona",
      ticketId: null as string | null,
      idempotencyKey: "ig:convo-1:v0:awaiting_persona",
      deliveryStatus: "pending",
      routingKind: "support",
    };

    const cases: Array<[string, Partial<typeof existing>, Partial<OutboundReserveInput>]> = [
      ["conversation", { conversationId: "convo-other" }, {}],
      ["recipient", { recipientExternalId: "99999" }, {}],
      ["body", {}, { messageBody: "A different prompt" }],
      ["purpose", { purpose: "awaiting_creator_reason" }, {}],
      ["routing_kind", { routingKind: "collaboration" }, {}],
      ["ticket", { ticketId: "ticket-1" }, {}],
    ];

    for (const [, existingPatch, outboundPatch] of cases) {
      const result = applyReserveInstagramOutboundAndSnapshot({
        conversation: {
          id: "convo-1",
          lastProcessedExternalMessageId: null,
        },
        expectedLastProcessedExternalMessageId: null,
        snapshot: snapshot(null, "mid.a"),
        lastMessageAt: "2026-08-25T12:00:00.000Z",
        displayName: null,
        outbounds: [outbound(outboundPatch)],
        existingMessages: [{ ...existing, ...existingPatch }],
        nextId: () => "out-2",
      });
      expect(result).toEqual({
        outcome: "failed",
        errorCode: OUTBOUND_IDEMPOTENCY_CONFLICT,
      });
    }
  });

  it("maps outbound sender to the Instagram account and recipient to the creator IGSID", () => {
    const result = applyReserveInstagramOutboundAndSnapshot({
      conversation: {
        id: "convo-1",
        lastProcessedExternalMessageId: null,
      },
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [outbound()],
      existingMessages: [],
      nextId: () => "out-1",
    });
    expect(result.outcome).toBe("reserved");
    if (result.outcome !== "reserved") return;
    expect(result.insertedMessages[0]?.senderAddress).toBe(ACCOUNT_ID);
    expect(result.insertedMessages[0]?.recipientExternalId).toBe(CREATOR_IGSID);
    expect(result.insertedMessages[0]?.senderAddress).not.toBe(
      result.insertedMessages[0]?.recipientExternalId,
    );
    expect(
      instagramOutboundSenderAddress({
        recipientAccountId: ACCOUNT_ID,
        env: { META_IG_ACCOUNT_ID: "should-not-override" },
      }),
    ).toBe(ACCOUNT_ID);
    expect(
      instagramOutboundSenderAddress({
        recipientAccountId: null,
        env: { META_IG_ACCOUNT_ID: ACCOUNT_ID },
      }),
    ).toBe(ACCOUNT_ID);
    expect(
      instagramOutboundAddressesAreAssigned({
        senderAddress: ACCOUNT_ID,
        recipientExternalId: CREATOR_IGSID,
      }),
    ).toBe(true);
    expect(
      instagramOutboundAddressesAreAssigned({
        senderAddress: CREATOR_IGSID,
        recipientExternalId: CREATOR_IGSID,
      }),
    ).toBe(false);
  });

  it("rejects missing or swapped Instagram outbound addresses", () => {
    const missingSender = applyReserveInstagramOutboundAndSnapshot({
      conversation: {
        id: "convo-1",
        lastProcessedExternalMessageId: null,
      },
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [outbound({ senderAddress: null })],
      existingMessages: [],
      nextId: () => "out-1",
    });
    expect(missingSender).toEqual({
      outcome: "failed",
      errorCode: OUTBOUND_ADDRESS_INVALID,
    });

    const swapped = applyReserveInstagramOutboundAndSnapshot({
      conversation: {
        id: "convo-1",
        lastProcessedExternalMessageId: null,
      },
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [
        outbound({
          senderAddress: CREATOR_IGSID,
          recipientExternalId: CREATOR_IGSID,
        }),
      ],
      existingMessages: [],
      nextId: () => "out-1",
    });
    expect(swapped).toEqual({
      outcome: "failed",
      errorCode: OUTBOUND_ADDRESS_INVALID,
    });
  });

  it("keeps snapshot and reservation atomic when a later outbound conflicts", () => {
    const conversation = {
      id: "convo-1",
      lastProcessedExternalMessageId: null as string | null,
    };
    const existingOther = {
      id: "out-other",
      conversationId: "convo-other",
      channel: "instagram",
      direction: "outbound" as const,
      senderName: "Cloutflow",
      senderAddress: ACCOUNT_ID,
      recipientExternalId: CREATOR_IGSID,
      messageBody: "Stolen key",
      purpose: "awaiting_persona",
      ticketId: null,
      idempotencyKey: "ig:conflict-key",
      deliveryStatus: "pending",
      routingKind: "support",
    };
    const result = applyReserveInstagramOutboundAndSnapshot({
      conversation,
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [
        outbound({ idempotencyKey: "ig:ok-key" }),
        outbound({
          idempotencyKey: "ig:conflict-key",
          messageBody: "How can I help?",
        }),
      ],
      existingMessages: [existingOther],
      nextId: () => "out-new",
    });
    expect(result).toEqual({
      outcome: "failed",
      errorCode: OUTBOUND_IDEMPOTENCY_CONFLICT,
    });
    expect(conversation.lastProcessedExternalMessageId).toBeNull();
  });

  it("passes expected last processed id and sender address to the reserve rpc", async () => {
    const captured: { args: Record<string, unknown> | null } = { args: null };
    const supabase = {
      async rpc(_name: string, args: Record<string, unknown>) {
        captured.args = args;
        return {
          data: {
            outbounds: [
              {
                id: "out-1",
                idempotency_key: "ig:k",
                delivery_status: "pending",
                claimed: true,
              },
            ],
          },
          error: null,
        };
      },
      from() {
        throw new Error("js fallback should not run");
      },
    } as unknown as SupabaseClient;
    const store = createSupabaseInstagramStore(supabase);
    const reserved = await store.reserveOutboundAndSnapshot({
      conversationId: "convo-1",
      expectedLastProcessedExternalMessageId: "mid.old",
      snapshot: snapshot("mid.old", "mid.new"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [outbound({ idempotencyKey: "ig:k" })],
    });
    expect(reserved.outcome).toBe("reserved");
    expect(captured.args?.p_expected_last_processed_external_message_id).toBe(
      "mid.old",
    );
    expect(captured.args?.p_last_processed_external_message_id).toBe("mid.new");
    const payload = (
      captured.args?.p_outbounds as Array<Record<string, unknown>> | undefined
    )?.[0];
    expect(payload?.sender_address).toBe(ACCOUNT_ID);
    expect(payload?.recipient_external_id).toBe(CREATOR_IGSID);
  });

  it("does not fall through to the js path on a sanitized conversation conflict", async () => {
    const supabase = {
      async rpc() {
        return {
          data: null,
          error: { message: "conversation_state_conflict", code: "P0001" },
        };
      },
      from() {
        throw new Error("js fallback should not run");
      },
    } as unknown as SupabaseClient;
    const store = createSupabaseInstagramStore(supabase);
    const reserved = await store.reserveOutboundAndSnapshot({
      conversationId: "convo-1",
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.a"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [outbound()],
    });
    expect(reserved).toEqual({
      outcome: "failed",
      errorCode: CONVERSATION_STATE_CONFLICT,
    });
  });

  it("does not log identifiers, keys, or message bodies for reserve conflicts", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyReserveInstagramOutboundAndSnapshot({
      conversation: {
        id: "convo-1",
        lastProcessedExternalMessageId: "mid.already",
      },
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null, "mid.next"),
      lastMessageAt: "2026-08-25T12:00:00.000Z",
      displayName: null,
      outbounds: [
        outbound({
          idempotencyKey: "ig:prompt:convo-secret:v1:awaiting_persona",
          messageBody: "secret creator email riya@example.com",
        }),
      ],
      existingMessages: [],
      nextId: () => "out-1",
    });
    const logged = [...error.mock.calls, ...info.mock.calls, ...warn.mock.calls]
      .map((call) => JSON.stringify(call))
      .join(" ");
    expect(logged).not.toContain("riya@example.com");
    expect(logged).not.toContain("ig:prompt:convo-secret");
    expect(logged).not.toContain(ACCOUNT_ID);
    expect(logged).not.toContain(CREATOR_IGSID);
    expect(logged).not.toContain("mid.already");
    error.mockRestore();
    info.mockRestore();
    warn.mockRestore();
  });
});
