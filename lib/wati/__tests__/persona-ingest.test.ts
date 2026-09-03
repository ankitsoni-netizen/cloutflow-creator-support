import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import {
  emptyConversationSnapshot,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import {
  CREATOR_CAMPAIGN_ISSUE_TITLE,
  CREATOR_EXISTING_CAMPAIGN_TITLE,
  CREATOR_TICKET_CONFIRM_TITLE,
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
import {
  personaQuickReplies,
} from "@/lib/meta/instagram-persona-machine";
import {
  CAMPAIGN_MONTH_YES_PAYLOAD,
} from "@/lib/meta/month-confirmation";
import { ingestWhatsAppInboundMessage } from "@/lib/meta/whatsapp-ingest";
import { chatbotOutboundIdempotencyKey } from "@/lib/meta/prompt-keys";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { normalizeWatiWebhookPayload } from "@/lib/wati/normalize";
import {
  WATI_TEST_CHANNEL,
  WATI_TEST_WA_ID,
  watiTextPayload,
} from "@/lib/wati/__tests__/fixtures";
import * as watiSend from "@/lib/wati/send";
import { WATI_V3_INTERACTIVE_PATH, WATI_V3_TEXT_PATH } from "@/lib/wati/send";

pinIdentitySchemaPhase("a");

const CONTEXT = {
  webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
};

function watiEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    WHATSAPP_PROVIDER: "wati",
    WATI_API_ENDPOINT: "https://live-mt-server.wati.io/101197",
    WATI_API_TOKEN: "wati-secret-token-value",
    WATI_CHANNEL_PHONE_NUMBER: WATI_TEST_CHANNEL,
    WATI_CONVERSATION_TARGET_MODE: "recipient",
    ...overrides,
  };
}

function acceptedJson() {
  return new Response(
    JSON.stringify({ message: { whatsappMessageId: "wamid.out.wati" } }),
    { status: 200 },
  );
}

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "wati";
  vi.spyOn(watiSend, "sendWatiInteractiveMessage").mockResolvedValue({
    ok: true,
    metaMessageId: "wamid.wati.qr",
    recipientId: WATI_TEST_WA_ID,
  });
  vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
    ok: true,
    metaMessageId: "wamid.wati.text",
    recipientId: WATI_TEST_WA_ID,
  });
});

afterEach(() => {
  delete process.env.WHATSAPP_PROVIDER;
  vi.restoreAllMocks();
});

function eventFromPayload(payload: Record<string, unknown>) {
  const normalized = normalizeWatiWebhookPayload(payload);
  expect(normalized.events).toHaveLength(1);
  return normalized.events[0]!;
}

async function sendWati(
  store: ReturnType<typeof createMemoryChatbotStore>,
  payload: Record<string, unknown>,
  ingestDeps: Parameters<typeof ingestWhatsAppInboundMessage>[3] = {},
) {
  const event = eventFromPayload(payload);
  const outboundBefore = store.messages.filter(
    (message) => message.direction === "outbound",
  ).length;
  const result = await ingestWhatsAppInboundMessage(
    event,
    store,
    CONTEXT,
    ingestDeps,
  );
  const snapshot = await reloadConversationSnapshot(
    store,
    "whatsapp",
    event.externalConversationId,
    identityLookupFromEvent(event),
  );
  const outboundAfter = store.messages.filter(
    (message) => message.direction === "outbound",
  ).length;
  return {
    result,
    event,
    snapshot,
    newOutboundCount: outboundAfter - outboundBefore,
  };
}

describe("WATI persona ingest parity with Instagram", () => {
  it("starts a new WATI Hi at the exact Instagram persona prompt and options", async () => {
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    const instagram = reduceInstagramConversation(emptyConversationSnapshot(), {
      text: "Hi",
      quickReplyPayload: null,
      timestamp: "2026-08-25T10:00:00.000Z",
      messageId: "mid.hi",
    });
    const { result, snapshot } = await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.wati.hi" }),
    );
    expect(result.outcome).toBe("stored");
    expect(snapshot.state).toBe("awaiting_persona");
    expect(snapshot.state).toBe(instagram.snapshot.state);
    const interactive = vi.mocked(watiSend.sendWatiInteractiveMessage);
    expect(interactive).toHaveBeenCalledTimes(1);
    expect(interactive.mock.calls[0]?.[0]?.text).toBe(
      personaWelcomeText("coubbb"),
    );
    expect(
      interactive.mock.calls[0]?.[0]?.quickReplies?.map((reply) => ({
        title: reply.title,
        payload: reply.payload,
      })),
    ).toEqual(
      personaQuickReplies().map((reply) => ({
        title: reply.title,
        payload: reply.payload,
      })),
    );
    expect(watiSend.sendWatiSessionText).not.toHaveBeenCalled();
  });

  it("reaches the same next state as Instagram for every persona option", async () => {
    const choices = [
      {
        title: PERSONA_CREATOR_TITLE,
        payload: PERSONA_CREATOR_PAYLOAD,
        state: "awaiting_creator_reason",
      },
      {
        title: PERSONA_BRAND_TITLE,
        payload: PERSONA_BRAND_PAYLOAD,
        state: "brand_action",
      },
      {
        title: PERSONA_AGENCY_TITLE,
        payload: PERSONA_AGENCY_PAYLOAD,
        state: "agency_details",
      },
      {
        title: PERSONA_OTHER_TITLE,
        payload: PERSONA_OTHER_PAYLOAD,
        state: "other_inquiry",
      },
    ] as const;

    for (const [index, choice] of choices.entries()) {
      const isolated = withDurableConversationPersistence(
        createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
      );
      await sendWati(
        isolated,
        watiTextPayload({
          text: "Hi",
          whatsappMessageId: `wamid.hi.${index}`,
        }),
      );
      const fromTitle = await sendWati(
        isolated,
        watiTextPayload({
          text: null,
          type: "button",
          buttonReply: { title: choice.title },
          whatsappMessageId: `wamid.title.${index}`,
        }),
      );
      const fromPayload = reduceInstagramConversation(
        emptyConversationSnapshot(),
        {
          text: "Hi",
          quickReplyPayload: null,
          timestamp: "2026-08-25T10:00:00.000Z",
          messageId: "mid.0",
        },
      );
      const instagramNext = reduceInstagramConversation(fromPayload.snapshot, {
        text: choice.title,
        quickReplyPayload: choice.payload,
        timestamp: "2026-08-25T10:00:00.000Z",
        messageId: "mid.1",
      });
      expect(fromTitle.snapshot.state).toBe(choice.state);
      expect(fromTitle.snapshot.state).toBe(instagramNext.snapshot.state);
    }
  });

  it("treats typed, button, and list creator selections identically", async () => {
    async function choose(kind: "typed" | "button" | "list") {
      const store = withDurableConversationPersistence(
        createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
      );
      await sendWati(
        store,
        watiTextPayload({ text: "Hi", whatsappMessageId: `wamid.hi.${kind}` }),
      );
      const payload =
        kind === "typed"
          ? watiTextPayload({
              text: PERSONA_CREATOR_TITLE,
              whatsappMessageId: `wamid.${kind}`,
            })
          : kind === "button"
            ? watiTextPayload({
                text: null,
                type: "button",
                buttonReply: { title: PERSONA_CREATOR_TITLE },
                whatsappMessageId: `wamid.${kind}`,
              })
            : watiTextPayload({
                text: null,
                type: "list",
                listReply: { title: PERSONA_CREATOR_TITLE },
                whatsappMessageId: `wamid.${kind}`,
              });
      return sendWati(store, payload);
    }

    const typed = await choose("typed");
    const button = await choose("button");
    const list = await choose("list");
    expect(typed.snapshot.state).toBe("awaiting_creator_reason");
    expect(button.snapshot.state).toBe(typed.snapshot.state);
    expect(list.snapshot.state).toBe(typed.snapshot.state);
    expect(typed.snapshot.collected.igPersona).toBe("creator");
    expect(button.snapshot.collected.igPersona).toBe("creator");
    expect(list.snapshot.collected.igPersona).toBe("creator");
  });

  it("creates exactly one mapped creator ticket on Yes and keeps campaign_name null", async () => {
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi" }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: PERSONA_CREATOR_TITLE,
        type: "button",
        buttonReply: { title: PERSONA_CREATOR_TITLE },
        whatsappMessageId: "wamid.persona",
      }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_EXISTING_CAMPAIGN_TITLE,
        whatsappMessageId: "wamid.existing",
      }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: null,
        type: "list",
        listReply: { title: CREATOR_CAMPAIGN_ISSUE_TITLE },
        whatsappMessageId: "wamid.issue",
      }),
    );
    const campaign = await sendWati(
      store,
      watiTextPayload({
        text: "Acme, August 2026, riya@example.com",
        whatsappMessageId: "wamid.campaign",
      }),
    );
    expect(campaign.snapshot.state).toBe("awaiting_month_confirmation");
    expect(campaign.snapshot.collected.brandName).toBe("Acme");
    expect(campaign.snapshot.collected.campaignMonth).toBe("2026-08-01");
    expect(campaign.snapshot.collected.email).toBe("riya@example.com");
    expect(campaign.snapshot.collected.campaignName).toBeNull();

    const yes = await sendWati(
      store,
      watiTextPayload({
        text: null,
        type: "button",
        buttonReply: { title: "Yes" },
        whatsappMessageId: "wamid.yes",
      }),
    );
    expect(yes.result.outcome).toBe("stored");
    expect(yes.snapshot.state).toBe("creator_confirmation");
    expect(store.tickets).toHaveLength(0);
    const raised = await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise",
      }),
    );
    expect(raised.result.outcome).toBe("stored");
    expect(raised.snapshot.state).toBe("awaiting_post_completion");
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.campaign_name).toBeNull();
    expect(store.tickets[0]?.brand_name).toBe("Acme");
    expect(store.tickets[0]?.campaign_month).toBe("2026-08-01");
    expect(store.tickets[0]?.creator_email).toBe("riya@example.com");
    expect(store.tickets[0]?.source_channel).toBe("whatsapp");
    expect(raised.newOutboundCount).toBeGreaterThanOrEqual(1);
  });

  it("matches Instagram month No → corrected month → Yes", async () => {
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi" }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: PERSONA_CREATOR_TITLE,
        whatsappMessageId: "wamid.persona",
      }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_EXISTING_CAMPAIGN_TITLE,
        whatsappMessageId: "wamid.existing",
      }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_CAMPAIGN_ISSUE_TITLE,
        whatsappMessageId: "wamid.issue",
      }),
    );
    await sendWati(
      store,
      watiTextPayload({
        text: "Acme, August 2026, riya@example.com",
        whatsappMessageId: "wamid.campaign",
      }),
    );
    const no = await sendWati(
      store,
      watiTextPayload({
        text: "No",
        type: "button",
        buttonReply: { title: "No" },
        whatsappMessageId: "wamid.no",
      }),
    );
    expect(no.snapshot.state).toBe("creator_campaign_details");
    expect(no.snapshot.collected.campaignMonth).toBeNull();
    expect(no.snapshot.collected.brandName).toBe("Acme");
    expect(no.snapshot.collected.email).toBe("riya@example.com");

    const corrected = await sendWati(
      store,
      watiTextPayload({
        text: "July 2026",
        whatsappMessageId: "wamid.july",
      }),
    );
    expect(corrected.snapshot.state).toBe("awaiting_month_confirmation");
    expect(corrected.snapshot.collected.campaignMonth).toBe("2026-07-01");
    expect(corrected.snapshot.collected.brandName).toBe("Acme");
    expect(corrected.snapshot.collected.email).toBe("riya@example.com");

    const yes = await sendWati(
      store,
      watiTextPayload({
        text: "Yes",
        type: "button",
        buttonReply: {
          title: "Yes",
          payload: CAMPAIGN_MONTH_YES_PAYLOAD,
        },
        whatsappMessageId: "wamid.yes",
      }),
    );
    expect(yes.snapshot.state).toBe("creator_confirmation");
    expect(store.tickets).toHaveLength(0);
    const raised = await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise",
      }),
    );
    expect(raised.snapshot.state).toBe("awaiting_post_completion");
    expect(store.tickets).toHaveLength(1);
  });

  it("accepts the first WATI reply and ignores a duplicate webhook retry", async () => {
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    const payload = watiTextPayload({
      text: "Hi",
      whatsappMessageId: "wamid.wati.dup",
    });
    const first = await sendWati(store, payload);
    expect(first.result.outcome).toBe("stored");
    expect(first.snapshot.state).toBe("awaiting_persona");
    expect(first.newOutboundCount).toBe(1);

    const retry = await ingestWhatsAppInboundMessage(
      first.event,
      store,
      CONTEXT,
    );
    expect(retry.outcome).toBe("duplicate");
    expect(
      store.messages.filter((message) => message.direction === "outbound"),
    ).toHaveLength(1);
    expect(store.tickets).toHaveLength(0);
  });

  it("moves an old WATI snapshot with no ticket into the current persona flow", async () => {
    const store = createMemoryChatbotStore("whatsapp", {
      identitySchema: "current",
    });
    const conversationId = `${WATI_TEST_CHANNEL}:${WATI_TEST_WA_ID}`;
    store.conversations.push({
      id: "convo-legacy",
      channel: "whatsapp",
      externalConversationId: conversationId,
      externalContactId: WATI_TEST_WA_ID,
      provider: WATI_WHATSAPP_PROVIDER,
      recipientAccountId: WATI_TEST_CHANNEL,
      state: "awaiting_route",
      routingIntent: "unclassified",
      currentIntakeField: null,
      lastProcessedExternalMessageId: "wamid.old",
      intakeSessionVersion: 0,
      collectedData: {},
    });
    const { snapshot } = await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.unstick" }),
    );
    expect(snapshot.state).toBe("awaiting_persona");
    expect(snapshot.intakeSessionVersion).toBe(1);
    expect(store.tickets).toHaveLength(0);
  });

  it("does not restart an old WATI snapshot that has an active ticket", async () => {
    const store = createMemoryChatbotStore("whatsapp", {
      identitySchema: "current",
    });
    const conversationId = `${WATI_TEST_CHANNEL}:${WATI_TEST_WA_ID}`;
    store.conversations.push({
      id: "convo-ticket",
      channel: "whatsapp",
      externalConversationId: conversationId,
      externalContactId: WATI_TEST_WA_ID,
      provider: WATI_WHATSAPP_PROVIDER,
      recipientAccountId: WATI_TEST_CHANNEL,
      state: "ticket_open",
      routingIntent: "creator_support",
      ticketId: "ticket-keep",
      lastProcessedExternalMessageId: "wamid.old",
      intakeSessionVersion: 2,
      collectedData: {},
    });
    store.tickets.push({
      id: "ticket-keep",
      status: "open",
      ticketCode: "CF-2026-00099",
      source_channel: "whatsapp",
      external_contact_id: WATI_TEST_WA_ID,
      external_conversation_id: conversationId,
      provider: WATI_WHATSAPP_PROVIDER,
      recipient_account_id: WATI_TEST_CHANNEL,
    });
    const hi = await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi.ticket" }),
    );
    expect(hi.snapshot.state).toBe("ticket_open");
    expect(hi.snapshot.ticketId).toBe("ticket-keep");
    expect(store.tickets).toHaveLength(1);

    const restarted = await sendWati(
      store,
      watiTextPayload({
        text: "restart",
        whatsappMessageId: "wamid.restart.ticket",
      }),
    );
    expect(store.tickets).toHaveLength(1);
    expect(restarted.snapshot.ticketId).toBe("ticket-keep");

    const oldButton = await sendWati(
      store,
      watiTextPayload({
        text: null,
        type: "button",
        buttonReply: { title: "Creator Support" },
        whatsappMessageId: "wamid.old.button",
      }),
    );
    expect(store.tickets).toHaveLength(1);
    expect(oldButton.snapshot.ticketId).toBe("ticket-keep");
  });

  it("does not let historical WATI route prompt keys suppress the persona menu", async () => {
    const store = createMemoryChatbotStore("whatsapp", {
      identitySchema: "current",
    });
    const conversationId = `${WATI_TEST_CHANNEL}:${WATI_TEST_WA_ID}`;
    store.conversations.push({
      id: "convo-keys",
      channel: "whatsapp",
      externalConversationId: conversationId,
      externalContactId: WATI_TEST_WA_ID,
      provider: WATI_WHATSAPP_PROVIDER,
      recipientAccountId: WATI_TEST_CHANNEL,
      state: "awaiting_route",
      routingIntent: "unclassified",
      lastProcessedExternalMessageId: "wamid.old",
      intakeSessionVersion: 0,
      collectedData: {},
    });
    store.messages.push({
      id: "out-route",
      conversationId: "convo-keys",
      direction: "outbound",
      deliveryStatus: "sent",
      idempotencyKey: chatbotOutboundIdempotencyKey("convo-keys", 0, "route", "wa"),
      messageBody: "legacy route prompt",
    });
    const { snapshot, newOutboundCount } = await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.new.persona" }),
    );
    expect(snapshot.state).toBe("awaiting_persona");
    expect(snapshot.intakeSessionVersion).toBe(1);
    expect(newOutboundCount).toBe(1);
    expect(
      store.messages.some(
        (message) =>
          message.direction === "outbound" &&
          String(message.idempotencyKey ?? "").includes(":v1:awaiting_persona"),
      ),
    ).toBe(true);
  });

  it("sends recipient-mode targets for WATI text, buttons, and lists", async () => {
    vi.mocked(watiSend.sendWatiInteractiveMessage).mockRestore();
    vi.mocked(watiSend.sendWatiSessionText).mockRestore();
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedJson());
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    const env = watiEnv();
    const deps = { sendDeps: { fetchImpl, env, allowHttpInTests: false } };

    await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi.fetch" }),
      deps,
    );
    await sendWati(
      store,
      watiTextPayload({
        text: null,
        type: "image",
        whatsappMessageId: "wamid.image.fetch",
      }),
      deps,
    );
    await sendWati(
      store,
      watiTextPayload({
        text: PERSONA_CREATOR_TITLE,
        type: "button",
        buttonReply: { title: PERSONA_CREATOR_TITLE },
        whatsappMessageId: "wamid.creator.fetch",
      }),
      deps,
    );

    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
    const bodies = fetchImpl.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.endsWith(WATI_V3_INTERACTIVE_PATH))).toBe(true);
    expect(urls.some((url) => url.endsWith(WATI_V3_TEXT_PATH))).toBe(true);
    expect(bodies.some((body) => body.type === "list")).toBe(true);
    expect(bodies.some((body) => body.type === "buttons")).toBe(true);
    expect(bodies.every((body) => body.target === WATI_TEST_WA_ID)).toBe(true);
    expect(bodies.every((body) => !String(body.target).includes(":"))).toBe(true);
    for (const call of fetchImpl.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain("?");
      expect(url).not.toContain("101197");
      expect(url.toLowerCase()).not.toContain("wati-secret-token-value");
      expect(call[1]?.headers).toMatchObject({
        Authorization: "Bearer wati-secret-token-value",
      });
    }
  });
});
