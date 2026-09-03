import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  reduceInstagramConversation,
  type MachineResult,
} from "@/lib/meta/conversation-machine";
import {
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_ISSUE_CATEGORY_TEXT,
  PERSONA_AGENCY_PAYLOAD,
  PERSONA_AGENCY_TITLE,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_BRAND_TITLE,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
  PERSONA_OTHER_PAYLOAD,
  PERSONA_OTHER_TITLE,
  personaWelcomeText,
} from "@/lib/meta/instagram-persona-copy";
import { personaQuickReplies } from "@/lib/meta/instagram-persona-machine";

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

function assertSameChoice(wati: MachineResult, instagram: MachineResult) {
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

describe("WATI WhatsApp end-to-end parity with the shared Instagram persona machine", () => {
  it("starts at the Instagram persona menu and treats typed, button, and list titles the same as payloads", () => {
    const first = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "wamid.first" }),
    );
    expect(first.snapshot.state).toBe("awaiting_persona");
    expect(sendText(first)).toBe(personaWelcomeText(null));
    expect(quickReplyTitles(first)).toEqual(
      personaQuickReplies().map((reply) => reply.title),
    );
    expect(first.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );

    const creatorFromPayload = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_CREATOR_TITLE, {
        messageId: "ig.creator",
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const creatorFromButton = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_CREATOR_TITLE, { messageId: "wati.button" }),
    );
    const creatorFromList = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_CREATOR_TITLE, { messageId: "wati.list" }),
    );
    const creatorTyped = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_CREATOR_TITLE, { messageId: "wati.typed" }),
    );
    assertSameChoice(creatorFromButton, creatorFromPayload);
    assertSameChoice(creatorFromList, creatorFromPayload);
    assertSameChoice(creatorTyped, creatorFromPayload);
    expect(creatorFromButton.snapshot.state).toBe("awaiting_creator_reason");

    const brand = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_BRAND_TITLE, { messageId: "wati.brand" }),
    );
    const brandPayload = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_BRAND_TITLE, {
        messageId: "ig.brand",
        payload: PERSONA_BRAND_PAYLOAD,
      }),
    );
    assertSameChoice(brand, brandPayload);
    expect(brand.snapshot.state).toBe("brand_action");

    const agency = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_AGENCY_TITLE, { messageId: "wati.agency" }),
    );
    const agencyPayload = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_AGENCY_TITLE, {
        messageId: "ig.agency",
        payload: PERSONA_AGENCY_PAYLOAD,
      }),
    );
    assertSameChoice(agency, agencyPayload);
    expect(agency.snapshot.state).toBe("agency_details");

    const other = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_OTHER_TITLE, { messageId: "wati.other" }),
    );
    const otherPayload = reduceInstagramConversation(
      first.snapshot,
      signal(PERSONA_OTHER_TITLE, {
        messageId: "ig.other",
        payload: PERSONA_OTHER_PAYLOAD,
      }),
    );
    assertSameChoice(other, otherPayload);
    expect(other.snapshot.state).toBe("other_inquiry");

    const midFlowHi = reduceInstagramConversation(
      creatorFromButton.snapshot,
      signal("Hi", { messageId: "wamid.hi.mid" }),
    );
    expect(midFlowHi.snapshot.state).toBe("awaiting_creator_reason");

    const restarted = reduceInstagramConversation(
      creatorFromButton.snapshot,
      signal("restart", { messageId: "wamid.restart" }),
    );
    expect(restarted.snapshot.state).toBe("awaiting_persona");
    expect(restarted.snapshot.intakeSessionVersion).toBeGreaterThan(
      creatorFromButton.snapshot.intakeSessionVersion,
    );

    const followUp = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "open",
        ticketCode: "CF-2026-00001",
      }),
      signal("Following up", { messageId: "wamid.follow" }),
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
    expect(monthYes.snapshot.state).toBe("creator_confirmation");
    expect(
      monthYes.effects.filter((effect) => effect.type === "create_ticket"),
    ).toHaveLength(0);
    expect(monthYes.snapshot.collected.campaignName).toBeNull();
  });
});
