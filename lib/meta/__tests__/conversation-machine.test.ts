import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import {
  COLLABORATION_CONFIRMED_TEXT,
  CREATOR_SUPPORT_STARTED_TEXT,
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  ROUTING_QUESTION_TEXT,
} from "@/lib/meta/routing-copy";

function signal(
  text: string,
  overrides: { messageId?: string; payload?: string | null; timestamp?: string } = {},
) {
  return {
    text,
    quickReplyPayload: overrides.payload ?? null,
    timestamp: overrides.timestamp ?? "2026-08-25T10:00:00.000Z",
    messageId: overrides.messageId ?? `mid.${text.slice(0, 8)}`,
  };
}

describe("Instagram routing state machine", () => {
  it("asks the routing question on the first DM and does not create a ticket", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Need help with a campaign", { messageId: "mid.first" }),
    );
    expect(result.snapshot.state).toBe("awaiting_route");
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
    const prompt = result.effects.find(
      (effect) => effect.type === "send_quick_replies",
    );
    expect(prompt).toMatchObject({
      type: "send_quick_replies",
      text: ROUTING_QUESTION_TEXT,
    });
    expect(result.attachTicketId).toBeNull();
  });

  it("does not re-process the same inbound message id", () => {
    const first = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hello", { messageId: "mid.dup" }),
    );
    const second = reduceInstagramConversation(
      first.snapshot,
      signal("Hello", { messageId: "mid.dup" }),
    );
    expect(second.processed).toBe(false);
    expect(second.effects).toEqual([]);
  });

  it("records collaboration without creating a ticket", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const chosen = reduceInstagramConversation(
      routed.snapshot,
      signal("Campaign / Collaboration", {
        messageId: "mid.2",
        payload: ROUTE_COLLABORATION_PAYLOAD,
      }),
    );
    expect(chosen.snapshot.state).toBe("collaboration");
    expect(chosen.snapshot.routingIntent).toBe("collaboration");
    expect(chosen.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
    expect(chosen.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "send_text",
          text: COLLABORATION_CONFIRMED_TEXT,
        }),
      ]),
    );
  });

  it("reclassifies a collaboration conversation on SUPPORT", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const collab = reduceInstagramConversation(
      routed.snapshot,
      signal("collab", {
        messageId: "mid.2",
        payload: ROUTE_COLLABORATION_PAYLOAD,
      }),
    );
    const support = reduceInstagramConversation(
      collab.snapshot,
      signal("SUPPORT", { messageId: "mid.3" }),
    );
    expect(support.snapshot.state).toBe("support_intake");
    expect(support.snapshot.routingIntent).toBe("creator_support");
    expect(support.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: CREATOR_SUPPORT_STARTED_TEXT }),
      ]),
    );
  });

  it("starts intake when Creator Support is selected", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const support = reduceInstagramConversation(
      routed.snapshot,
      signal("Creator Support", {
        messageId: "mid.2",
        payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
    );
    expect(support.snapshot.state).toBe("support_intake");
    expect(support.snapshot.currentIntakeField).toBe("creator_name");
  });

  it("does not re-ask routing while a collaboration session is active", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const collab = reduceInstagramConversation(
      routed.snapshot,
      signal("collab", {
        messageId: "mid.2",
        payload: ROUTE_COLLABORATION_PAYLOAD,
      }),
    );
    const follow = reduceInstagramConversation(
      collab.snapshot,
      signal("Any update?", {
        messageId: "mid.3",
        timestamp: "2026-08-25T10:30:00.000Z",
      }),
    );
    expect(follow.snapshot.state).toBe("collaboration");
    expect(
      follow.effects.some(
        (effect) =>
          "text" in effect && effect.text === ROUTING_QUESTION_TEXT,
      ),
    ).toBe(false);
  });

  it("asks routing again after 24 hours of collaboration inactivity", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const collab = reduceInstagramConversation(
      routed.snapshot,
      signal("collab", {
        messageId: "mid.2",
        payload: ROUTE_COLLABORATION_PAYLOAD,
        timestamp: "2026-08-24T09:00:00.000Z",
      }),
    );
    const later = reduceInstagramConversation(
      collab.snapshot,
      signal("Hello again", {
        messageId: "mid.3",
        timestamp: "2026-08-25T10:00:00.000Z",
      }),
    );
    expect(later.snapshot.state).toBe("awaiting_route");
  });

  it("attaches follow-ups to an active ticket without routing", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "open",
      }),
      signal("Following up", { messageId: "mid.follow" }),
    );
    expect(result.snapshot.state).toBe("ticket_open");
    expect(result.attachTicketId).toBe("ticket-1");
    expect(
      result.effects.some(
        (effect) =>
          "text" in effect && effect.text === ROUTING_QUESTION_TEXT,
      ),
    ).toBe(false);
  });

  it("asks routing again after a resolved ticket receives a new message", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "resolved",
      }),
      signal("New issue", { messageId: "mid.new" }),
    );
    expect(result.snapshot.state).toBe("awaiting_route");
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
  });

  it("cancels intake without creating a ticket", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const support = reduceInstagramConversation(
      routed.snapshot,
      signal("support", {
        messageId: "mid.2",
        payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
    );
    const cancelled = reduceInstagramConversation(
      support.snapshot,
      signal("CANCEL", { messageId: "mid.3" }),
    );
    expect(cancelled.snapshot.state).toBe("cancelled");
    expect(
      cancelled.effects.some((effect) => effect.type === "create_ticket"),
    ).toBe(false);
  });

  it("restarts intake from the first field", () => {
    const routed = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.1" }),
    );
    const support = reduceInstagramConversation(
      routed.snapshot,
      signal("support", {
        messageId: "mid.2",
        payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
    );
    const named = reduceInstagramConversation(
      support.snapshot,
      signal("Riya Sharma", { messageId: "mid.3" }),
    );
    const restarted = reduceInstagramConversation(
      named.snapshot,
      signal("RESTART", { messageId: "mid.4" }),
    );
    expect(restarted.snapshot.state).toBe("support_intake");
    expect(restarted.snapshot.currentIntakeField).toBe("creator_name");
    expect(restarted.snapshot.collected.creatorName).toBeNull();
  });

  it("creates exactly one ticket effect on confirmation", () => {
    const answers: Array<[string, string, string | null]> = [
      ["Hi", "mid.0", null],
      ["Creator Support", "mid.route", ROUTE_CREATOR_SUPPORT_PAYLOAD],
      ["Riya Sharma", "mid.name", null],
      ["riya@example.com", "mid.email", null],
      ["+919876543210", "mid.phone", null],
      ["riya_creates", "mid.handle", null],
      ["payment delayed", "mid.issue", "PAYMENT_DELAYED"],
      ["I don't know", "mid.campaign", null],
      ["I don't know", "mid.brand", null],
      ["August 2026", "mid.month", null],
      ["I don't know", "mid.poc", null],
      ["I don't know", "mid.pocphone", null],
      ["Payment not received", "mid.desc", null],
      ["Confirm", "mid.confirm", "CONFIRM"],
    ];
    let last = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal(answers[0]![0], {
        messageId: answers[0]![1],
      }),
    );
    for (const [text, messageId, payload] of answers.slice(1)) {
      last = reduceInstagramConversation(
        last.snapshot,
        signal(text, { messageId, payload }),
      );
    }
    const creates = last.effects.filter((effect) => effect.type === "create_ticket");
    expect(creates).toHaveLength(1);
    expect(last.snapshot.collected.campaignName).toBeNull();
    expect(last.snapshot.collected.brandName).toBeNull();
    expect(last.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(last.snapshot.collected.email).toBe("riya@example.com");
  });
});
