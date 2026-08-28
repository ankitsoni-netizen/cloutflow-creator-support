import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER, META_WHATSAPP_PROVIDER } from "@/lib/meta/constants";
import { ingestInstagramEcho } from "@/lib/meta/instagram-echo";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import { createSupabaseInstagramStore } from "@/lib/meta/instagram-store";
import {
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
  personaWelcomeText,
} from "@/lib/meta/instagram-persona-copy";
import * as instagramSend from "@/lib/meta/instagram-send";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import { ROUTE_CREATOR_SUPPORT_PAYLOAD } from "@/lib/meta/routing-copy";
import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import {
  ingestWhatsAppInboundMessage,
  ingestWhatsAppStatus,
} from "@/lib/meta/whatsapp-ingest";
import * as whatsappSend from "@/lib/meta/whatsapp-send";
import {
  instagramPostbackPayload,
  instagramTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { normalizeWatiWebhookPayload } from "@/lib/wati/normalize";
import { watiTextPayload } from "@/lib/wati/__tests__/fixtures";
import * as watiSend from "@/lib/wati/send";
import type { SupabaseClient } from "@supabase/supabase-js";

const WA_ID = "16315551181";
const PHONE_NUMBER_ID = "123456123";
const CONVO_EXTERNAL_ID = `${PHONE_NUMBER_ID}:${WA_ID}`;
const CAMPAIGN_COMPLETE_TEXT = "Summer Drop, Acme, August 2026";

const waContext = { webhookPayload: { object: "whatsapp_business_account" } };
const igContext = { webhookPayload: { object: "instagram" } };

pinIdentitySchemaPhase("a");

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "meta";
});

afterEach(() => {
  delete process.env.WHATSAPP_PROVIDER;
  vi.restoreAllMocks();
});

function sampleWhatsAppEvent(
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  return {
    channel: "whatsapp",
    provider: META_WHATSAPP_PROVIDER,
    externalEventId: "wamid.first",
    externalMessageId: "wamid.first",
    externalConversationId: CONVO_EXTERNAL_ID,
    externalContactId: WA_ID,
    displayName: "Riya Sharma",
    senderName: "Riya Sharma",
    senderAddress: WA_ID,
    messageType: "text",
    messageBody: "Need help with a campaign",
    timestamp: "2020-10-18T22:13:26.000Z",
    phoneNumberId: PHONE_NUMBER_ID,
    recipientAccountId: null,
    quickReplyPayload: null,
    eventFragment: { messaging_product: "whatsapp", type: "text", hasId: true },
    ...overrides,
  };
}

function sampleInstagramEvent(
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: "mid.instagram.abc",
    externalMessageId: "mid.instagram.abc",
    externalConversationId: "12334",
    externalContactId: "12334",
    displayName: null,
    senderName: null,
    senderAddress: "12334",
    messageType: "text",
    messageBody: "Need help with a campaign",
    timestamp: "2020-10-18T22:13:26.000Z",
    phoneNumberId: null,
    recipientAccountId: "17841400008460000",
    quickReplyPayload: null,
    eventFragment: { message: { mid: "mid.instagram.abc" } },
    ...overrides,
  };
}

const SAMPLE_WA_LOOKUP = identityLookupFromEvent(sampleWhatsAppEvent());

describe("first-reply DM ingest persistence", () => {
  async function sendWhatsAppOnce(
    store: ReturnType<typeof createMemoryChatbotStore>,
    event: NormalizedMetaInboundText,
  ) {
    const outboundBefore = store.messages.filter(
      (message) => message.direction === "outbound",
    ).length;
    const result = await ingestWhatsAppInboundMessage(event, store, waContext);
    expect(result.outcome).toBe("stored");
    const snapshot = await reloadConversationSnapshot(
      store,
      "whatsapp",
      event.externalConversationId,
      identityLookupFromEvent(event),
    );
    expect(snapshot.lastProcessedExternalMessageId).toBe(event.externalMessageId);
    const webhook = store.events.find(
      (row) => row.externalEventId === event.externalEventId,
    );
    expect(webhook?.processingStatus).toBe("completed");
    return {
      snapshot,
      newOutboundCount:
        store.messages.filter((message) => message.direction === "outbound")
          .length - outboundBefore,
    };
  }

  function mockMetaSends() {
    vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: WA_ID,
    });
    vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.text",
      recipientId: WA_ID,
    });
  }

  it("accepts every Meta WhatsApp reply on first delivery and creates one ticket", async () => {
    mockMetaSends();
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    const hi = await sendWhatsAppOnce(store, sampleWhatsAppEvent({ messageBody: "Hi" }));
    expect(hi.snapshot.state).toBe("awaiting_route");
    expect(hi.newOutboundCount).toBe(1);

    const route = await sendWhatsAppOnce(
      store,
      sampleWhatsAppEvent({
        externalEventId: "wamid.route",
        externalMessageId: "wamid.route",
        messageBody: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
      }),
    );
    expect(route.snapshot.state).toBe("support_intake");
    expect(route.snapshot.currentIntakeField).toBe("creator_details");

    const creator = await sendWhatsAppOnce(
      store,
      sampleWhatsAppEvent({
        externalEventId: "wamid.creator",
        externalMessageId: "wamid.creator",
        messageBody: "Riya Sharma, riya@example.com",
      }),
    );
    expect(creator.snapshot.currentIntakeField).toBe("platform_details");
    expect(creator.snapshot.collected.creatorName).toBe("Riya Sharma");

    const platform = await sendWhatsAppOnce(
      store,
      sampleWhatsAppEvent({
        externalEventId: "wamid.platform",
        externalMessageId: "wamid.platform",
        messageBody: "Instagram, @riya_creates",
      }),
    );
    expect(platform.snapshot.currentIntakeField).toBe("campaign_details");

    const campaign = await sendWhatsAppOnce(
      store,
      sampleWhatsAppEvent({
        externalEventId: "wamid.campaign",
        externalMessageId: "wamid.campaign",
        messageBody: CAMPAIGN_COMPLETE_TEXT,
      }),
    );
    expect(campaign.snapshot.state).not.toBe("support_intake");
    expect(
      campaign.snapshot.collected.campaignName === "Summer Drop" ||
        campaign.snapshot.collected.brandName === "Acme",
    ).toBe(true);
  });

  it("accepts a valid campaign reply on first delivery when the primary prompt outbound is missing", async () => {
    mockMetaSends();
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    store.conversations.push({
      id: "convo-missing-prompt",
      channel: "whatsapp",
      externalConversationId: CONVO_EXTERNAL_ID,
      externalContactId: WA_ID,
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: "campaign_details",
      lastPromptKey: "intake:campaign_details:followup:mid.old",
      lastProcessedExternalMessageId: "mid.old",
      intakeSessionVersion: 1,
      collectedData: {
        creatorName: "Riya Sharma",
        email: "riya@example.com",
        phoneNormalized: "+16315551181",
        platform: "instagram",
        socialHandle: "riya_creates",
        originalInboundText: "Need help with a campaign",
      },
    });
    const result = await sendWhatsAppOnce(
      store,
      sampleWhatsAppEvent({
        externalEventId: "wamid.campaign.valid",
        externalMessageId: "wamid.campaign.valid",
        messageBody: CAMPAIGN_COMPLETE_TEXT,
      }),
    );
    expect(result.snapshot.state).not.toBe("support_intake");
    expect(
      result.snapshot.collected.campaignName === "Summer Drop" ||
        result.snapshot.collected.brandName === "Acme",
    ).toBe(true);
  });

  it("ignores a retry of the same external event and does not require a new copy of the text", async () => {
    mockMetaSends();
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    const first = sampleWhatsAppEvent({ messageBody: "Hi" });
    await sendWhatsAppOnce(store, first);
    const retry = await ingestWhatsAppInboundMessage(first, store, waContext);
    expect(retry.outcome).toBe("duplicate");
    const snapshot = await reloadConversationSnapshot(
      store,
      "whatsapp",
      CONVO_EXTERNAL_ID,
      SAMPLE_WA_LOOKUP,
    );
    expect(snapshot.state).toBe("awaiting_route");
    expect(
      store.messages.filter((message) => message.direction === "outbound"),
    ).toHaveLength(1);
  });

  it("does not let a delivery status callback move or overwrite conversation state", async () => {
    mockMetaSends();
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );
    await sendWhatsAppOnce(store, sampleWhatsAppEvent({ messageBody: "Hi" }));
    const before = await reloadConversationSnapshot(
      store,
      "whatsapp",
      CONVO_EXTERNAL_ID,
      SAMPLE_WA_LOOKUP,
    );
    const status = await ingestWhatsAppStatus(
      {
        channel: "whatsapp",
        provider: META_WHATSAPP_PROVIDER,
        externalEventId: "status:mid.prompt:delivered",
        metaMessageId: "mid.prompt",
        status: "delivered",
        timestamp: "2020-10-18T22:13:27.000Z",
        phoneNumberId: PHONE_NUMBER_ID,
        errorCode: null,
      },
      store,
      waContext,
    );
    expect(status.outcome).not.toBe("failed");
    const after = await reloadConversationSnapshot(
      store,
      "whatsapp",
      CONVO_EXTERNAL_ID,
      SAMPLE_WA_LOOKUP,
    );
    expect(after.state).toBe(before.state);
    expect(after.lastProcessedExternalMessageId).toBe(
      before.lastProcessedExternalMessageId,
    );
  });

  it("fails the webhook when conversation state cannot be persisted", async () => {
    mockMetaSends();
    const store = createMemoryChatbotStore("whatsapp", { identitySchema: "current" });
    store.saveConversationSnapshot = async () => ({
      outcome: "failed",
      errorCode: "conversation_update_failed",
    });
    const result = await ingestWhatsAppInboundMessage(
      sampleWhatsAppEvent({ messageBody: "Hi" }),
      store,
      waContext,
    );
    expect(result).toEqual({
      outcome: "failed",
      errorCode: "conversation_update_failed",
    });
    expect(store.events[0]?.processingStatus).toBe("failed");
    expect(store.events[0]?.errorCode).toBe("conversation_update_failed");
  });

  it("accepts WATI typed, button, and list replies on first delivery", async () => {
    process.env.WHATSAPP_PROVIDER = "wati";
    vi.spyOn(watiSend, "sendWatiInteractiveMessage").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati.qr",
      recipientId: "8618719149214",
    });
    vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati.text",
      recipientId: "8618719149214",
    });
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("whatsapp", { identitySchema: "current" }),
    );

    async function sendWatiOnce(payload: Record<string, unknown>) {
      const normalized = normalizeWatiWebhookPayload(payload);
      expect(normalized.events).toHaveLength(1);
      const event = normalized.events[0]!;
      const result = await ingestWhatsAppInboundMessage(event, store, {
        webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
      });
      expect(result.outcome).toBe("stored");
      const snapshot = await reloadConversationSnapshot(
        store,
        "whatsapp",
        event.externalConversationId,
        identityLookupFromEvent(event),
      );
      expect(snapshot.lastProcessedExternalMessageId).toBe(event.externalMessageId);
      return snapshot;
    }

    const hi = await sendWatiOnce(
      watiTextPayload({
        text: "Hi",
        whatsappMessageId: "wamid.wati.hi",
      }),
    );
    expect(hi.state).toBe("awaiting_route");

    const button = await sendWatiOnce(
      watiTextPayload({
        text: null,
        type: "button",
        buttonReply: { title: "Creator Support" },
        whatsappMessageId: "wamid.wati.btn",
      }),
    );
    expect(button.state).toBe("support_intake");
    expect(button.currentIntakeField).toBe("creator_details");

    const typed = await sendWatiOnce(
      watiTextPayload({
        text: "Riya Sharma, riya@example.com",
        whatsappMessageId: "wamid.wati.creator",
      }),
    );
    expect(typed.currentIntakeField).toBe("platform_details");

    const list = await sendWatiOnce(
      watiTextPayload({
        text: null,
        type: "list",
        listReply: { title: "Instagram, @riya_creates" },
        whatsappMessageId: "wamid.wati.platform",
      }),
    );
    expect(list.currentIntakeField).toBe("campaign_details");

    const campaign = await sendWatiOnce(
      watiTextPayload({
        text: CAMPAIGN_COMPLETE_TEXT,
        whatsappMessageId: "wamid.wati.campaign",
      }),
    );
    expect(campaign.state).not.toBe("support_intake");
    expect(
      campaign.collected.campaignName === "Summer Drop" ||
        campaign.collected.brandName === "Acme",
    ).toBe(true);
  });

  it("accepts an Instagram postback title/payload on first delivery", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("instagram", { identitySchema: "current" }),
    );
    const hi = await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.hi",
        externalMessageId: "mid.hi",
        messageBody: "Hi",
      }),
      store,
      igContext,
    );
    expect(hi.outcome).toBe("stored");
    expect(
      (await reloadConversationSnapshot(
        store,
        "instagram",
        "12334",
        identityLookupFromEvent(sampleInstagramEvent()),
      )).state,
    ).toBe("awaiting_persona");

    const events = normalizeMetaWebhookPayload(
      instagramPostbackPayload({
        mid: "mid.persona.postback",
        title: PERSONA_CREATOR_TITLE,
        payload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    expect(events).toHaveLength(1);
    const persona = await ingestInstagramInboundMessage(
      events[0]!,
      store,
      igContext,
    );
    expect(persona.outcome).toBe("stored");
    const snapshot = await reloadConversationSnapshot(
        store,
        "instagram",
        "12334",
        identityLookupFromEvent(sampleInstagramEvent()),
      );
    expect(snapshot.state).toBe("awaiting_creator_reason");
    expect(snapshot.collected.igPersona).toBe("creator");
    expect(snapshot.lastProcessedExternalMessageId).toBe("mid.persona.postback");
  });

  it("accepts an Instagram quick-reply on first webhook delivery", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("instagram", { identitySchema: "current" }),
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({
        externalEventId: "mid.hi",
        externalMessageId: "mid.hi",
        messageBody: "Hi",
      }),
      store,
      igContext,
    );
    const events = normalizeMetaWebhookPayload(
      instagramTextPayload({
        senderId: "12334",
        recipientId: "17841400008460000",
        mid: "mid.persona.qr",
        text: PERSONA_CREATOR_TITLE,
        quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
      }),
    );
    expect(events).toHaveLength(1);
    const persona = await ingestInstagramInboundMessage(
      events[0]!,
      store,
      igContext,
    );
    expect(persona.outcome).toBe("stored");
    const snapshot = await reloadConversationSnapshot(
        store,
        "instagram",
        "12334",
        identityLookupFromEvent(sampleInstagramEvent()),
      );
    expect(snapshot.state).toBe("awaiting_creator_reason");
    expect(snapshot.collected.igPersona).toBe("creator");
  });

  it("does not let an Instagram echo callback move conversation state", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.prompt",
      recipientId: "12334",
    });
    const store = withDurableConversationPersistence(
      createMemoryChatbotStore("instagram", { identitySchema: "current" }),
    );
    await ingestInstagramInboundMessage(
      sampleInstagramEvent({ messageBody: "Hi" }),
      store,
      igContext,
    );
    const before = await reloadConversationSnapshot(
        store,
        "instagram",
        "12334",
        identityLookupFromEvent(sampleInstagramEvent()),
      );
    await ingestInstagramEcho(
      {
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        externalEventId: "echo:mid.prompt",
        externalMessageId: "mid.prompt",
        externalConversationId: "12334",
        recipientId: "12334",
        senderId: "17841400008460000",
        messageBody: personaWelcomeText(null),
        timestamp: "2020-10-18T22:13:27.000Z",
        isEcho: true,
        isSelf: false,
        eventFragment: { messaging_product: "instagram", type: "echo", hasId: true },
      },
      store,
      igContext,
    );
    const after = await reloadConversationSnapshot(
        store,
        "instagram",
        "12334",
        identityLookupFromEvent(sampleInstagramEvent()),
      );
    expect(after.state).toBe(before.state);
    expect(after.lastProcessedExternalMessageId).toBe(
      before.lastProcessedExternalMessageId,
    );
  });

  it("treats a zero-row Instagram conversation update as persistence failure", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    };
    const store = createSupabaseInstagramStore(
      supabase as unknown as SupabaseClient,
    );
    const snapshot: ConversationSnapshot = {
      state: "awaiting_persona",
      routingIntent: "unclassified",
      currentIntakeField: null,
      collected: emptyIntakeCollected(),
      lastPromptKey: null,
      lastActivityAt: "2020-10-18T22:13:26.000Z",
      lastProcessedExternalMessageId: "mid.1",
      ticketId: null,
      ticketStatus: null,
      ticketCode: null,
      suggestedSocialHandle: null,
      suggestedPhone: null,
      intakeSessionVersion: 1,
    };
    const result = await store.saveConversationSnapshot(
      "convo-missing",
      snapshot,
      "2020-10-18T22:13:26.000Z",
      null,
    );
    expect(result).toEqual({
      outcome: "failed",
      errorCode: "conversation_update_failed",
    });
    expect(maybeSingle).toHaveBeenCalled();
  });
});
