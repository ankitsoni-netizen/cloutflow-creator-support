import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
  reduceInstagramConversation,
  type MachineResult,
} from "@/lib/meta/conversation-machine";
import {
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_ISSUE_CATEGORY_TEXT,
  PERSONA_CREATOR_PAYLOAD,
} from "@/lib/meta/instagram-persona-copy";
import {
  INTAKE_CANCELLED_TEXT,
  INTAKE_RESTARTED_TEXT,
  PLATFORM_DETAILS_PROMPT_TEXT,
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  ROUTING_CLARIFY_TEXT,
  WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT,
  WHATSAPP_INTAKE_COPY,
  WHATSAPP_ROUTING_QUESTION_TEXT,
} from "@/lib/meta/routing-copy";

function signal(
  text: string,
  overrides: { messageId?: string; payload?: string | null } = {},
) {
  return {
    text,
    quickReplyPayload: overrides.payload ?? null,
    timestamp: "2026-08-25T10:00:00.000Z",
    messageId: overrides.messageId ?? `mid.${text.slice(0, 16)}`,
  };
}

function sendText(result: MachineResult): string | undefined {
  const effect = result.effects.find(
    (item) => item.type === "send_text" || item.type === "send_quick_replies",
  );
  return effect && "text" in effect ? effect.text : undefined;
}

function quickReplyTitles(result: MachineResult): string[] {
  const effect = result.effects.find((item) => item.type === "send_quick_replies");
  if (!effect || effect.type !== "send_quick_replies") return [];
  return (effect.quickReplies ?? []).map((reply) => reply.title);
}

function assertSameChoice(
  wati: MachineResult,
  instagram: MachineResult,
) {
  expect(wati.snapshot.state).toBe(instagram.snapshot.state);
  expect(wati.snapshot.routingIntent).toBe(instagram.snapshot.routingIntent);
  expect(wati.snapshot.currentIntakeField).toBe(
    instagram.snapshot.currentIntakeField,
  );
  expect(sendText(wati)).toBe(sendText(instagram));
  expect(quickReplyTitles(wati)).toEqual(quickReplyTitles(instagram));
  expect(wati.effects.map((effect) => effect.type)).toEqual(
    instagram.effects.map((effect) => effect.type),
  );
}

describe("WATI WhatsApp end-to-end parity with the shared conversation machine", () => {
  it("covers routing, intake, re-prompt, ticket, restart, cancel, and follow-up", () => {
    const start = emptyConversationSnapshot({
      suggestedPhone: "+16315551181",
    });
    const first = reduceChannelConversation(
      start,
      signal("Need help with a campaign", { messageId: "wamid.first" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(first.snapshot.state).toBe("awaiting_route");
    expect(sendText(first)).toBe(WHATSAPP_ROUTING_QUESTION_TEXT);
    expect(quickReplyTitles(first)).toEqual([
      "Campaign / Collab",
      "Creator Support",
    ]);

    const collabFromPayload = reduceChannelConversation(
      first.snapshot,
      signal("Campaign / Collab", {
        messageId: "ig.collab",
        payload: ROUTE_COLLABORATION_PAYLOAD,
      }),
      WHATSAPP_INTAKE_COPY,
    );
    const collabFromWati = reduceChannelConversation(
      first.snapshot,
      signal("Campaign / Collab", { messageId: "wati.collab" }),
      WHATSAPP_INTAKE_COPY,
    );
    assertSameChoice(collabFromWati, collabFromPayload);
    expect(collabFromWati.snapshot.state).toBe("collaboration");
    expect(collabFromWati.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );

    const supportFromPayload = reduceChannelConversation(
      first.snapshot,
      signal("Creator Support", {
        messageId: "ig.support",
        payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      WHATSAPP_INTAKE_COPY,
    );
    const supportFromButton = reduceChannelConversation(
      first.snapshot,
      signal("Creator Support", { messageId: "wati.button" }),
      WHATSAPP_INTAKE_COPY,
    );
    const supportFromList = reduceChannelConversation(
      first.snapshot,
      signal("Creator Support", { messageId: "wati.list" }),
      WHATSAPP_INTAKE_COPY,
    );
    const supportTyped = reduceChannelConversation(
      first.snapshot,
      signal("Creator Support", { messageId: "wati.typed" }),
      WHATSAPP_INTAKE_COPY,
    );
    assertSameChoice(supportFromButton, supportFromPayload);
    assertSameChoice(supportFromList, supportFromPayload);
    assertSameChoice(supportTyped, supportFromPayload);
    expect(supportFromButton.snapshot.state).toBe("support_intake");
    expect(sendText(supportFromButton)).toBe(WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT);

    const unclear = reduceChannelConversation(
      first.snapshot,
      signal("maybe later", { messageId: "wamid.unclear" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(sendText(unclear)).toBe(ROUTING_CLARIFY_TEXT);
    expect(quickReplyTitles(unclear)).toEqual([
      "Campaign / Collab",
      "Creator Support",
    ]);

    const incomplete = reduceChannelConversation(
      supportFromButton.snapshot,
      signal("Riya Sharma", { messageId: "wamid.name-only" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(incomplete.snapshot.state).toBe("support_intake");
    expect(incomplete.snapshot.currentIntakeField).toBe("creator_details");
    expect(sendText(incomplete)).toBe("Please send a valid email address.");

    const creator = reduceChannelConversation(
      incomplete.snapshot,
      signal("riya@example.com", { messageId: "wamid.email" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(creator.snapshot.currentIntakeField).toBe("platform_details");
    expect(sendText(creator)).toBe(PLATFORM_DETAILS_PROMPT_TEXT);

    const platform = reduceChannelConversation(
      creator.snapshot,
      signal("Instagram, @riya_creates", { messageId: "wamid.platform" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(platform.snapshot.currentIntakeField).toBe("campaign_details");

    const created = reduceChannelConversation(
      platform.snapshot,
      signal("Acme, August 2026", { messageId: "wamid.campaign" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(created.snapshot.state).toBe("awaiting_month_confirmation");
    const confirmed = reduceChannelConversation(
      created.snapshot,
      signal("Yes", { messageId: "wamid.month.yes" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(confirmed.snapshot.state).toBe("ticket_open");
    expect(confirmed.effects.some((effect) => effect.type === "create_ticket")).toBe(
      true,
    );
    expect(confirmed.snapshot.collected.campaignName).toBeNull();

    const restart = reduceChannelConversation(
      creator.snapshot,
      signal("RESTART", { messageId: "wamid.restart" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(restart.snapshot.state).toBe("support_intake");
    expect(restart.snapshot.currentIntakeField).toBe("creator_details");
    expect(restart.snapshot.intakeSessionVersion).toBeGreaterThan(
      creator.snapshot.intakeSessionVersion,
    );
    expect(sendText(restart)).toBe(INTAKE_RESTARTED_TEXT);

    const cancelled = reduceChannelConversation(
      creator.snapshot,
      signal("CANCEL", { messageId: "wamid.cancel" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(cancelled.snapshot.state).toBe("cancelled");
    expect(sendText(cancelled)).toBe(INTAKE_CANCELLED_TEXT);

    const followUp = reduceChannelConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "open",
        ticketCode: "CF-2026-00001",
      }),
      signal("Following up", { messageId: "wamid.follow" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(followUp.snapshot.state).toBe("ticket_open");
    expect(followUp.effects).toEqual([{ type: "notify_help_inbound" }]);
    expect(followUp.attachTicketId).toBe("ticket-1");
  });

  it("covers Instagram issue-category selection from a WATI list title", () => {
    const menu = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.0" }),
    );
    const creator = reduceInstagramConversation(
      menu.snapshot,
      signal("I'm a creator", {
        messageId: "mid.1",
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const existing = reduceInstagramConversation(
      creator.snapshot,
      signal("Existing campaign", {
        messageId: "mid.2",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
    );
    expect(sendText(existing)).toBe(CREATOR_ISSUE_CATEGORY_TEXT);
    const fromPayload = reduceInstagramConversation(
      existing.snapshot,
      signal("Campaign issue", {
        messageId: "mid.3",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
    );
    const fromWati = reduceInstagramConversation(
      existing.snapshot,
      signal("Campaign issue", { messageId: "mid.3w" }),
    );
    assertSameChoice(fromWati, fromPayload);
    expect(fromWati.snapshot.state).toBe("creator_campaign_details");

    const details = reduceInstagramConversation(
      fromWati.snapshot,
      signal("Acme, August 2026, riya@example.com", {
        messageId: "mid.4",
      }),
    );
    expect(details.snapshot.state).toBe("awaiting_month_confirmation");
    const monthYes = reduceInstagramConversation(
      details.snapshot,
      signal("Yes", { messageId: "mid.month.yes" }),
    );
    expect(monthYes.snapshot.state).toBe("awaiting_post_completion");
    expect(monthYes.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
    expect(monthYes.snapshot.collected.campaignName).toBeNull();
  });
});
