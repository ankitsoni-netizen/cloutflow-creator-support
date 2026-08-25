import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import { INSTAGRAM_PERSONA_STATES } from "@/lib/meta/instagram-persona-machine";
import {
  AGENCY_DETAILS_TEXT,
  AGENCY_SEND_CONFIRMED_TEXT,
  AGENCY_SEND_PAYLOAD,
  BRAND_ACTION_TEXT,
  BRAND_BOOK_CALL_PAYLOAD,
  BRAND_BOOKING_TEXT,
  CREATOR_APPLY_TEXT,
  CREATOR_CAMPAIGN_DETAILS_TEXT,
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_ISSUE_DETAILS_TEXT,
  CREATOR_NEW_WORK_PAYLOAD,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  CREATOR_REASON_TEXT,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  CREATOR_TICKET_EDIT_PAYLOAD,
  FLOW_CANCEL_PAYLOAD,
  OTHER_INQUIRY_TEXT,
  OTHER_SEND_CONFIRMED_TEXT,
  OTHER_SEND_PAYLOAD,
  PERSONA_AGENCY_PAYLOAD,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_OTHER_PAYLOAD,
  POST_DONE_PAYLOAD,
  POST_DONE_TEXT,
  POST_MAIN_MENU_PAYLOAD,
  personaWelcomeText,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import {
  CREATOR_DETAILS_PROMPT_TEXT,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT,
  WHATSAPP_INTAKE_COPY,
  WHATSAPP_ROUTING_QUESTION_TEXT,
} from "@/lib/meta/routing-copy";

function signal(
  text: string,
  overrides: { messageId?: string; payload?: string | null; timestamp?: string } = {},
) {
  return {
    text,
    quickReplyPayload: overrides.payload ?? null,
    timestamp: overrides.timestamp ?? "2026-08-25T10:00:00.000Z",
    messageId: overrides.messageId ?? `mid.${text.slice(0, 12)}`,
  };
}

function sendTexts(result: ReturnType<typeof reduceInstagramConversation>): string[] {
  return result.effects
    .filter((effect) => "text" in effect)
    .map((effect) => ("text" in effect ? effect.text : ""));
}

function play(
  steps: Array<{ text: string; payload?: string | null; messageId?: string }>,
  start = emptyConversationSnapshot(),
) {
  let last: ReturnType<typeof reduceInstagramConversation> = {
    snapshot: start,
    effects: [],
    attachTicketId: null,
    inboundRoutingKind: "unclassified",
    processed: true,
  };
  for (const [index, step] of steps.entries()) {
    last = reduceInstagramConversation(
      last.snapshot,
      signal(step.text, {
        payload: step.payload ?? null,
        messageId: step.messageId ?? `mid.${index}`,
      }),
    );
  }
  return last;
}

function toPersona() {
  return play([{ text: "Hello", messageId: "mid.first" }]);
}

describe("Instagram persona routing state machine", () => {
  it("asks the persona menu on the first DM and does not create a ticket", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Need help with a campaign", { messageId: "mid.first" }),
    );
    expect(result.snapshot.state).toBe("awaiting_persona");
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(result.effects.find((effect) => effect.type === "send_quick_replies")).toMatchObject({
      type: "send_quick_replies",
      text: personaWelcomeText(null),
      promptKey: "awaiting_persona",
    });
    expect(result.attachTicketId).toBeNull();
  });

  it("uses a cached username in the welcome when available", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        suggestedSocialHandle: "riya_creates",
        collected: emptyConversationSnapshot().collected,
      }),
      signal("Hi", { messageId: "mid.first" }),
    );
    expect(sendTexts(result)[0]).toBe(personaWelcomeText("riya_creates"));
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

  it("does not treat menu or restart inside a longer description as a command", () => {
    const menued = toPersona();
    const creator = reduceInstagramConversation(
      menued.snapshot,
      signal("I'm a creator", { messageId: "mid.p", payload: PERSONA_CREATOR_PAYLOAD }),
    );
    const existing = reduceInstagramConversation(
      creator.snapshot,
      signal("Existing campaign", {
        messageId: "mid.e",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
    );
    const issue = reduceInstagramConversation(
      existing.snapshot,
      signal("Campaign issue", {
        messageId: "mid.i",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
    );
    const details = reduceInstagramConversation(
      issue.snapshot,
      signal("Summer Drop, Acme, August 2026, riya@example.com", { messageId: "mid.c" }),
    );
    const described = reduceInstagramConversation(
      details.snapshot,
      signal("Please restart my campaign and open the menu for the brand", {
        messageId: "mid.issue",
      }),
    );
    expect(described.snapshot.state).toBe("creator_confirmation");
    expect(described.snapshot.collected.issueDescription).toContain("restart my campaign");
  });

  it.each([
    ["I'm a creator", PERSONA_CREATOR_PAYLOAD, "awaiting_creator_reason", CREATOR_REASON_TEXT],
    ["I'm a brand", PERSONA_BRAND_PAYLOAD, "brand_action", BRAND_ACTION_TEXT],
    ["I'm an agency", PERSONA_AGENCY_PAYLOAD, "agency_details", AGENCY_DETAILS_TEXT],
    ["Something else", PERSONA_OTHER_PAYLOAD, "other_inquiry", OTHER_INQUIRY_TEXT],
  ] as const)("routes %s via payload", (title, payload, state, text) => {
    const chosen = play([
      { text: "Hi", messageId: "mid.0" },
      { text: title, payload, messageId: "mid.1" },
    ]);
    expect(chosen.snapshot.state).toBe(state);
    expect(sendTexts(chosen)).toContain(text);
    expect(chosen.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(chosen.snapshot.routingIntent).toBe("unclassified");
    if (title === "I'm a brand") expect(chosen.snapshot.collected.igPersona).toBe("brand");
    if (title === "I'm an agency") expect(chosen.snapshot.collected.igPersona).toBe("agency");
    if (title === "Something else") expect(chosen.snapshot.collected.igPersona).toBe("other");
  });

  it.each([
    ["i'm a creator", "awaiting_creator_reason"],
    ["creator", "awaiting_creator_reason"],
    ["i am a brand", "brand_action"],
    ["agency", "agency_details"],
    ["something else", "other_inquiry"],
  ])("accepts typed equivalent %s", (text, state) => {
    const chosen = play([
      { text: "Hi", messageId: "mid.0" },
      { text, messageId: "mid.1" },
    ]);
    expect(chosen.snapshot.state).toBe(state);
  });

  it("re-prompts invalid persona choices with a retry key including the inbound id", () => {
    const invalid = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I want a discount", messageId: "mid.bad" },
    ]);
    expect(invalid.snapshot.state).toBe("awaiting_persona");
    expect(invalid.effects[0]).toMatchObject({
      type: "send_quick_replies",
      text: personaWelcomeText(null),
      promptKey: "awaiting_persona:retry:mid.bad",
    });
  });

  it("completes creator apply without a ticket or email effect", () => {
    const done = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, messageId: "mid.1" },
      { text: "Work with Cloutflow", payload: CREATOR_NEW_WORK_PAYLOAD, messageId: "mid.2" },
    ]);
    expect(done.snapshot.state).toBe("awaiting_post_completion");
    expect(done.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(done.effects.some((effect) => effect.type === "queue_internal_email")).toBe(false);
    expect(sendTexts(done)[0]).toBe(withPostCompletionQuestion(CREATOR_APPLY_TEXT));
  });

  it("completes brand booking without a ticket or email", () => {
    const done = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a brand", payload: PERSONA_BRAND_PAYLOAD, messageId: "mid.1" },
      { text: "Book a call", payload: BRAND_BOOK_CALL_PAYLOAD, messageId: "mid.2" },
    ]);
    expect(done.snapshot.state).toBe("awaiting_post_completion");
    expect(done.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(sendTexts(done)[0]).toBe(withPostCompletionQuestion(BRAND_BOOKING_TEXT));
  });

  it("creates a campaign-issue ticket after confirmation", () => {
    const last = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, messageId: "mid.1" },
      {
        text: "Existing campaign",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
        messageId: "mid.2",
      },
      {
        text: "Campaign issue",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
        messageId: "mid.3",
      },
      {
        text: "Summer Drop, Acme, August 2026, riya@example.com",
        messageId: "mid.4",
      },
      { text: "Payment never arrived for the film", messageId: "mid.5" },
      { text: "Yes, raise it", payload: CREATOR_TICKET_CONFIRM_PAYLOAD, messageId: "mid.6" },
    ]);
    expect(last.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(1);
    expect(last.snapshot.collected.igIssueCategory).toBe("campaign");
    expect(last.snapshot.collected.issueType).toBe("other");
    expect(last.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(last.snapshot.collected.issueDescription).toBe("Payment never arrived for the film");
    expect(last.snapshot.state).toBe("awaiting_post_completion");
  });

  it("creates a payment-issue ticket after confirmation", () => {
    const last = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, messageId: "mid.1" },
      {
        text: "Existing campaign",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
        messageId: "mid.2",
      },
      { text: "Payment issue", payload: CREATOR_PAYMENT_ISSUE_PAYLOAD, messageId: "mid.3" },
      { text: "Summer Drop, Acme, Aug 2026, riya@example.com", messageId: "mid.4" },
      { text: "TDS was deducted twice", messageId: "mid.5" },
      { text: "yes", messageId: "mid.6" },
    ]);
    expect(last.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(1);
    expect(last.snapshot.collected.igIssueCategory).toBe("payment");
    expect(last.snapshot.collected.issueType).toBe("payment_delayed");
  });

  it("re-asks only missing campaign fields", () => {
    const partial = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, messageId: "mid.1" },
      {
        text: "Existing campaign",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
        messageId: "mid.2",
      },
      {
        text: "Campaign issue",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
        messageId: "mid.3",
      },
      { text: "Summer Drop, Acme", messageId: "mid.4" },
    ]);
    expect(partial.snapshot.state).toBe("creator_campaign_details");
    expect(partial.snapshot.collected.campaignName).toBe("Summer Drop");
    expect(partial.snapshot.collected.brandName).toBe("Acme");
    expect(sendTexts(partial)[0]).toContain("campaign month");
    expect(sendTexts(partial)[0]).toContain("email");
    expect(partial.effects[0]).toMatchObject({
      promptKey: "creator_campaign_details:retry:mid.4",
    });

    const filled = reduceInstagramConversation(
      partial.snapshot,
      signal("August 2026, riya@example.com", { messageId: "mid.5" }),
    );
    expect(filled.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(filled.snapshot.collected.email).toBe("riya@example.com");
    expect(sendTexts(filled)).toEqual([CREATOR_ISSUE_DETAILS_TEXT]);
  });

  it("edit preserves issue details and returns to campaign question 1", () => {
    const confirmed = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, messageId: "mid.1" },
      {
        text: "Existing campaign",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
        messageId: "mid.2",
      },
      {
        text: "Campaign issue",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
        messageId: "mid.3",
      },
      { text: "Old Campaign, Old Brand, 08/2026, old@example.com", messageId: "mid.4" },
      { text: "The brief changed twice", messageId: "mid.5" },
    ]);
    const edited = reduceInstagramConversation(
      confirmed.snapshot,
      signal("Edit details", {
        messageId: "mid.6",
        payload: CREATOR_TICKET_EDIT_PAYLOAD,
      }),
    );
    expect(edited.snapshot.state).toBe("creator_campaign_details");
    expect(edited.snapshot.collected.issueDescription).toBe("The brief changed twice");
    expect(edited.snapshot.collected.campaignName).toBeNull();
    expect(sendTexts(edited)).toEqual([CREATOR_CAMPAIGN_DETAILS_TEXT]);

    const updated = reduceInstagramConversation(
      edited.snapshot,
      signal("New Campaign, New Brand, 2026-08, new@example.com", { messageId: "mid.7" }),
    );
    expect(updated.snapshot.state).toBe("creator_confirmation");
    expect(updated.snapshot.collected.campaignName).toBe("New Campaign");
    expect(updated.snapshot.collected.issueDescription).toBe("The brief changed twice");
    expect(updated.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
  });

  it("cancel returns to the main menu without a ticket", () => {
    const confirmed = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, messageId: "mid.1" },
      {
        text: "Existing campaign",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
        messageId: "mid.2",
      },
      {
        text: "Campaign issue",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
        messageId: "mid.3",
      },
      { text: "Summer Drop, Acme, August 2026, riya@example.com", messageId: "mid.4" },
      { text: "The film was delayed", messageId: "mid.5" },
    ]);
    const cancelled = reduceInstagramConversation(
      confirmed.snapshot,
      signal("Cancel", { messageId: "mid.6", payload: FLOW_CANCEL_PAYLOAD }),
    );
    expect(cancelled.snapshot.state).toBe("awaiting_persona");
    expect(cancelled.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(cancelled.snapshot.collected.campaignName).toBeNull();
    expect(cancelled.snapshot.collected.issueDescription).toBeNull();
    expect(cancelled.snapshot.intakeSessionVersion).toBeGreaterThan(
      confirmed.snapshot.intakeSessionVersion,
    );
  });

  it("agency missing fields and invalid roster URL are re-asked", () => {
    const partial = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm an agency", payload: PERSONA_AGENCY_PAYLOAD, messageId: "mid.1" },
      { text: "North Star, Priya, priya@agency.test, not-a-url", messageId: "mid.2" },
    ]);
    expect(partial.snapshot.collected.agencyName).toBe("North Star");
    expect(partial.snapshot.collected.creatorName).toBe("Priya");
    expect(partial.snapshot.collected.email).toBe("priya@agency.test");
    expect(partial.snapshot.collected.rosterUrl).toBeNull();
    expect(sendTexts(partial)[0]).toContain("roster URL");

    const complete = reduceInstagramConversation(
      partial.snapshot,
      signal("https://northstar.test/roster", { messageId: "mid.3" }),
    );
    expect(complete.snapshot.state).toBe("agency_confirmation");
    expect(complete.snapshot.collected.rosterUrl).toContain("https://northstar.test/roster");
  });

  it("agency send queues one internal email and no ticket", () => {
    const sent = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm an agency", payload: PERSONA_AGENCY_PAYLOAD, messageId: "mid.1" },
      {
        text: "North Star, Priya, priya@agency.test, https://northstar.test/roster",
        messageId: "mid.2",
      },
      { text: "Send to team", payload: AGENCY_SEND_PAYLOAD, messageId: "mid.3" },
    ]);
    expect(sent.effects.filter((effect) => effect.type === "queue_internal_email")).toEqual([
      { type: "queue_internal_email", purpose: "agency" },
    ]);
    expect(sent.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(sendTexts(sent)[0]).toBe(withPostCompletionQuestion(AGENCY_SEND_CONFIRMED_TEXT));
  });

  it("other enquiry queues one internal email and no ticket", () => {
    const sent = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "Something else", payload: PERSONA_OTHER_PAYLOAD, messageId: "mid.1" },
      { text: "I need help with a partnership idea", messageId: "mid.2" },
      { text: "Asha, asha@example.com, +919876543210", messageId: "mid.3" },
      { text: "Yes, send it", payload: OTHER_SEND_PAYLOAD, messageId: "mid.4" },
    ]);
    expect(sent.snapshot.collected.inquiryDetails).toBe(
      "I need help with a partnership idea",
    );
    expect(sent.effects).toEqual(
      expect.arrayContaining([{ type: "queue_internal_email", purpose: "other" }]),
    );
    expect(sent.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(sendTexts(sent)[0]).toBe(withPostCompletionQuestion(OTHER_SEND_CONFIRMED_TEXT));
  });

  it("post-completion I'm done completes without resolving a ticket", () => {
    const done = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a brand", payload: PERSONA_BRAND_PAYLOAD, messageId: "mid.1" },
      { text: "Book a call", payload: BRAND_BOOK_CALL_PAYLOAD, messageId: "mid.2" },
      { text: "I'm done", payload: POST_DONE_PAYLOAD, messageId: "mid.3" },
    ]);
    expect(done.snapshot.state).toBe("completed");
    expect(sendTexts(done)).toEqual([POST_DONE_TEXT]);
    expect(done.snapshot.ticketId).toBeNull();
  });

  it("post-completion Main menu starts a fresh session", () => {
    const menu = play([
      { text: "Hi", messageId: "mid.0" },
      { text: "I'm a brand", payload: PERSONA_BRAND_PAYLOAD, messageId: "mid.1" },
      { text: "Book a call", payload: BRAND_BOOK_CALL_PAYLOAD, messageId: "mid.2" },
      { text: "Main menu", payload: POST_MAIN_MENU_PAYLOAD, messageId: "mid.3" },
    ]);
    expect(menu.snapshot.state).toBe("awaiting_persona");
    expect(menu.snapshot.intakeSessionVersion).toBeGreaterThan(0);
    expect(sendTexts(menu)[0]).toBe(personaWelcomeText(null));
  });

  it("attaches follow-ups to an active ticket unless menu/restart or post-completion is used", () => {
    const follow = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "open",
      }),
      signal("Following up", { messageId: "mid.follow" }),
    );
    expect(follow.snapshot.state).toBe("ticket_open");
    expect(follow.attachTicketId).toBe("ticket-1");
    expect(follow.effects).toEqual([{ type: "notify_help_inbound" }]);

    const restarted = reduceInstagramConversation(
      follow.snapshot,
      signal("restart", { messageId: "mid.restart" }),
    );
    expect(restarted.snapshot.state).toBe("awaiting_persona");
    expect(restarted.snapshot.ticketId).toBe("ticket-1");
    expect(restarted.effects.some((effect) => effect.type === "notify_help_inbound")).toBe(
      false,
    );
  });

  it("evaluates post-completion before the active-ticket shortcut", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "awaiting_post_completion",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "open",
        intakeSessionVersion: 2,
      }),
      signal("Main menu", {
        messageId: "mid.post",
        payload: POST_MAIN_MENU_PAYLOAD,
      }),
    );
    expect(result.snapshot.state).toBe("awaiting_persona");
    expect(result.effects.some((effect) => effect.type === "notify_help_inbound")).toBe(
      false,
    );
    expect(result.snapshot.ticketId).toBe("ticket-1");
  });

  it("restarts legacy non-ticket chatbot rows at the persona menu", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "support_intake",
        routingIntent: "creator_support",
        currentIntakeField: "platform_details",
        intakeSessionVersion: 1,
      }),
      signal("hello", { messageId: "mid.legacy" }),
    );
    expect(result.snapshot.state).toBe("awaiting_persona");
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(result.snapshot.intakeSessionVersion).toBe(2);
  });

  it("does not restart an open ticket conversation into the persona menu", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        ticketId: "ticket-1",
        ticketStatus: "open",
        routingIntent: "creator_support",
      }),
      signal("hello", { messageId: "mid.keep" }),
    );
    expect(result.snapshot.state).toBe("ticket_open");
    expect(result.attachTicketId).toBe("ticket-1");
  });

  it("asks the persona menu again after a resolved ticket", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "resolved",
      }),
      signal("New issue", { messageId: "mid.new" }),
    );
    expect(result.snapshot.state).toBe("awaiting_persona");
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
  });

  it.each([...INSTAGRAM_PERSONA_STATES])(
    "honours exact menu and restart at %s",
    (state) => {
      const snapshot = emptyConversationSnapshot({
        state,
        intakeSessionVersion: 3,
        collected: {
          ...emptyConversationSnapshot().collected,
          campaignName: "Keep-me-cleared",
          igPersona: "creator",
        },
      });
      for (const command of ["menu", "RESTART"] as const) {
        const result = reduceInstagramConversation(
          snapshot,
          signal(command, { messageId: `mid.${state}.${command}` }),
        );
        expect(result.snapshot.state).toBe("awaiting_persona");
        expect(result.snapshot.intakeSessionVersion).toBe(4);
        expect(result.snapshot.collected.campaignName).toBeNull();
        expect(result.snapshot.collected.igPersona).toBeNull();
        expect(sendTexts(result)[0]).toBe(personaWelcomeText(null));
      }
    },
  );
});

describe("WhatsApp routing copy adapter", () => {
  it("asks the WhatsApp routing question and prefills phone on Creator Support", () => {
    const first = reduceChannelConversation(
      emptyConversationSnapshot({ suggestedPhone: "+16315551181" }),
      signal("Need help with a campaign", { messageId: "wamid.first" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(first.snapshot.state).toBe("awaiting_route");
    expect(first.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
    expect(first.effects.find((effect) => effect.type === "send_quick_replies")).toMatchObject({
      text: WHATSAPP_ROUTING_QUESTION_TEXT,
    });

    const support = reduceChannelConversation(
      first.snapshot,
      signal("Creator Support", {
        messageId: "wamid.route",
        payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(support.snapshot.state).toBe("support_intake");
    expect(support.snapshot.collected.phoneNormalized).toBe("+16315551181");
    expect(support.snapshot.collected.phonePrefill).toBe(true);
    expect(support.snapshot.collected.creatorName).toBeNull();
    expect(support.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT }),
      ]),
    );
    expect(support.effects.map((effect) => ("text" in effect ? effect.text : ""))).not.toContain(
      CREATOR_DETAILS_PROMPT_TEXT,
    );
  });
});
