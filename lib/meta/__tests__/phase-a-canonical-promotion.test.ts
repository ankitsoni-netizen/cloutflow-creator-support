import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import {
  IDENTITY_AMBIGUOUS,
  scopedExternalConversationId,
} from "@/lib/meta/conversation-identity";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
} from "@/lib/meta/conversation-machine";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import {
  CREATOR_REASON_TEXT,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
} from "@/lib/meta/instagram-persona-copy";
import { PERSONA_PROMPT } from "@/lib/meta/prompt-keys";
import {
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  WHATSAPP_INTAKE_COPY,
} from "@/lib/meta/routing-copy";
import { CAMPAIGN_MONTH_YES_PAYLOAD } from "@/lib/meta/month-confirmation";
import { ingestWhatsAppInboundMessage } from "@/lib/meta/whatsapp-ingest";
import { whatsappExternalConversationId } from "@/lib/meta/whatsapp-ids";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { normalizeWatiWebhookPayload } from "@/lib/wati/normalize";
import {
  WATI_TEST_CHANNEL,
  WATI_TEST_WA_ID,
  watiTextPayload,
} from "@/lib/wati/__tests__/fixtures";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import type { DbTicket } from "@/lib/tickets/types";
import * as instagramSend from "@/lib/meta/instagram-send";
import * as watiSend from "@/lib/wati/send";
import * as emailSend from "@/lib/email/send";
import * as envCheck from "@/lib/email/env-check";

pinIdentitySchemaPhase("c");

const CREATOR_EMAIL = "riya@example.com";
const IG_PAGE = "17841400008460000";
const IG_CONTACT = "12334";
const IG_CANONICAL = scopedExternalConversationId(IG_PAGE, IG_CONTACT);
const OTHER_PAGE = "17841499999999999";
const OTHER_CONTACT = "99991";
const IG_CONTEXT = { webhookPayload: { sanitized: true } };
const WATI_CONTEXT = {
  webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
};
const WATI_CANONICAL = whatsappExternalConversationId(
  WATI_TEST_CHANNEL,
  WATI_TEST_WA_ID,
);

const STALE_INCOMPLETE = {
  igPersona: "creator",
  igCreatorReason: "existing_campaign",
  igIssueCategory: "campaign",
  brandName: "Stale Brand",
  campaignMonth: "January 2020",
  email: "stale@old.example",
  campaignMonthConfirmed: false,
  creatorName: "Stale Name",
};

const COMPLETE_COLLECTED = {
  ...STALE_INCOMPLETE,
  email: CREATOR_EMAIL,
  brandName: "Acme",
  campaignMonth: "August 2026",
  campaignMonthConfirmed: true,
};

function igEvent(mid: string, text: string, payload: string | null = null): NormalizedMetaInboundText {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: mid,
    externalMessageId: mid,
    externalConversationId: IG_CONTACT,
    externalContactId: IG_CONTACT,
    displayName: "riya_creates",
    senderName: "riya_creates",
    senderAddress: IG_CONTACT,
    messageType: "text",
    messageBody: text,
    timestamp: "2026-09-03T10:00:00.000Z",
    phoneNumberId: null,
    recipientAccountId: IG_PAGE,
    quickReplyPayload: payload,
    eventFragment: { message: { mid } },
  };
}

function createStore(channel: "instagram" | "whatsapp") {
  return withDurableConversationPersistence(
    createMemoryChatbotStore(channel, { identitySchema: "expanded" }),
  );
}

function cloneRow(row: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function seedPhaseARow(
  store: ReturnType<typeof createStore>,
  patch: Record<string, unknown>,
) {
  store.conversations.push({
    id: "phase-a-row",
    channel: "instagram",
    provider: null,
    recipientAccountId: null,
    identityStatus: null,
    externalConversationId: IG_CANONICAL,
    externalContactId: IG_CONTACT,
    displayName: "riya_creates",
    state: "awaiting_post_completion",
    ticketId: null,
    routingIntent: "creator_support",
    currentIntakeField: null,
    lastPromptKey: "awaiting_post_completion",
    lastActivityAt: "2026-09-03T09:00:00.000Z",
    lastProcessedExternalMessageId: "mid.old",
    collectedData: { ...STALE_INCOMPLETE, cachedUsername: "riya_creates" },
    intakeSessionVersion: 4,
    ...patch,
  });
}

function loadTicketFromStore(store: ReturnType<typeof createStore>) {
  return async (id: string): Promise<DbTicket | null> => {
    const row = store.tickets.find((ticket) => String(ticket.id) === id);
    if (!row) return null;
    return {
      id: String(row.id),
      ticket_code: String(row.ticketCode ?? row.ticket_code ?? "CF-2026-00000"),
      creator_name: null,
      creator_phone: null,
      creator_email: CREATOR_EMAIL,
      social_handle: null,
      platform: "instagram",
      issue_type: null,
      campaign_name: null,
      brand_name: null,
      campaign_month: null,
      cloutflow_poc_name: null,
      cloutflow_poc_contact_number: null,
      request_category: "creator_support",
      company_name: null,
      requester_type: null,
      topic_or_module: null,
      intake_details: null,
      source_channel: "instagram",
      status: "open",
      priority: "normal",
      assigned_team: "Creator Support",
      assigned_executive_id: null,
      assigned_executive_name: null,
      issue_description: null,
      internal_notes: null,
      acknowledgement_email_requested: true,
      acknowledgement_email_sent_at: null,
      resolution_summary: null,
      first_response_at: null,
      resolved_at: null,
      customer_last_notified_at: null,
      metadata: null,
      external_contact_id: String(row.external_contact_id ?? IG_CONTACT),
      external_conversation_id: String(
        row.external_conversation_id ?? IG_CANONICAL,
      ),
      identity_status: (row.identity_status as string | null) ?? null,
      created_at: "2026-09-03T00:00:00.000Z",
      updated_at: "2026-09-03T00:00:00.000Z",
    };
  };
}

function lastOutbound(store: ReturnType<typeof createStore>): string {
  const last = [...store.messages]
    .reverse()
    .find((row) => row.direction === "outbound");
  return String(last?.messageBody ?? "");
}

function eventFromWatiPayload(payload: Record<string, unknown>) {
  const now = new Date("2026-09-03T10:00:00.000Z");
  const normalized = normalizeWatiWebhookPayload({
    ...payload,
    timestamp: String(Math.floor(now.getTime() / 1000)),
    created: now.toISOString(),
  });
  expect(normalized.events).toHaveLength(1);
  return normalized.events[0]!;
}

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "wati";
  process.env.WATI_CONVERSATION_TARGET_MODE = "recipient";
  process.env.WATI_CHANNEL_PHONE_NUMBER = WATI_TEST_CHANNEL;
  vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.out",
    recipientId: IG_CONTACT,
  });
  vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.out.text",
    recipientId: IG_CONTACT,
  });
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
  vi.spyOn(envCheck, "isBrevoConfigured").mockReturnValue(true);
  vi.spyOn(emailSend, "sendTransactionalEmail").mockResolvedValue({
    messageId: "brevo-ack-1",
    accepted: [CREATOR_EMAIL],
    rejected: [],
    status: "accepted_by_brevo",
  });
});

afterEach(() => {
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.WATI_CONVERSATION_TARGET_MODE;
  delete process.env.WATI_CHANNEL_PHONE_NUMBER;
  vi.restoreAllMocks();
});

describe("Phase A canonical null-identity promotion", () => {
  it("1-6,13. exact Phase A canonical row is promoted once from the verified webhook", async () => {
    const store = createStore("instagram");
    seedPhaseARow(store, {});
    store.messages.push({
      id: "hist-1",
      conversationId: "phase-a-row",
      channel: "instagram",
      direction: "inbound",
      messageBody: "older history",
      externalMessageId: "mid.old",
    });
    const previousVersion = 4;
    vi.mocked(instagramSend.sendInstagramQuickReplies).mockClear();
    const event = igEvent("ig.promote", "Hello again");
    const [first, second] = await Promise.all([
      ingestInstagramInboundMessage(event, store, IG_CONTEXT, {
        loadTicket: loadTicketFromStore(store),
      }),
      ingestInstagramInboundMessage(event, store, IG_CONTEXT, {
        loadTicket: loadTicketFromStore(store),
      }),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(
      ["duplicate", "stored"].sort(),
    );
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledTimes(1);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]?.id).toBe("phase-a-row");
    expect(store.conversations[0]?.provider).toBe(META_INSTAGRAM_PROVIDER);
    expect(store.conversations[0]?.recipientAccountId).toBe(IG_PAGE);
    expect(store.conversations[0]?.identityStatus).toBe("unambiguous");
    expect(store.conversations[0]?.externalContactId).toBe(IG_CONTACT);
    expect(store.conversations[0]?.externalConversationId).toBe(IG_CANONICAL);
    const snapshot = await reloadConversationSnapshot(
      store,
      "instagram",
      event.externalConversationId,
      identityLookupFromEvent(event),
    );
    expect(snapshot.state).toBe("awaiting_persona");
    expect(snapshot.lastPromptKey).toBe(PERSONA_PROMPT.personaRecover);
    expect(snapshot.intakeSessionVersion).toBe(previousVersion + 1);
    expect(snapshot.collected.brandName).toBeNull();
    expect(snapshot.collected.cachedUsername).toBe("riya_creates");
    expect(lastOutbound(store)).toContain("welcome to Cloutflow");
    expect(store.tickets).toHaveLength(0);
    expect(store.emails).toHaveLength(0);
    expect(
      store.messages.filter((row) => row.id === "hist-1"),
    ).toHaveLength(1);

    const retry = await ingestInstagramInboundMessage(event, store, IG_CONTEXT, {
      loadTicket: loadTicketFromStore(store),
    });
    expect(retry.outcome).toBe("duplicate");
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledTimes(1);

    const selected = await ingestInstagramInboundMessage(
      igEvent("ig.persona", PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(selected.outcome).toBe("stored");
    expect(store.conversations[0]?.state).toBe("awaiting_creator_reason");
    expect(lastOutbound(store)).toContain(CREATOR_REASON_TEXT);
    expect(store.tickets).toHaveLength(0);

    const waStore = createStore("whatsapp");
    waStore.conversations.push({
      id: "phase-a-wati",
      channel: "whatsapp",
      provider: null,
      recipientAccountId: null,
      identityStatus: null,
      externalConversationId: WATI_CANONICAL,
      externalContactId: WATI_TEST_WA_ID,
      displayName: "coubbb",
      state: "awaiting_post_completion",
      ticketId: null,
      routingIntent: "creator_support",
      lastPromptKey: "awaiting_post_completion",
      lastProcessedExternalMessageId: "wamid.old",
      collectedData: { ...STALE_INCOMPLETE, cachedUsername: "coubbb" },
      intakeSessionVersion: 2,
    });
    vi.mocked(watiSend.sendWatiInteractiveMessage).mockClear();
    const waEvent = eventFromWatiPayload(
      watiTextPayload({ text: "Hello again", whatsappMessageId: "wamid.promote" }),
    );
    const waResult = await ingestWhatsAppInboundMessage(waEvent, waStore, WATI_CONTEXT, {
      loadTicket: loadTicketFromStore(waStore),
    });
    expect(waResult.outcome).toBe("stored");
    expect(waStore.conversations[0]?.id).toBe("phase-a-wati");
    expect(waStore.conversations[0]?.provider).toBe(WATI_WHATSAPP_PROVIDER);
    expect(waStore.conversations[0]?.recipientAccountId).toBe(WATI_TEST_CHANNEL);
    expect(waStore.conversations[0]?.identityStatus).toBe("unambiguous");
    expect(waStore.conversations[0]?.state).toBe("awaiting_persona");
    expect(waStore.conversations[0]?.lastPromptKey).toBe(PERSONA_PROMPT.personaRecover);
    expect(watiSend.sendWatiInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(waStore.tickets).toHaveLength(0);
    expect(waStore.emails).toHaveLength(0);
  });

  it("7. sender-only null legacy row is not promoted", async () => {
    const store = createStore("instagram");
    seedPhaseARow(store, { externalConversationId: IG_CONTACT });
    const before = cloneRow(store.conversations[0]!);
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.sender-only", "Hi"),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result).toMatchObject({ outcome: "failed", errorCode: IDENTITY_AMBIGUOUS });
    expect(store.conversations[0]).toEqual(before);
    expect(store.conversations).toHaveLength(1);
  });

  it("8. explicitly ambiguous sender-only row is byte-for-byte unchanged", async () => {
    const store = createStore("instagram");
    store.conversations.push({
      id: "audited-ambiguous",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: null,
      identityStatus: "ambiguous",
      externalConversationId: IG_CONTACT,
      externalContactId: IG_CONTACT,
      state: "awaiting_post_completion",
      ticketId: null,
      collectedData: { ...STALE_INCOMPLETE },
      intakeSessionVersion: 2,
    });
    const before = cloneRow(store.conversations[0]!);
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.ambiguous", "Hi"),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result).toMatchObject({ outcome: "failed", errorCode: IDENTITY_AMBIGUOUS });
    expect(store.conversations[0]).toEqual(before);
  });

  it("9. contact mismatch fails closed", async () => {
    const store = createStore("instagram");
    seedPhaseARow(store, { externalContactId: OTHER_CONTACT });
    const before = cloneRow(store.conversations[0]!);
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.mismatch-contact", "Hi"),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result.outcome).toBe("failed");
    expect(store.conversations[0]).toEqual(before);
    expect(store.conversations[0]?.provider).toBeNull();
    expect(store.conversations[0]?.identityStatus).toBeNull();
  });

  it("10. canonical-key mismatch fails closed", async () => {
    const store = createStore("instagram");
    seedPhaseARow(store, {
      externalConversationId: scopedExternalConversationId(OTHER_PAGE, IG_CONTACT),
    });
    const before = cloneRow(store.conversations[0]!);
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.mismatch-canonical", "Hi"),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result).toMatchObject({ outcome: "failed", errorCode: IDENTITY_AMBIGUOUS });
    expect(store.conversations[0]).toEqual(before);
    expect(store.conversations).toHaveLength(1);
  });

  it("11. competing conversation or ticket candidate fails closed", async () => {
    const competingConvo = createStore("instagram");
    seedPhaseARow(competingConvo, {});
    competingConvo.conversations.push({
      id: "sender-only-competitor",
      channel: "instagram",
      provider: null,
      recipientAccountId: null,
      identityStatus: null,
      externalConversationId: IG_CONTACT,
      externalContactId: IG_CONTACT,
      state: "awaiting_post_completion",
      ticketId: null,
      collectedData: {},
    });
    const beforeRows = competingConvo.conversations.map((row) => cloneRow(row));
    const convoResult = await ingestInstagramInboundMessage(
      igEvent("ig.compete-convo", "Hi"),
      competingConvo,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(competingConvo) },
    );
    expect(convoResult).toMatchObject({
      outcome: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(competingConvo.conversations.map((row) => cloneRow(row))).toEqual(beforeRows);

    const competingTicket = createStore("instagram");
    seedPhaseARow(competingTicket, {});
    competingTicket.tickets.push({
      id: "unstamped-ticket",
      status: "open",
      ticketCode: "CF-2026-00998",
      sourceChannel: "instagram",
      source_channel: "instagram",
      external_contact_id: IG_CONTACT,
      external_conversation_id: IG_CANONICAL,
      identity_status: null,
    });
    const beforeTicketRow = cloneRow(competingTicket.conversations[0]!);
    const ticketResult = await ingestInstagramInboundMessage(
      igEvent("ig.compete-ticket", "Hi"),
      competingTicket,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(competingTicket) },
    );
    expect(ticketResult).toMatchObject({
      outcome: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(competingTicket.conversations[0]).toEqual(beforeTicketRow);
    expect(competingTicket.conversations[0]?.identityStatus).toBeNull();
  });

  it("12. existing Phase C canonical conversations are unchanged", async () => {
    const store = createStore("instagram");
    store.conversations.push({
      id: "phase-c-row",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: IG_PAGE,
      identityStatus: "unambiguous",
      externalConversationId: IG_CANONICAL,
      externalContactId: IG_CONTACT,
      displayName: "riya_creates",
      state: "awaiting_persona",
      ticketId: null,
      lastPromptKey: "awaiting_persona",
      lastProcessedExternalMessageId: "mid.old",
      collectedData: { cachedUsername: "riya_creates" },
      intakeSessionVersion: 1,
    });
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.phase-c", PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.id).toBe("phase-c-row");
    expect(store.conversations[0]?.provider).toBe(META_INSTAGRAM_PROVIDER);
    expect(store.conversations[0]?.recipientAccountId).toBe(IG_PAGE);
    expect(store.conversations[0]?.identityStatus).toBe("unambiguous");
    expect(store.conversations).toHaveLength(1);
  });

  it("14. Meta WhatsApp remains unchanged", () => {
    const campaign = reduceChannelConversation(
      emptyConversationSnapshot({ suggestedPhone: "+16315551181" }),
      {
        text: "Need help",
        quickReplyPayload: null,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: "wamid.first",
      },
      WHATSAPP_INTAKE_COPY,
    );
    const support = reduceChannelConversation(
      campaign.snapshot,
      {
        text: "Creator Support",
        quickReplyPayload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: "wamid.route",
      },
      WHATSAPP_INTAKE_COPY,
    );
    const creator = reduceChannelConversation(
      support.snapshot,
      {
        text: "Riya Sharma, riya@example.com",
        quickReplyPayload: null,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: "wamid.creator",
      },
      WHATSAPP_INTAKE_COPY,
    );
    const platform = reduceChannelConversation(
      creator.snapshot,
      {
        text: "Instagram, @riya_creates",
        quickReplyPayload: null,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: "wamid.platform",
      },
      WHATSAPP_INTAKE_COPY,
    );
    const details = reduceChannelConversation(
      platform.snapshot,
      {
        text: "Acme, June 2026",
        quickReplyPayload: null,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: "wamid.campaign",
      },
      WHATSAPP_INTAKE_COPY,
    );
    const yes = reduceChannelConversation(
      details.snapshot,
      {
        text: "Yes",
        quickReplyPayload: CAMPAIGN_MONTH_YES_PAYLOAD,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: "wamid.yes",
      },
      WHATSAPP_INTAKE_COPY,
    );
    expect(yes.snapshot.state).toBe("ticket_open");
    expect(
      yes.effects.filter((effect) => effect.type === "create_ticket"),
    ).toHaveLength(1);
  });

  it("15. complete collected recovery still reaches Raise/Edit after promotion", async () => {
    const store = createStore("instagram");
    seedPhaseARow(store, { collectedData: { ...COMPLETE_COLLECTED } });
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.complete", "Hi"),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations[0]?.identityStatus).toBe("unambiguous");
    expect(store.conversations[0]?.state).toBe("creator_confirmation");
    expect(store.conversations[0]?.lastPromptKey).toContain(
      PERSONA_PROMPT.creatorConfirm,
    );
    expect(lastOutbound(store)).toContain("Should I raise a support ticket");
    expect(lastOutbound(store)).toContain("Brand: Acme");
    expect(store.tickets).toHaveLength(0);
  });

  it("16. active-ticket relinking still prevents automation restart", async () => {
    const store = createStore("instagram");
    store.conversations.push({
      id: "phase-c-linked",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: IG_PAGE,
      identityStatus: "unambiguous",
      externalConversationId: IG_CANONICAL,
      externalContactId: IG_CONTACT,
      state: "awaiting_post_completion",
      ticketId: null,
      lastPromptKey: "awaiting_post_completion",
      lastProcessedExternalMessageId: "mid.old",
      collectedData: { ...STALE_INCOMPLETE },
      intakeSessionVersion: 3,
    });
    store.tickets.push({
      id: "existing-ig",
      status: "open",
      ticketCode: "CF-2026-00999",
      ticket_code: "CF-2026-00999",
      sourceChannel: "instagram",
      source_channel: "instagram",
      external_contact_id: IG_CONTACT,
      external_conversation_id: IG_CANONICAL,
      identity_status: "unambiguous",
      recipient_account_id: IG_PAGE,
      provider: META_INSTAGRAM_PROVIDER,
    });
    vi.mocked(instagramSend.sendInstagramQuickReplies).mockClear();
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.relink", "Hi"),
      store,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(store) },
    );
    expect(result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(store.conversations[0]?.ticketId).toBe("existing-ig");
    expect(store.conversations[0]?.state).not.toBe("awaiting_persona");
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });
});
