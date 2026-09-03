import { describe, expect, it } from "vitest";
import { applyReserveWatiOutboundAndSnapshot } from "@/lib/wati/reserve";
import { emptyConversationSnapshot } from "@/lib/meta/conversation-machine";
import {
  CONVERSATION_STATE_CONFLICT,
  OUTBOUND_IDEMPOTENCY_CONFLICT,
} from "@/lib/meta/instagram-reserve";

const CONVERSATION = "convo-wati";

function snapshot(lastProcessed: string | null, messageId = "wamid.next") {
  return {
    ...emptyConversationSnapshot(),
    state: "awaiting_creator_reason",
    lastProcessedExternalMessageId: messageId,
    lastActivityAt: "2026-09-03T10:00:00.000Z",
    lastPromptKey: "awaiting_persona",
  };
}

describe("applyReserveWatiOutboundAndSnapshot", () => {
  it("does not mutate conversation or insert outbound on OCC failure", () => {
    const conversation = {
      id: CONVERSATION,
      lastProcessedExternalMessageId: "wamid.old",
      channel: "whatsapp",
      provider: "wati",
    };
    const result = applyReserveWatiOutboundAndSnapshot({
      conversation,
      expectedLastProcessedExternalMessageId: null,
      snapshot: snapshot(null),
      lastMessageAt: "2026-09-03T10:00:00.000Z",
      displayName: null,
      outbounds: [
        {
          channel: "whatsapp",
          recipientExternalId: "16315551181",
          messageBody: "Hello",
          idempotencyKey: "wa:convo:v0:awaiting_persona",
          purpose: "awaiting_persona",
        },
      ],
      existingMessages: [],
      nextId: () => "out-1",
    });
    expect(result).toEqual({
      outcome: "failed",
      errorCode: CONVERSATION_STATE_CONFLICT,
    });
    expect(conversation.lastProcessedExternalMessageId).toBe("wamid.old");
  });

  it("rejects a colliding prompt body as idempotency conflict without inserting", () => {
    const result = applyReserveWatiOutboundAndSnapshot({
      conversation: {
        id: CONVERSATION,
        lastProcessedExternalMessageId: "wamid.old",
        channel: "whatsapp",
        provider: "wati",
      },
      expectedLastProcessedExternalMessageId: "wamid.old",
      snapshot: snapshot("wamid.old", "wamid.next"),
      lastMessageAt: "2026-09-03T10:00:00.000Z",
      displayName: null,
      outbounds: [
        {
          channel: "whatsapp",
          recipientExternalId: "16315551181",
          messageBody: "Changed",
          idempotencyKey: "wa:convo:v0:awaiting_persona",
          purpose: "awaiting_persona",
        },
      ],
      existingMessages: [
        {
          id: "out-existing",
          conversationId: CONVERSATION,
          channel: "whatsapp",
          direction: "outbound",
          senderName: "Cloutflow",
          senderAddress: null,
          recipientExternalId: "16315551181",
          messageBody: "Original",
          purpose: "awaiting_persona",
          ticketId: null,
          idempotencyKey: "wa:convo:v0:awaiting_persona",
          deliveryStatus: "pending",
          routingKind: "support",
        },
      ],
      nextId: () => "out-2",
    });
    expect(result).toEqual({
      outcome: "failed",
      errorCode: OUTBOUND_IDEMPOTENCY_CONFLICT,
    });
  });
});
