import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  instagramEffectsProduceReply,
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
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_ISSUE_CATEGORY_TEXT,
  CREATOR_NEW_WORK_PAYLOAD,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  CREATOR_REASON_TEXT,
  FLOW_BACK_PAYLOAD,
  FLOW_BACK_TITLE,
  FLOW_CANCEL_PAYLOAD,
  INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
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
  activeTicketAttachText,
  personaWelcomeText,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import {
  CAMPAIGN_MONTH_NO_PAYLOAD,
  CAMPAIGN_MONTH_YES_PAYLOAD,
} from "@/lib/meta/month-confirmation";
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
    const start = emptyConversationSnapshot({
      state: "creator_issue_details",
      routingIntent: "creator_support",
      collected: {
        ...emptyConversationSnapshot().collected,
        brandName: "Acme",
        campaignMonth: "2026-08-01",
        campaignMonthConfirmed: true,
        email: "riya@example.com",
        igIssueCategory: "campaign",
      },
    });
    const described = reduceInstagramConversation(
      start,
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
        text: "Acme, August 2026, riya@example.com",
        messageId: "mid.4",
      },
      { text: "Yes", messageId: "mid.month.yes" },
    ]);
    expect(last.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(1);
    expect(last.snapshot.collected.igIssueCategory).toBe("campaign");
    expect(last.snapshot.collected.issueType).toBe("other");
    expect(last.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(last.snapshot.collected.campaignName).toBeNull();
    expect(last.snapshot.collected.brandName).toBe("Acme");
    expect(last.snapshot.collected.email).toBe("riya@example.com");
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
      { text: "Acme, Aug 2026, riya@example.com", messageId: "mid.4" },
      { text: "Yes", messageId: "mid.month.yes" },
    ]);
    expect(last.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(1);
    expect(last.snapshot.collected.igIssueCategory).toBe("payment");
    expect(last.snapshot.collected.issueType).toBe("payment_delayed");
    expect(last.snapshot.collected.campaignName).toBeNull();
    expect(last.snapshot.state).toBe("awaiting_post_completion");
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
      { text: "Acme", messageId: "mid.4" },
    ]);
    expect(partial.snapshot.state).toBe("creator_campaign_details");
    expect(partial.snapshot.collected.campaignName).toBeNull();
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
    expect(filled.snapshot.state).toBe("awaiting_month_confirmation");
    expect(filled.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(filled.snapshot.collected.email).toBe("riya@example.com");
    const monthYes = reduceInstagramConversation(
      filled.snapshot,
      signal("Yes", { messageId: "mid.month.yes" }),
    );
    expect(monthYes.snapshot.state).toBe("awaiting_post_completion");
    expect(monthYes.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
  });

  it("creates the ticket on month Yes without collecting a campaign name", () => {
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
      { text: "Old Brand, 08/2026, old@example.com", messageId: "mid.4" },
      { text: "Yes", messageId: "mid.month.yes" },
    ]);
    expect(last.snapshot.state).toBe("awaiting_post_completion");
    expect(last.snapshot.collected.campaignName).toBeNull();
    expect(last.snapshot.collected.brandName).toBe("Old Brand");
    expect(last.snapshot.collected.email).toBe("old@example.com");
    expect(last.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(1);
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
      { text: "Acme, August 2026, riya@example.com", messageId: "mid.4" },
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
    expect(instagramEffectsProduceReply(follow.effects)).toBe(false);
    expect(
      instagramEffectsProduceReply([{ type: "create_ticket" }]),
    ).toBe(true);
    expect(
      instagramEffectsProduceReply([
        { type: "send_text", text: INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT, promptKey: "retry" },
      ]),
    ).toBe(true);

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

  it.each(["image", "video", "audio", "sticker", "share", "attachment"] as const)(
    "keeps intake state for unsupported %s and sends the text-only fallback",
    (kind) => {
      const started = toPersona();
      const result = reduceInstagramConversation(started.snapshot, {
        text: `[${kind}]`,
        quickReplyPayload: null,
        timestamp: "2026-08-25T10:00:00.000Z",
        messageId: `mid.media.${kind}`,
        unsupportedKind: kind,
      });
      expect(result.snapshot.state).toBe("awaiting_persona");
      expect(sendTexts(result)).toEqual([INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT]);
      expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(
        false,
      );
    },
  );

  it("does not re-send the unsupported fallback for the same Meta message id", () => {
    const started = toPersona();
    const first = reduceInstagramConversation(started.snapshot, {
      text: "[image]",
      quickReplyPayload: null,
      timestamp: "2026-08-25T10:00:00.000Z",
      messageId: "mid.image.1",
      unsupportedKind: "image",
    });
    const second = reduceInstagramConversation(first.snapshot, {
      text: "[image]",
      quickReplyPayload: null,
      timestamp: "2026-08-25T10:00:01.000Z",
      messageId: "mid.image.1",
      unsupportedKind: "image",
    });
    expect(second.processed).toBe(false);
    expect(second.effects).toEqual([]);
  });

  it("recovers a stuck awaiting_route conversation to the persona menu without consuming the inbound", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "awaiting_route",
        routingIntent: "unclassified",
        intakeSessionVersion: 1,
      }),
      signal("I'm a creator", {
        messageId: "mid.legacy.route",
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    expect(result.snapshot.state).toBe("awaiting_persona");
    expect(sendTexts(result)[0]).toBe(personaWelcomeText(null));
    expect(result.snapshot.collected.igPersona).toBeNull();
  });

  it("explains an active ticket when existing-campaign support is chosen from the menu", () => {
    const menu = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "awaiting_post_completion",
        ticketId: "ticket-1",
        ticketStatus: "open",
        ticketCode: "CF-2026-00001",
      }),
      signal("menu", { messageId: "mid.menu" }),
    );
    expect(menu.snapshot.state).toBe("awaiting_persona");
    expect(menu.snapshot.ticketId).toBe("ticket-1");
    expect(menu.snapshot.ticketCode).toBe("CF-2026-00001");

    const creator = reduceInstagramConversation(
      menu.snapshot,
      signal("I'm a creator", {
        messageId: "mid.persona",
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const existing = reduceInstagramConversation(
      creator.snapshot,
      signal("Existing campaign", {
        messageId: "mid.existing",
        payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      }),
    );
    expect(existing.snapshot.state).toBe("awaiting_creator_issue_category");
    expect(sendTexts(existing)[0]).toContain(
      activeTicketAttachText("CF-2026-00001"),
    );
    expect(sendTexts(existing)[0]).toContain(CREATOR_ISSUE_CATEGORY_TEXT);
    expect(existing.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
  });

  it("asks for a labelled brand when remaining names are ambiguous", () => {
    const details = play(
      [
        { text: "Hello", messageId: "mid.first" },
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.persona",
        },
        {
          text: "Existing campaign",
          payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
          messageId: "mid.existing",
        },
        {
          text: "Campaign issue",
          payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
          messageId: "mid.issue",
        },
        {
          text: "Alpha, Beta, Gamma, August 2026, riya@example.com",
          messageId: "mid.campaign",
        },
      ],
    );
    expect(details.snapshot.state).toBe("awaiting_month_confirmation");
    expect(details.snapshot.collected.campaignName).toBeNull();
    const monthYes = reduceInstagramConversation(
      details.snapshot,
      signal("Yes", { messageId: "mid.month.yes" }),
    );
    expect(monthYes.snapshot.state).toBe("creator_campaign_details");
    expect(sendTexts(monthYes)[0]).toBe("Please send the brand name.");
    expect(monthYes.snapshot.collected.campaignName).toBeNull();
  });
});

describe("Instagram FLOW_BACK / Go back", () => {
  function quickRepliesOf(
    result: ReturnType<typeof reduceInstagramConversation>,
  ): Array<{ title: string; payload: string }> {
    const effect = result.effects.find(
      (item) => item.type === "send_quick_replies",
    );
    if (!effect || effect.type !== "send_quick_replies") return [];
    return (effect.quickReplies ?? []).map((reply) => ({
      title: reply.title,
      payload: reply.payload,
    }));
  }

  function hasGoBack(
    result: ReturnType<typeof reduceInstagramConversation>,
  ): boolean {
    return quickRepliesOf(result).some(
      (reply) =>
        reply.title === FLOW_BACK_TITLE && reply.payload === FLOW_BACK_PAYLOAD,
    );
  }

  function assertNoSideEffects(
    result: ReturnType<typeof reduceInstagramConversation>,
  ) {
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
    expect(
      result.effects.some((effect) => effect.type === "queue_internal_email"),
    ).toBe(false);
    expect(
      result.effects.some((effect) => effect.type === "notify_help_inbound"),
    ).toBe(false);
  }

  const backCases = [
    {
      from: "awaiting_creator_reason",
      to: "awaiting_persona",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.1",
        },
      ],
      preserved: { igPersona: "creator" },
    },
    {
      from: "awaiting_creator_issue_category",
      to: "awaiting_creator_reason",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.1",
        },
        {
          text: "Existing campaign",
          payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
          messageId: "mid.2",
        },
      ],
      preserved: {
        igPersona: "creator",
        igCreatorReason: "existing_campaign",
      },
    },
    {
      from: "creator_campaign_details",
      to: "awaiting_creator_issue_category",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.1",
        },
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
      ],
      preserved: {
        igPersona: "creator",
        igCreatorReason: "existing_campaign",
        igIssueCategory: "campaign",
      },
    },
    {
      from: "awaiting_month_confirmation",
      to: "creator_campaign_details",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.1",
        },
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
          text: "Acme, August 2026, riya@example.com",
          messageId: "mid.4",
        },
      ],
      preserved: {
        campaignName: null,
        brandName: "Acme",
        email: "riya@example.com",
      },
    },
    {
      from: "brand_action",
      to: "awaiting_persona",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm a brand",
          payload: PERSONA_BRAND_PAYLOAD,
          messageId: "mid.1",
        },
      ],
      preserved: { igPersona: "brand" },
    },
    {
      from: "agency_details",
      to: "awaiting_persona",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm an agency",
          payload: PERSONA_AGENCY_PAYLOAD,
          messageId: "mid.1",
        },
      ],
      preserved: { igPersona: "agency" },
    },
    {
      from: "agency_confirmation",
      to: "agency_details",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm an agency",
          payload: PERSONA_AGENCY_PAYLOAD,
          messageId: "mid.1",
        },
        {
          text: "North Star, Sam, sam@agency.com, https://example.com/roster",
          messageId: "mid.2",
        },
      ],
      preserved: {
        agencyName: "North Star",
        creatorName: "Sam",
        email: "sam@agency.com",
      },
    },
    {
      from: "other_inquiry",
      to: "awaiting_persona",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "Something else",
          payload: PERSONA_OTHER_PAYLOAD,
          messageId: "mid.1",
        },
      ],
      preserved: { igPersona: "other" },
    },
    {
      from: "other_contact",
      to: "other_inquiry",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "Something else",
          payload: PERSONA_OTHER_PAYLOAD,
          messageId: "mid.1",
        },
        { text: "I need help with my login", messageId: "mid.2" },
      ],
      preserved: { inquiryDetails: "I need help with my login" },
    },
    {
      from: "other_confirmation",
      to: "other_contact",
      setup: [
        { text: "Hi", messageId: "mid.0" },
        {
          text: "Something else",
          payload: PERSONA_OTHER_PAYLOAD,
          messageId: "mid.1",
        },
        { text: "I need help with my login", messageId: "mid.2" },
        {
          text: "Riya, riya@example.com, +919876543210",
          messageId: "mid.3",
        },
      ],
      preserved: {
        creatorName: "Riya",
        email: "riya@example.com",
        inquiryDetails: "I need help with my login",
      },
    },
  ] as const;

  it.each(backCases)(
    "FLOW_BACK from $from returns to $to and preserves collected values",
    (backCase) => {
      const atState = play([...backCase.setup]);
      expect(atState.snapshot.state).toBe(backCase.from);
      expect(hasGoBack(atState)).toBe(true);
      const version = atState.snapshot.intakeSessionVersion;
      const collectedBefore = { ...atState.snapshot.collected };

      const back = reduceInstagramConversation(
        atState.snapshot,
        signal("Go back", {
          messageId: `mid.back.${backCase.from}`,
          payload: FLOW_BACK_PAYLOAD,
        }),
      );
      expect(back.snapshot.state).toBe(backCase.to);
      expect(back.snapshot.intakeSessionVersion).toBe(version);
      expect(back.snapshot.collected).toEqual(collectedBefore);
      for (const [key, value] of Object.entries(backCase.preserved)) {
        expect(
          back.snapshot.collected[key as keyof typeof back.snapshot.collected],
        ).toBe(value);
      }
      expect(back.effects[0]).toMatchObject({
        promptKey: `${backCase.to}:back:mid.back.${backCase.from}`,
      });
      assertNoSideEffects(back);
      if (backCase.to === "awaiting_persona") {
        expect(hasGoBack(back)).toBe(false);
      } else {
        expect(hasGoBack(back)).toBe(true);
      }
    },
  );

  it.each(["back", "go back", "  Go Back  "] as const)(
    "accepts typed equivalent %s",
    (text) => {
      const atReason = play([
        { text: "Hi", messageId: "mid.0" },
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.1",
        },
      ]);
      const back = reduceInstagramConversation(
        atReason.snapshot,
        signal(text, { messageId: `mid.typed.${text.trim()}` }),
      );
      expect(back.snapshot.state).toBe("awaiting_persona");
      expect(back.effects[0]).toMatchObject({
        promptKey: `awaiting_persona:back:mid.typed.${text.trim()}`,
      });
      assertNoSideEffects(back);
    },
  );

  it.each([
    "please go back",
    "go back to the menu",
    "I want to go back now",
    "send me back",
  ])("does not treat longer sentence %s as Go back", (text) => {
    const atReason = play([
      { text: "Hi", messageId: "mid.0" },
      {
        text: "I'm a creator",
        payload: PERSONA_CREATOR_PAYLOAD,
        messageId: "mid.1",
      },
    ]);
    const result = reduceInstagramConversation(
      atReason.snapshot,
      signal(text, { messageId: `mid.long.${text.slice(0, 8)}` }),
    );
    expect(result.snapshot.state).toBe("awaiting_creator_reason");
    expect(result.effects[0]).toMatchObject({
      promptKey: expect.stringContaining("awaiting_creator_reason:retry:"),
    });
  });

  it("lets a new answer overwrite only the relevant fields after going back", () => {
    const awaiting = play([
      { text: "Hi", messageId: "mid.0" },
      {
        text: "I'm a creator",
        payload: PERSONA_CREATOR_PAYLOAD,
        messageId: "mid.1",
      },
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
        text: "Acme, August 2026, riya@example.com",
        messageId: "mid.4",
      },
    ]);
    const back = reduceInstagramConversation(
      awaiting.snapshot,
      signal("back", { messageId: "mid.back.month" }),
    );
    expect(back.snapshot.state).toBe("creator_campaign_details");
    expect(back.snapshot.collected.brandName).toBe("Acme");
    expect(back.snapshot.collected.email).toBe("riya@example.com");
    expect(back.snapshot.collected.campaignName).toBeNull();

    const revised = reduceInstagramConversation(
      back.snapshot,
      signal("July 2026", { messageId: "mid.revised" }),
    );
    expect(revised.snapshot.state).toBe("awaiting_month_confirmation");
    expect(revised.snapshot.collected.campaignMonth).toBe("2026-07-01");
    expect(revised.snapshot.collected.campaignName).toBeNull();
    expect(revised.snapshot.collected.email).toBe("riya@example.com");
    assertNoSideEffects(revised);
  });

  it("uses a navigation prompt key distinct from the original state prompt", () => {
    const atReason = play([
      { text: "Hi", messageId: "mid.0" },
      {
        text: "I'm a creator",
        payload: PERSONA_CREATOR_PAYLOAD,
        messageId: "mid.1",
      },
    ]);
    expect(atReason.snapshot.lastPromptKey).toBe("awaiting_creator_reason");
    const back = reduceInstagramConversation(
      atReason.snapshot,
      signal("Go back", {
        messageId: "mid.nav.1",
        payload: FLOW_BACK_PAYLOAD,
      }),
    );
    expect(back.snapshot.state).toBe("awaiting_persona");
    expect(back.snapshot.lastPromptKey).toBe("awaiting_persona:back:mid.nav.1");
    expect(back.effects[0]).toMatchObject({
      promptKey: "awaiting_persona:back:mid.nav.1",
    });

    const again = reduceInstagramConversation(
      back.snapshot,
      signal("I'm a creator", {
        messageId: "mid.nav.2",
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    const backAgain = reduceInstagramConversation(
      again.snapshot,
      signal("Go back", {
        messageId: "mid.nav.3",
        payload: FLOW_BACK_PAYLOAD,
      }),
    );
    expect(backAgain.snapshot.lastPromptKey).toBe(
      "awaiting_persona:back:mid.nav.3",
    );
    expect(backAgain.effects[0]).toMatchObject({
      promptKey: "awaiting_persona:back:mid.nav.3",
    });
  });

  it("does not show Go back on the initial persona menu or post-completion prompts", () => {
    const menu = toPersona();
    expect(menu.snapshot.state).toBe("awaiting_persona");
    expect(hasGoBack(menu)).toBe(false);
    expect(quickRepliesOf(menu).map((reply) => reply.payload)).toEqual([
      PERSONA_CREATOR_PAYLOAD,
      PERSONA_BRAND_PAYLOAD,
      PERSONA_AGENCY_PAYLOAD,
      PERSONA_OTHER_PAYLOAD,
    ]);

    const post = play([
      { text: "Hi", messageId: "mid.0" },
      {
        text: "I'm a brand",
        payload: PERSONA_BRAND_PAYLOAD,
        messageId: "mid.1",
      },
      {
        text: "Book a call",
        payload: BRAND_BOOK_CALL_PAYLOAD,
        messageId: "mid.2",
      },
    ]);
    expect(post.snapshot.state).toBe("awaiting_post_completion");
    expect(hasGoBack(post)).toBe(false);
    expect(quickRepliesOf(post).map((reply) => reply.payload)).toEqual([
      POST_MAIN_MENU_PAYLOAD,
      POST_DONE_PAYLOAD,
    ]);
  });

  it("keeps the active ticket linked when going back", () => {
    const withTicket = play(
      [
        {
          text: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
          messageId: "mid.1",
        },
        {
          text: "Existing campaign",
          payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
          messageId: "mid.2",
        },
      ],
      emptyConversationSnapshot({
        state: "awaiting_persona",
        ticketId: "ticket-1",
        ticketCode: "CF-2026-00001",
        ticketStatus: "open",
        intakeSessionVersion: 1,
      }),
    );
    expect(withTicket.snapshot.state).toBe("awaiting_creator_issue_category");
    expect(withTicket.snapshot.ticketId).toBe("ticket-1");
    const back = reduceInstagramConversation(
      withTicket.snapshot,
      signal("back", { messageId: "mid.back.ticket" }),
    );
    expect(back.snapshot.state).toBe("awaiting_creator_reason");
    expect(back.snapshot.ticketId).toBe("ticket-1");
    expect(back.snapshot.ticketCode).toBe("CF-2026-00001");
    expect(back.attachTicketId).toBe("ticket-1");
    assertNoSideEffects(back);
  });

  it("does not notify staff when back is typed on an open ticket conversation", () => {
    const result = reduceInstagramConversation(
      emptyConversationSnapshot({
        state: "ticket_open",
        routingIntent: "creator_support",
        ticketId: "ticket-1",
        ticketStatus: "open",
      }),
      signal("back", { messageId: "mid.ticket.back" }),
    );
    expect(result.snapshot.state).toBe("ticket_open");
    expect(result.snapshot.ticketId).toBe("ticket-1");
    expect(result.effects).toEqual([]);
    assertNoSideEffects(result);
  });

  it("leaves menu and restart behaviour unchanged", () => {
    const atReason = play([
      { text: "Hi", messageId: "mid.0" },
      {
        text: "I'm a creator",
        payload: PERSONA_CREATOR_PAYLOAD,
        messageId: "mid.1",
      },
    ]);
    const version = atReason.snapshot.intakeSessionVersion;
    const menu = reduceInstagramConversation(
      atReason.snapshot,
      signal("menu", { messageId: "mid.menu.unchanged" }),
    );
    expect(menu.snapshot.state).toBe("awaiting_persona");
    expect(menu.snapshot.intakeSessionVersion).toBe(version + 1);
    expect(menu.snapshot.collected.igPersona).toBeNull();
    expect(hasGoBack(menu)).toBe(false);

    const restarted = reduceInstagramConversation(
      atReason.snapshot,
      signal("restart", { messageId: "mid.restart.unchanged" }),
    );
    expect(restarted.snapshot.state).toBe("awaiting_persona");
    expect(restarted.snapshot.intakeSessionVersion).toBe(version + 1);
  });

  it("preserves original action button payloads and appends Go back", () => {
    const confirmation = play([
      { text: "Hi", messageId: "mid.0" },
      {
        text: "I'm a creator",
        payload: PERSONA_CREATOR_PAYLOAD,
        messageId: "mid.1",
      },
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
        text: "Acme, August 2026, riya@example.com",
        messageId: "mid.4",
      },
    ]);
    expect(quickRepliesOf(confirmation).map((reply) => reply.payload)).toEqual([
      CAMPAIGN_MONTH_YES_PAYLOAD,
      CAMPAIGN_MONTH_NO_PAYLOAD,
      FLOW_BACK_PAYLOAD,
    ]);
    expect(quickRepliesOf(confirmation).map((reply) => reply.title)).toEqual([
      "Yes",
      "No",
      FLOW_BACK_TITLE,
    ]);
  });
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

  it("does not gain Instagram FLOW_BACK behaviour", () => {
    const first = reduceChannelConversation(
      emptyConversationSnapshot({ suggestedPhone: "+16315551181" }),
      signal("Need help", { messageId: "wamid.first" }),
      WHATSAPP_INTAKE_COPY,
    );
    const back = reduceChannelConversation(
      first.snapshot,
      signal("back", { messageId: "wamid.back" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(back.snapshot.state).toBe("awaiting_route");
    expect(back.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
    const effect = back.effects.find((item) => item.type === "send_quick_replies");
    expect(effect && "quickReplies" in effect ? effect.quickReplies : []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: FLOW_BACK_PAYLOAD }),
      ]),
    );
  });
});
