import { describe, expect, it } from "vitest";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import {
  agencyConfirmationQuickReplies,
  brandActionQuickReplies,
  creatorConfirmationQuickReplies,
  creatorIssueCategoryQuickReplies,
  creatorReasonQuickReplies,
  INSTAGRAM_PERSONA_STATES,
  instagramPromptForState,
  otherConfirmationQuickReplies,
  personaQuickReplies,
  postCompletionQuickReplies,
  withFlowBackQuickReply,
} from "@/lib/meta/instagram-persona-machine";
import {
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_ISSUE_CATEGORY_TEXT,
  PERSONA_CREATOR_PAYLOAD,
} from "@/lib/meta/instagram-persona-copy";
import {
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  ROUTING_CLARIFY_TEXT,
  WHATSAPP_INTAKE_COPY,
} from "@/lib/meta/routing-copy";
import {
  planWatiInteractiveMessage,
  WATI_BUTTON_COUNT_MAX,
  WATI_BUTTON_TITLE_MAX,
  WATI_INTERACTIVE_BODY_MAX,
  WATI_LIST_ROW_COUNT_MAX,
  WATI_LIST_ROW_TITLE_MAX,
} from "@/lib/wati/interactive";

function signal(
  text: string,
  overrides: { messageId?: string; payload?: string | null } = {},
) {
  return {
    text,
    quickReplyPayload: overrides.payload ?? null,
    timestamp: "2026-08-25T10:00:00.000Z",
    messageId: overrides.messageId ?? `mid.${text.slice(0, 12)}`,
  };
}

function inventoryQuickReplySets(): Array<{
  label: string;
  text: string;
  titles: string[];
}> {
  const routing = reduceChannelConversation(
    emptyConversationSnapshot(),
    signal("Hi", { messageId: "wa.route" }),
    WHATSAPP_INTAKE_COPY,
  );
  const routingEffect = routing.effects.find(
    (effect) => effect.type === "send_quick_replies",
  );
  const clarify = reduceChannelConversation(
    routing.snapshot,
    signal("something else", { messageId: "wa.clarify" }),
    WHATSAPP_INTAKE_COPY,
  );
  const clarifyEffect = clarify.effects.find(
    (effect) => effect.type === "send_quick_replies",
  );

  const personaSets = [
    { label: "persona", replies: personaQuickReplies(), state: "awaiting_persona" },
    {
      label: "creator_reason",
      replies: creatorReasonQuickReplies(),
      state: "awaiting_creator_reason",
    },
    {
      label: "issue_category",
      replies: creatorIssueCategoryQuickReplies(),
      state: "awaiting_creator_issue_category",
    },
    {
      label: "creator_confirmation",
      replies: creatorConfirmationQuickReplies(),
      state: "creator_confirmation",
    },
    {
      label: "brand_action",
      replies: brandActionQuickReplies(),
      state: "brand_action",
    },
    {
      label: "agency_confirmation",
      replies: agencyConfirmationQuickReplies(),
      state: "agency_confirmation",
    },
    {
      label: "other_confirmation",
      replies: otherConfirmationQuickReplies(),
      state: "other_confirmation",
    },
    {
      label: "post_completion",
      replies: postCompletionQuickReplies(),
      state: "awaiting_post_completion",
    },
  ].map((entry) => {
    const replies = withFlowBackQuickReply(entry.state, entry.replies);
    const prompt = instagramPromptForState(
      emptyConversationSnapshot({ state: entry.state }),
    );
    return {
      label: entry.label,
      text: prompt?.text ?? entry.label,
      titles: replies.map((reply) => reply.title),
    };
  });

  return [
    {
      label: "whatsapp_routing",
      text:
        routingEffect && "text" in routingEffect ? routingEffect.text : "",
      titles:
        routingEffect && routingEffect.type === "send_quick_replies"
          ? (routingEffect.quickReplies ?? []).map((reply) => reply.title)
          : [],
    },
    {
      label: "whatsapp_routing_clarify",
      text:
        clarifyEffect && "text" in clarifyEffect ? clarifyEffect.text : "",
      titles:
        clarifyEffect && clarifyEffect.type === "send_quick_replies"
          ? (clarifyEffect.quickReplies ?? []).map((reply) => reply.title)
          : [],
    },
    ...personaSets,
  ];
}

describe("WATI interactive plan", () => {
  it("uses buttons for 1–3 titles of 20 characters or fewer", () => {
    const plan = planWatiInteractiveMessage("Choose", [
      { title: "Creator Support" },
      { title: "Campaign / Collab" },
    ]);
    expect(plan).toEqual({
      ok: true,
      kind: "buttons",
      body: "Choose",
      titles: ["Creator Support", "Campaign / Collab"],
    });
  });

  it("uses a list for 4–10 options", () => {
    const plan = planWatiInteractiveMessage("Who are you?", [
      { title: "I'm a creator" },
      { title: "I'm a brand" },
      { title: "I'm an agency" },
      { title: "Something else" },
    ]);
    expect(plan).toMatchObject({ ok: true, kind: "list" });
    if (plan.ok) expect(plan.titles).toHaveLength(4);
  });

  it("uses a list when a title exceeds the 20-character button limit but fits 24", () => {
    const plan = planWatiInteractiveMessage("Choose", [
      { title: "123456789012345678901" },
    ]);
    expect(plan).toMatchObject({ ok: true, kind: "list" });
  });

  it("fails closed instead of truncating an option that exceeds WhatsApp limits", () => {
    expect(
      planWatiInteractiveMessage("Choose", [
        { title: "this title is far too long for whatsapp" },
      ]),
    ).toEqual({ ok: false, errorCode: "wati_interactive_option_too_long" });
    expect(
      planWatiInteractiveMessage("Choose", Array.from({ length: 11 }, (_, i) => ({
        title: `Opt ${i + 1}`,
      }))),
    ).toEqual({ ok: false, errorCode: "wati_interactive_too_many_options" });
    expect(
      planWatiInteractiveMessage("x".repeat(WATI_INTERACTIVE_BODY_MAX + 1), [
        { title: "Yes" },
      ]),
    ).toEqual({ ok: false, errorCode: "wati_interactive_body_too_long" });
  });
});

describe("Instagram conversation-machine titles fit WATI WhatsApp limits", () => {
  it("fits every current quick-reply set into buttons or a list without truncation", () => {
    const sets = inventoryQuickReplySets();
    expect(sets.some((entry) => entry.label === "whatsapp_routing")).toBe(true);
    expect(sets.find((entry) => entry.label === "whatsapp_routing")?.titles).toEqual(
      ["Campaign / Collab", "Creator Support"],
    );
    expect(
      sets.find((entry) => entry.label === "whatsapp_routing_clarify")?.text,
    ).toBe(ROUTING_CLARIFY_TEXT);

    for (const entry of sets) {
      expect(entry.titles.length).toBeGreaterThan(0);
      expect(entry.titles.length).toBeLessThanOrEqual(WATI_LIST_ROW_COUNT_MAX);
      for (const title of entry.titles) {
        expect(title.length).toBeGreaterThan(0);
        expect(title.length).toBeLessThanOrEqual(WATI_LIST_ROW_TITLE_MAX);
      }
      const plan = planWatiInteractiveMessage(
        entry.text.slice(0, WATI_INTERACTIVE_BODY_MAX) || "prompt",
        entry.titles.map((title) => ({ title })),
      );
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      if (
        entry.titles.length <= WATI_BUTTON_COUNT_MAX &&
        entry.titles.every((title) => title.length <= WATI_BUTTON_TITLE_MAX)
      ) {
        expect(plan.kind).toBe("buttons");
      } else {
        expect(plan.kind).toBe("list");
      }
      expect(plan.titles).toEqual(entry.titles);
    }

    expect(INSTAGRAM_PERSONA_STATES.length).toBeGreaterThan(0);
  });
});

describe("WATI inbound titles match Instagram payloads in the shared machine", () => {
  it("treats a WATI button title the same as the Instagram routing payload", () => {
    const start = reduceChannelConversation(
      emptyConversationSnapshot({ suggestedPhone: "+16315551181" }),
      signal("Need help", { messageId: "wamid.1" }),
      WHATSAPP_INTAKE_COPY,
    );
    const fromPayload = reduceChannelConversation(
      start.snapshot,
      signal("Creator Support", {
        messageId: "ig.payload",
        payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
      WHATSAPP_INTAKE_COPY,
    );
    const fromWatiTitle = reduceChannelConversation(
      start.snapshot,
      signal("Creator Support", { messageId: "wati.title", payload: null }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(fromWatiTitle.snapshot.state).toBe(fromPayload.snapshot.state);
    expect(fromWatiTitle.snapshot.routingIntent).toBe(
      fromPayload.snapshot.routingIntent,
    );
    expect(fromWatiTitle.effects.map((effect) => ("text" in effect ? effect.text : effect.type))).toEqual(
      fromPayload.effects.map((effect) => ("text" in effect ? effect.text : effect.type)),
    );
  });

  it("treats a WATI list title the same as the Instagram collaboration payload", () => {
    const start = reduceChannelConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "wamid.1" }),
      WHATSAPP_INTAKE_COPY,
    );
    const fromPayload = reduceChannelConversation(
      start.snapshot,
      signal("Campaign / Collab", {
        messageId: "ig.payload",
        payload: ROUTE_COLLABORATION_PAYLOAD,
      }),
      WHATSAPP_INTAKE_COPY,
    );
    const fromWatiTitle = reduceChannelConversation(
      start.snapshot,
      signal("Campaign / Collab", { messageId: "wati.title", payload: null }),
      WHATSAPP_INTAKE_COPY,
    );
    expect(fromWatiTitle.snapshot.state).toBe("collaboration");
    expect(fromWatiTitle.snapshot.state).toBe(fromPayload.snapshot.state);
    expect(fromWatiTitle.snapshot.routingIntent).toBe("collaboration");
  });

  it("treats a WATI issue-category title the same as the Instagram payload", () => {
    const toReason = reduceInstagramConversation(
      emptyConversationSnapshot(),
      signal("Hi", { messageId: "mid.0" }),
    );
    const creator = reduceInstagramConversation(
      toReason.snapshot,
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
    expect(existing.snapshot.state).toBe("awaiting_creator_issue_category");
    expect(
      existing.effects.find((effect) => effect.type === "send_quick_replies"),
    ).toMatchObject({ text: CREATOR_ISSUE_CATEGORY_TEXT });

    const fromPayload = reduceInstagramConversation(
      existing.snapshot,
      signal("Campaign issue", {
        messageId: "mid.3",
        payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      }),
    );
    const fromWatiTitle = reduceInstagramConversation(
      existing.snapshot,
      signal("Campaign issue", { messageId: "mid.3b", payload: null }),
    );
    expect(fromWatiTitle.snapshot.state).toBe(fromPayload.snapshot.state);
    expect(fromWatiTitle.snapshot.state).toBe("creator_campaign_details");
  });
});
