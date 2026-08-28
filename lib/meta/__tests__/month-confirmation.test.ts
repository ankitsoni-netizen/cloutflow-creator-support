import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
  reduceInstagramConversation,
  type MachineResult,
} from "@/lib/meta/conversation-machine";
import {
  CREATOR_CAMPAIGN_DETAILS_TEXT,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  PERSONA_CREATOR_PAYLOAD,
} from "@/lib/meta/instagram-persona-copy";
import {
  CAMPAIGN_MONTH_CHOOSE_TEXT,
  CAMPAIGN_MONTH_NO_PAYLOAD,
  CAMPAIGN_MONTH_REASK_TEXT,
  CAMPAIGN_MONTH_YES_PAYLOAD,
  campaignMonthConfirmationText,
} from "@/lib/meta/month-confirmation";
import {
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  WHATSAPP_INTAKE_COPY,
} from "@/lib/meta/routing-copy";

const NOW = "2026-08-28T06:20:00.000Z";

function signal(
  text: string,
  overrides: { messageId?: string; payload?: string | null } = {},
) {
  return {
    text,
    quickReplyPayload: overrides.payload ?? null,
    timestamp: NOW,
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

function playInstagram(
  steps: Array<{ text: string; payload?: string | null; messageId?: string }>,
) {
  let last: MachineResult = {
    snapshot: emptyConversationSnapshot(),
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

function reachPaymentDetails() {
  return playInstagram([
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
      text: "Payment issue",
      payload: CREATOR_PAYMENT_ISSUE_PAYLOAD,
      messageId: "mid.3",
    },
  ]);
}

function reachWhatsAppCampaign(start = emptyConversationSnapshot({
  suggestedPhone: "+16315551181",
})) {
  const first = reduceChannelConversation(
    start,
    signal("Need help", { messageId: "wamid.first" }),
    WHATSAPP_INTAKE_COPY,
  );
  const support = reduceChannelConversation(
    first.snapshot,
    signal("Creator Support", {
      messageId: "wamid.route",
      payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
    }),
    WHATSAPP_INTAKE_COPY,
  );
  const creator = reduceChannelConversation(
    support.snapshot,
    signal("Riya Sharma, riya@example.com", { messageId: "wamid.creator" }),
    WHATSAPP_INTAKE_COPY,
  );
  return reduceChannelConversation(
    creator.snapshot,
    signal("Instagram, @riya_creates", { messageId: "wamid.platform" }),
    WHATSAPP_INTAKE_COPY,
  );
}

describe("shared month confirmation in the conversation reducer", () => {
  it("asks the updated payment-issue prompt without campaign name", () => {
    const details = reachPaymentDetails();
    expect(sendText(details)).toBe(CREATOR_CAMPAIGN_DETAILS_TEXT);
    expect(sendText(details)).not.toContain("campaign name");
  });

  it("does not require or store a campaign name", () => {
    const parsed = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.4" }),
    );
    expect(parsed.snapshot.collected.campaignName).toBeNull();
    expect(parsed.snapshot.collected.brandName).toBe("Acme");
    expect(parsed.snapshot.collected.email).toBe("riya@example.com");
    expect(parsed.snapshot.collected.campaignMonth).toBe("2026-06-01");
    expect(parsed.snapshot.collected.campaignMonthConfirmed).toBe(false);
    expect(parsed.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
  });

  it.each([
    ["June", "2026-06-01", "June 2026"],
    ["Jun", "2026-06-01", "June 2026"],
    ["Jue", "2026-06-01", "June 2026"],
    ["June 2026", "2026-06-01", "June 2026"],
    ["Jun 2026", "2026-06-01", "June 2026"],
    ["June 26", "2026-06-01", "June 2026"],
    ["June ’26", "2026-06-01", "June 2026"],
    ["June '26", "2026-06-01", "June 2026"],
    ["13th June 2026", "2026-06-01", "June 2026"],
    ["13 June 26", "2026-06-01", "June 2026"],
    ["13 Jun 26", "2026-06-01", "June 2026"],
    ["13/06/2026", "2026-06-01", "June 2026"],
    ["06/2026", "2026-06-01", "June 2026"],
    ["jue 2026", "2026-06-01", "June 2026"],
  ])("accepts month format %s", (monthText, iso, display) => {
    const result = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal(`Acme, ${monthText}, riya@example.com`, { messageId: "mid.fmt" }),
    );
    expect(result.snapshot.state).toBe("awaiting_month_confirmation");
    expect(result.snapshot.collected.campaignMonth).toBe(iso);
    expect(sendText(result)).toBe(campaignMonthConfirmationText(iso));
    expect(sendText(result)).toContain(display);
    expect(quickReplyTitles(result)).toEqual(expect.arrayContaining(["Yes", "No"]));
    expect(result.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
  });

  it("infers month-only year and asks for confirmation", () => {
    const june = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June, riya@example.com", { messageId: "mid.june" }),
    );
    expect(june.snapshot.collected.campaignMonth).toBe("2026-06-01");
    expect(sendText(june)).toBe(campaignMonthConfirmationText("2026-06-01"));

    const december = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, December, riya@example.com", { messageId: "mid.dec" }),
    );
    expect(december.snapshot.collected.campaignMonth).toBe("2025-12-01");
    expect(sendText(december)).toContain("December 2025");
  });

  it("confirms the month on typed, button, and postback Yes and creates one ticket", () => {
    const awaiting = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.4" }),
    );
    expect(awaiting.snapshot.lastPromptKey).toBe(
      "awaiting_month_confirmation:retry:mid.4",
    );

    const typed = reduceInstagramConversation(
      awaiting.snapshot,
      signal("yes", { messageId: "mid.typed.yes" }),
    );
    expect(typed.snapshot.collected.campaignMonthConfirmed).toBe(true);
    expect(typed.snapshot.collected.brandName).toBe("Acme");
    expect(typed.snapshot.collected.email).toBe("riya@example.com");
    expect(typed.snapshot.collected.campaignName).toBeNull();
    expect(typed.snapshot.collected.campaignMonth).toBe("2026-06-01");
    expect(typed.snapshot.state).toBe("awaiting_post_completion");
    expect(typed.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );

    const fromButton = reduceInstagramConversation(
      awaiting.snapshot,
      signal("Yes", {
        messageId: "mid.button.yes",
        payload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    const fromPostback = reduceInstagramConversation(
      awaiting.snapshot,
      signal("Yes", {
        messageId: "mid.postback.yes",
        payload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    expect(fromButton.snapshot.state).toBe(typed.snapshot.state);
    expect(fromPostback.snapshot.state).toBe(typed.snapshot.state);
    expect(fromButton.snapshot.collected.campaignMonthConfirmed).toBe(true);
    expect(fromButton.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
    expect(fromPostback.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
  });

  it("clears only the month on No and preserves brand and email", () => {
    const awaiting = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.4" }),
    );
    const denied = reduceInstagramConversation(
      awaiting.snapshot,
      signal("No", {
        messageId: "mid.no",
        payload: CAMPAIGN_MONTH_NO_PAYLOAD,
      }),
    );
    expect(denied.snapshot.collected.campaignMonth).toBeNull();
    expect(denied.snapshot.collected.campaignMonthConfirmed).toBe(false);
    expect(denied.snapshot.collected.brandName).toBe("Acme");
    expect(denied.snapshot.collected.email).toBe("riya@example.com");
    expect(denied.snapshot.collected.igIssueCategory).toBe("payment");
    expect(sendText(denied)).toBe(CAMPAIGN_MONTH_REASK_TEXT);

    const typedNo = reduceInstagramConversation(
      awaiting.snapshot,
      signal("no", { messageId: "mid.typed.no" }),
    );
    expect(typedNo.snapshot.collected.campaignMonth).toBeNull();
    expect(typedNo.snapshot.collected.brandName).toBe("Acme");

    expect(denied.snapshot.lastPromptKey).toBe(
      "creator_campaign_details:retry:mid.no",
    );

    const corrected = reduceInstagramConversation(
      denied.snapshot,
      signal("July 2026", { messageId: "mid.july" }),
    );
    expect(corrected.snapshot.collected.campaignMonth).toBe("2026-07-01");
    expect(corrected.snapshot.collected.brandName).toBe("Acme");
    expect(corrected.snapshot.collected.email).toBe("riya@example.com");
    expect(sendText(corrected)).toBe(campaignMonthConfirmationText("2026-07-01"));
    expect(corrected.snapshot.lastPromptKey).toBe(
      "awaiting_month_confirmation:retry:mid.july",
    );
    expect(corrected.snapshot.lastPromptKey).not.toBe(awaiting.snapshot.lastPromptKey);
    expect(quickReplyTitles(corrected)).toEqual(expect.arrayContaining(["Yes", "No"]));
  });

  it("creates exactly one ticket on repeated Yes at month confirmation", () => {
    const awaiting = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.4" }),
    );
    const first = reduceInstagramConversation(
      awaiting.snapshot,
      signal("Yes", {
        messageId: "mid.yes.1",
        payload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    expect(first.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
    expect(first.snapshot.state).toBe("awaiting_post_completion");
    const second = reduceInstagramConversation(
      first.snapshot,
      signal("Yes", {
        messageId: "mid.yes.2",
        payload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    expect(second.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      0,
    );
    const duplicateEvent = reduceInstagramConversation(
      first.snapshot,
      signal("Yes", {
        messageId: "mid.yes.1",
        payload: CAMPAIGN_MONTH_YES_PAYLOAD,
      }),
    );
    expect(duplicateEvent.processed).toBe(false);
    expect(duplicateEvent.effects).toEqual([]);
  });

  it("does not restart on Hi while awaiting month confirmation", () => {
    const awaiting = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.4" }),
    );
    const hi = reduceInstagramConversation(
      awaiting.snapshot,
      signal("Hi", { messageId: "mid.hi" }),
    );
    expect(hi.snapshot.state).toBe("awaiting_month_confirmation");
    expect(hi.snapshot.collected.brandName).toBe("Acme");
    expect(hi.snapshot.collected.campaignMonth).toBe("2026-06-01");
    expect(sendText(hi)).toBe(CAMPAIGN_MONTH_CHOOSE_TEXT);
    expect(hi.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
  });

  it("rejects invalid months without creating a ticket", () => {
    const invalid = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, soon, riya@example.com", { messageId: "mid.bad" }),
    );
    expect(invalid.snapshot.state).toBe("creator_campaign_details");
    expect(invalid.snapshot.collected.campaignMonth).toBeNull();
    expect(invalid.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
    expect(sendText(invalid)?.toLowerCase()).toContain("month");
  });

  it("keeps Instagram and WhatsApp/WATI month confirmation in parity", () => {
    const igAwaiting = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.ig" }),
    );
    const waPlatform = reachWhatsAppCampaign();
    const waAwaiting = reduceChannelConversation(
      waPlatform.snapshot,
      signal("Acme, June 2026", { messageId: "wamid.campaign" }),
      WHATSAPP_INTAKE_COPY,
    );

    expect(igAwaiting.snapshot.state).toBe("awaiting_month_confirmation");
    expect(waAwaiting.snapshot.state).toBe("awaiting_month_confirmation");
    expect(sendText(igAwaiting)).toBe(sendText(waAwaiting));
    expect(igAwaiting.snapshot.collected.campaignMonth).toBe(
      waAwaiting.snapshot.collected.campaignMonth,
    );
    expect(igAwaiting.snapshot.collected.campaignName).toBeNull();
    expect(waAwaiting.snapshot.collected.campaignName).toBeNull();

    const igYes = reduceInstagramConversation(
      igAwaiting.snapshot,
      signal("Yes", { messageId: "mid.ig.yes" }),
    );
    const waYes = reduceChannelConversation(
      waAwaiting.snapshot,
      signal("Yes", { messageId: "wamid.yes" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(igYes.snapshot.collected.campaignMonthConfirmed).toBe(true);
    expect(waYes.snapshot.collected.campaignMonthConfirmed).toBe(true);
    expect(igYes.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
    expect(waYes.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
    expect(igYes.snapshot.state).toBe("awaiting_post_completion");
    expect(waYes.snapshot.state).toBe("ticket_open");
    expect(igYes.snapshot.collected.campaignName).toBeNull();
    expect(waYes.snapshot.collected.campaignName).toBeNull();

    const waHi = reduceChannelConversation(
      waAwaiting.snapshot,
      signal("Hi", { messageId: "wamid.hi" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(waHi.snapshot.state).toBe("awaiting_month_confirmation");
    expect(sendText(waHi)).toBe(CAMPAIGN_MONTH_CHOOSE_TEXT);

    const waRepeat = reduceChannelConversation(
      waYes.snapshot,
      signal("Yes", { messageId: "wamid.yes.2" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(waRepeat.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      0,
    );
  });

  it.each([
    ["typed", "Yes", null],
    ["button", "Yes", CAMPAIGN_MONTH_YES_PAYLOAD],
    ["list", "Yes", null],
  ] as const)("creates a WhatsApp/WATI ticket from %s Yes", (_kind, text, payload) => {
    const awaiting = reduceChannelConversation(
      reachWhatsAppCampaign().snapshot,
      signal("Acme, June 2026", { messageId: "wamid.campaign" }),
      WHATSAPP_INTAKE_COPY,
    );
    const confirmed = reduceChannelConversation(
      awaiting.snapshot,
      signal(text, { messageId: `wamid.yes.${_kind}`, payload }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(confirmed.snapshot.state).toBe("ticket_open");
    expect(confirmed.snapshot.collected.campaignMonth).toBe("2026-06-01");
    expect(confirmed.snapshot.collected.brandName).toBe("Acme");
    expect(confirmed.snapshot.collected.email).toBe("riya@example.com");
    expect(confirmed.snapshot.collected.campaignName).toBeNull();
    expect(confirmed.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(
      1,
    );
  });

  it.each([
    ["typed", "No", null],
    ["button", "No", CAMPAIGN_MONTH_NO_PAYLOAD],
    ["list", "No", null],
  ] as const)("clears only the WhatsApp/WATI month from %s No", (_kind, text, payload) => {
    const awaiting = reduceChannelConversation(
      reachWhatsAppCampaign().snapshot,
      signal("Acme, June 2026", { messageId: "wamid.campaign" }),
      WHATSAPP_INTAKE_COPY,
    );
    const denied = reduceChannelConversation(
      awaiting.snapshot,
      signal(text, { messageId: `wamid.no.${_kind}`, payload }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(denied.snapshot.collected.campaignMonth).toBeNull();
    expect(denied.snapshot.collected.brandName).toBe("Acme");
    expect(denied.snapshot.collected.email).toBe("riya@example.com");
    expect(sendText(denied)).toBe(CAMPAIGN_MONTH_REASK_TEXT);
    expect(denied.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
  });

  it("uses a new WhatsApp confirmation key after a corrected month", () => {
    const awaiting = reduceChannelConversation(
      reachWhatsAppCampaign().snapshot,
      signal("Acme, June 2026", { messageId: "wamid.campaign" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(awaiting.snapshot.lastPromptKey).toBe(
      "awaiting_month_confirmation:retry:wamid.campaign",
    );
    const denied = reduceChannelConversation(
      awaiting.snapshot,
      signal("No", {
        messageId: "wamid.no",
        payload: CAMPAIGN_MONTH_NO_PAYLOAD,
      }),
      WHATSAPP_INTAKE_COPY,
    );
    const corrected = reduceChannelConversation(
      denied.snapshot,
      signal("July 2026", { messageId: "wamid.july" }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(corrected.snapshot.lastPromptKey).toBe(
      "awaiting_month_confirmation:retry:wamid.july",
    );
    expect(corrected.snapshot.lastPromptKey).not.toBe(awaiting.snapshot.lastPromptKey);
    expect(sendText(corrected)).toBe(campaignMonthConfirmationText("2026-07-01"));
  });

  it("does not advance month confirmation on a duplicate inbound id", () => {
    const awaiting = reduceInstagramConversation(
      reachPaymentDetails().snapshot,
      signal("Acme, June 2026, riya@example.com", { messageId: "mid.4" }),
    );
    const first = reduceInstagramConversation(
      awaiting.snapshot,
      signal("Yes", { messageId: "mid.yes" }),
    );
    const duplicate = reduceInstagramConversation(
      first.snapshot,
      signal("Yes", { messageId: "mid.yes" }),
    );
    expect(first.processed).toBe(true);
    expect(duplicate.processed).toBe(false);
    expect(duplicate.effects).toEqual([]);
    expect(duplicate.snapshot.state).toBe("awaiting_post_completion");
  });
});
