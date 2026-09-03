import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { IDENTITY_AMBIGUOUS, scopedExternalConversationId } from "@/lib/meta/conversation-identity";
import { runWithIdentitySchemaPhaseAsync } from "@/lib/meta/identity-schema-phase";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import { ingestWhatsAppInboundMessage } from "@/lib/meta/whatsapp-ingest";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
} from "@/lib/meta/conversation-machine";
import { isRecoverableCreatorConfirmation } from "@/lib/meta/instagram-persona-machine";
import {
  BRAND_BOOK_CALL_PAYLOAD,
  BRAND_BOOK_CALL_TITLE,
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_CAMPAIGN_ISSUE_TITLE,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_TITLE,
  CREATOR_REASON_TEXT,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  CREATOR_TICKET_CONFIRM_TITLE,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_BRAND_TITLE,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
  POST_COMPLETION_QUESTION_TEXT,
} from "@/lib/meta/instagram-persona-copy";
import { CAMPAIGN_MONTH_YES_PAYLOAD } from "@/lib/meta/month-confirmation";
import {
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  WHATSAPP_INTAKE_COPY,
} from "@/lib/meta/routing-copy";
import { PERSONA_PROMPT } from "@/lib/meta/prompt-keys";
import {
  INSTAGRAM_EMAIL_DRAIN_PURPOSES,
  drainDueInstagramEmails,
} from "@/lib/meta/instagram-email-outbox";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { normalizeWatiWebhookPayload } from "@/lib/wati/normalize";
import {
  WATI_TEST_CHANNEL,
  WATI_TEST_WA_ID,
  watiTextPayload,
} from "@/lib/wati/__tests__/fixtures";
import { whatsappExternalConversationId } from "@/lib/meta/whatsapp-ids";
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
const IG_CONTEXT = { webhookPayload: { sanitized: true } };
const WATI_CONTEXT = {
  webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
};

function igEvent(
  mid: string,
  text: string,
  payload: string | null = null,
  contactId = IG_CONTACT,
): NormalizedMetaInboundText {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: mid,
    externalMessageId: mid,
    externalConversationId: contactId,
    externalContactId: contactId,
    displayName: "riya_creates",
    senderName: "riya_creates",
    senderAddress: contactId,
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

function ticketFromStore(
  store: ReturnType<typeof createStore>,
  index = 0,
): DbTicket {
  const row = store.tickets[index];
  expect(row).toBeTruthy();
  return {
    id: String(row!.id),
    ticket_code: String(row!.ticketCode ?? row!.ticket_code),
    creator_name: null,
    creator_phone: null,
    creator_email: (row!.creator_email as string | null) ?? CREATOR_EMAIL,
    social_handle: null,
    platform: "instagram",
    issue_type: (row!.issue_type as string | null) ?? null,
    campaign_name: (row!.campaign_name as string | null) ?? null,
    brand_name: (row!.brand_name as string | null) ?? null,
    campaign_month: (row!.campaign_month as string | null) ?? null,
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: "creator_support",
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: null,
    source_channel: row!.source_channel === "whatsapp" ? "whatsapp" : "instagram",
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
    metadata: (row!.metadata as Record<string, unknown> | null) ?? null,
    external_contact_id: String(row!.external_contact_id),
    external_conversation_id: String(row!.external_conversation_id),
    identity_status: (row!.identity_status as string | null) ?? null,
    created_at: "2026-09-03T00:00:00.000Z",
    updated_at: "2026-09-03T00:00:00.000Z",
  };
}

function loadTicketFromStore(store: ReturnType<typeof createStore>) {
  return async (id: string) => {
    const index = store.tickets.findIndex((row) => String(row.id) === id);
    if (index < 0) return null;
    return ticketFromStore(store, index);
  };
}

async function sendIg(
  store: ReturnType<typeof createStore>,
  event: NormalizedMetaInboundText,
) {
  const result = await ingestInstagramInboundMessage(event, store, IG_CONTEXT, {
    loadTicket: loadTicketFromStore(store),
  });
  const snapshot = await reloadConversationSnapshot(
    store,
    "instagram",
    event.externalConversationId,
    identityLookupFromEvent(event),
  );
  return { result, event, snapshot };
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

async function sendWati(
  store: ReturnType<typeof createStore>,
  payload: Record<string, unknown>,
) {
  const event = eventFromWatiPayload(payload);
  const result = await ingestWhatsAppInboundMessage(event, store, WATI_CONTEXT, {
    loadTicket: loadTicketFromStore(store),
  });
  const snapshot = await reloadConversationSnapshot(
    store,
    "whatsapp",
    event.externalConversationId,
    identityLookupFromEvent(event),
  );
  return { result, event, snapshot };
}

async function playIgToBrokenPostCompletion(store: ReturnType<typeof createStore>) {
  await sendIg(store, igEvent("ig.hi", "Hi"));
  await sendIg(
    store,
    igEvent("ig.persona", PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD),
  );
  await sendIg(
    store,
    igEvent(
      "ig.existing",
      CREATOR_EXISTING_CAMPAIGN_TITLE,
      CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
    ),
  );
  await sendIg(
    store,
    igEvent(
      "ig.issue",
      CREATOR_CAMPAIGN_ISSUE_TITLE,
      CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
    ),
  );
  await sendIg(
    store,
    igEvent("ig.campaign", `Acme, August 2026, ${CREATOR_EMAIL}`),
  );
  await sendIg(store, igEvent("ig.yes", "Yes", CAMPAIGN_MONTH_YES_PAYLOAD));
  const row = store.conversations[0];
  expect(row).toBeTruthy();
  row!.state = "awaiting_post_completion";
  row!.ticketId = null;
  row!.lastPromptKey = "awaiting_post_completion";
}

async function playWatiToBrokenPostCompletion(store: ReturnType<typeof createStore>) {
  await sendWati(store, watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi" }));
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
      text: CREATOR_CAMPAIGN_ISSUE_TITLE,
      whatsappMessageId: "wamid.issue",
    }),
  );
  await sendWati(
    store,
    watiTextPayload({
      text: `Acme, August 2026, ${CREATOR_EMAIL}`,
      whatsappMessageId: "wamid.campaign",
    }),
  );
  await sendWati(
    store,
    watiTextPayload({
      text: "Yes",
      type: "button",
      buttonReply: { title: "Yes" },
      whatsappMessageId: "wamid.yes",
    }),
  );
  const row = store.conversations[0];
  expect(row).toBeTruthy();
  row!.state = "awaiting_post_completion";
  row!.ticketId = null;
  row!.lastPromptKey = "awaiting_post_completion";
}

function lastOutbound(store: ReturnType<typeof createStore>): string {
  const last = [...store.messages]
    .reverse()
    .find((row) => row.direction === "outbound");
  return String(last?.messageBody ?? "");
}

const STALE_CREATOR_COLLECTED = {
  igPersona: "creator",
  igCreatorReason: "existing_campaign",
  igIssueCategory: "campaign",
  brandName: "Stale Brand",
  campaignMonth: "January 2020",
  email: "stale@old.example",
  campaignMonthConfirmed: false,
  creatorName: "Stale Name",
  issueDescription: "old issue text",
};

function stampIncompletePostCompletion(store: ReturnType<typeof createStore>) {
  const row = store.conversations[0];
  expect(row).toBeTruthy();
  const previousVersion = Number(row!.intakeSessionVersion ?? 0);
  row!.state = "awaiting_post_completion";
  row!.ticketId = null;
  row!.routingIntent = "creator_support";
  row!.lastPromptKey = "awaiting_post_completion";
  row!.collectedData = {
    ...((row!.collectedData as Record<string, unknown>) ?? {}),
    ...STALE_CREATOR_COLLECTED,
  };
  return previousVersion;
}

function welcomeOutboundCount(store: ReturnType<typeof createStore>): number {
  return store.messages.filter(
    (row) =>
      row.direction === "outbound" &&
      String(row.messageBody).includes("welcome to Cloutflow"),
  ).length;
}

function cloneConversation(row: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
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

describe("broken Production snapshot recovery", () => {
  it("1-3,9-11. awaiting_post_completion without a ticket returns to the final summary", async () => {
    const igStore = createStore("instagram");
    await playIgToBrokenPostCompletion(igStore);
    const recovered = await sendIg(igStore, igEvent("ig.recover", "Hi"));
    expect(recovered.result.outcome).toBe("stored");
    expect(recovered.snapshot.state).toBe("creator_confirmation");
    expect(igStore.tickets).toHaveLength(0);
    expect(recovered.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.creatorConfirm);
    expect(lastOutbound(igStore)).toContain("Issue type: Campaign issue");
    expect(lastOutbound(igStore)).toContain("Brand: Acme");
    expect(lastOutbound(igStore)).toContain("Month: August 2026");
    expect(lastOutbound(igStore)).toContain(`Email: ${CREATOR_EMAIL}`);
    expect(lastOutbound(igStore)).not.toContain("Campaign:");
    expect(JSON.stringify(lastOutbound(igStore))).not.toContain(META_INSTAGRAM_PROVIDER);
    expect(JSON.stringify(lastOutbound(igStore))).not.toContain(IG_PAGE);

    const retry = await ingestInstagramInboundMessage(
      recovered.event,
      igStore,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(igStore) },
    );
    expect(retry.outcome).toBe("duplicate");
    expect(igStore.tickets).toHaveLength(0);

    const raised = await sendIg(
      igStore,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(igStore.tickets).toHaveLength(1);
    expect(igStore.tickets[0]?.campaign_name).toBeNull();
    expect(igStore.tickets[0]?.identity_status).toBe("unambiguous");
    expect(raised.snapshot.ticketId).toBe(String(igStore.tickets[0]?.id));

    const waStore = createStore("whatsapp");
    await playWatiToBrokenPostCompletion(waStore);
    const waRecovered = await sendWati(
      waStore,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.recover" }),
    );
    expect(waRecovered.snapshot.state).toBe("creator_confirmation");
    expect(waStore.tickets).toHaveLength(0);
    expect(lastOutbound(waStore)).toContain("Issue type: Campaign issue");
    await sendWati(
      waStore,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise",
      }),
    );
    expect(waStore.tickets).toHaveLength(1);
    expect(waStore.tickets[0]?.identity_status).toBe("unambiguous");
  });

  it("4. exact unambiguous ticket is relinked without a duplicate", async () => {
    const igStore = createStore("instagram");
    await playIgToBrokenPostCompletion(igStore);
    const canonical = scopedExternalConversationId(IG_PAGE, IG_CONTACT);
    igStore.tickets.push({
      id: "existing-ig",
      status: "open",
      ticketCode: "CF-2026-00999",
      ticket_code: "CF-2026-00999",
      sourceChannel: "instagram",
      source_channel: "instagram",
      external_contact_id: IG_CONTACT,
      external_conversation_id: canonical,
      identity_status: "unambiguous",
      recipient_account_id: IG_PAGE,
      provider: META_INSTAGRAM_PROVIDER,
      campaign_name: null,
      creator_email: CREATOR_EMAIL,
    });
    const follow = await sendIg(igStore, igEvent("ig.relink", "Any update?"));
    expect(igStore.tickets).toHaveLength(1);
    expect(follow.snapshot.ticketId).toBe("existing-ig");
    expect(follow.snapshot.state).not.toBe("creator_confirmation");
    expect(follow.snapshot.state).not.toBe("awaiting_persona");
  });

  it("5. an unproven existing ticket fails closed and does not create another", async () => {
    const igStore = createStore("instagram");
    await playIgToBrokenPostCompletion(igStore);
    const canonical = scopedExternalConversationId(IG_PAGE, IG_CONTACT);
    igStore.tickets.push({
      id: "unstamped-ig",
      status: "open",
      ticketCode: "CF-2026-00998",
      ticket_code: "CF-2026-00998",
      sourceChannel: "instagram",
      source_channel: "instagram",
      external_contact_id: IG_CONTACT,
      external_conversation_id: canonical,
      identity_status: null,
      recipient_account_id: IG_PAGE,
      campaign_name: null,
    });
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.ambiguous", "Hi"),
      igStore,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(igStore) },
    );
    expect(result).toMatchObject({ outcome: "failed", errorCode: IDENTITY_AMBIGUOUS });
    expect(igStore.tickets).toHaveLength(1);
    expect(igStore.conversations[0]?.ticketId).toBeNull();
    expect(igStore.conversations[0]?.state).toBe("awaiting_post_completion");
  });

  it("6-8. failed WATI email is drainable, sent is not resent, exhausted stays stopped", async () => {
    expect(INSTAGRAM_EMAIL_DRAIN_PURPOSES).toContain("whatsapp-ticket-confirmation");
    const waStore = createStore("whatsapp");
    waStore.tickets.push({
      id: "wa-ticket",
      status: "open",
      ticketCode: "CF-2026-00888",
      ticket_code: "CF-2026-00888",
      source_channel: "whatsapp",
      creator_email: CREATOR_EMAIL,
      campaign_name: null,
      identity_status: "unambiguous",
      external_contact_id: WATI_TEST_WA_ID,
      external_conversation_id: whatsappExternalConversationId(
        WATI_TEST_CHANNEL,
        WATI_TEST_WA_ID,
      ),
    });
    waStore.emails.push({
      id: "email-failed",
      ticketId: "wa-ticket",
      conversationId: "convo-wa",
      purpose: "whatsapp-ticket-confirmation",
      idempotencyKey: "email:wa-confirm:wa-ticket",
      deliveryStatus: "failed",
      errorCode: "email_send_failed",
      updatedAt: "2026-09-03T09:00:00.000Z",
    });
    const due = await waStore.listDueInstagramEmailDeliveries({
      nowIso: "2026-09-03T10:01:00.000Z",
      limit: 10,
    });
    expect(due).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purpose: "whatsapp-ticket-confirmation",
          deliveryStatus: "failed",
        }),
      ]),
    );

    const drained = await drainDueInstagramEmails({
      store: waStore,
      now: new Date("2026-09-03T10:01:00.000Z"),
      loadTicket: loadTicketFromStore(waStore),
    });
    expect(drained.claimed).toBeGreaterThanOrEqual(1);
    expect(drained.sent).toBeGreaterThanOrEqual(1);
    expect(waStore.emails[0]?.deliveryStatus).toBe("sent");
    const mail = vi.mocked(emailSend.sendTransactionalEmail).mock.calls[0]?.[0];
    expect(mail?.toEmail).toBe(CREATOR_EMAIL);
    expect(mail?.text).toContain("CF-2026-00888");
    expect(JSON.stringify(mail)).not.toMatch(/console|logger/i);

    vi.mocked(emailSend.sendTransactionalEmail).mockClear();
    const second = await drainDueInstagramEmails({
      store: waStore,
      now: new Date("2026-09-03T10:05:00.000Z"),
      loadTicket: loadTicketFromStore(waStore),
    });
    expect(second.claimed).toBe(0);
    expect(emailSend.sendTransactionalEmail).not.toHaveBeenCalled();

    waStore.emails.push({
      id: "email-exhausted",
      ticketId: "wa-ticket",
      conversationId: "convo-wa",
      purpose: "whatsapp-ticket-confirmation",
      idempotencyKey: "email:wa-confirm:exhausted",
      deliveryStatus: "failed",
      errorCode: "email_retry_exhausted",
      updatedAt: "2026-09-03T09:00:00.000Z",
    });
    const exhausted = await drainDueInstagramEmails({
      store: waStore,
      now: new Date("2026-09-03T10:06:00.000Z"),
      loadTicket: loadTicketFromStore(waStore),
    });
    expect(exhausted.claimed).toBe(0);
    expect(
      waStore.emails.find((row) => row.id === "email-exhausted")?.deliveryStatus,
    ).toBe("failed");
    expect(
      waStore.emails.find((row) => row.id === "email-exhausted")?.errorCode,
    ).toBe("email_retry_exhausted");
  });

  it("12. recovered then raised tickets keep Hi on the active ticket", async () => {
    const igStore = createStore("instagram");
    await playIgToBrokenPostCompletion(igStore);
    await sendIg(igStore, igEvent("ig.recover", "Hi"));
    await sendIg(
      igStore,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    const follow = await sendIg(igStore, igEvent("ig.hi2", "Hi"));
    expect(igStore.tickets).toHaveLength(1);
    expect(follow.snapshot.ticketId).toBe(String(igStore.tickets[0]?.id));
    expect(follow.snapshot.state).not.toBe("awaiting_persona");
  });

  it("13. two creators stay isolated after recovery", async () => {
    const igStore = createStore("instagram");
    await playIgToBrokenPostCompletion(igStore);
    await sendIg(igStore, igEvent("ig.recover", "Hi"));
    await sendIg(
      igStore,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    const other = await sendIg(igStore, igEvent("igb.hi", "Hi", null, "99991"));
    expect(other.snapshot.state).toBe("awaiting_persona");
    expect(igStore.tickets).toHaveLength(1);
  });

  it("14. Meta WhatsApp month Yes still creates a ticket without persona recovery", () => {
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
    expect(yes.effects.filter((effect) => effect.type === "create_ticket")).toHaveLength(1);
    expect(
      isRecoverableCreatorConfirmation({
        ...yes.snapshot,
        state: "awaiting_post_completion",
        ticketId: null,
      }),
    ).toBe(false);
  });
});

describe("incomplete awaiting_post_completion recovery", () => {
  it("1-6,11-12. incomplete collected restarts a fresh persona session once", async () => {
    const igStore = createStore("instagram");
    await sendIg(igStore, igEvent("ig.hi", "Hi"));
    const previousVersion = stampIncompletePostCompletion(igStore);
    const cachedUsername = (
      igStore.conversations[0]?.collectedData as Record<string, unknown>
    )?.cachedUsername;

    vi.mocked(instagramSend.sendInstagramQuickReplies).mockClear();
    const recoverEvent = igEvent("ig.recover", "Hello again");
    const [first, second] = await Promise.all([
      ingestInstagramInboundMessage(recoverEvent, igStore, IG_CONTEXT, {
        loadTicket: loadTicketFromStore(igStore),
      }),
      ingestInstagramInboundMessage(recoverEvent, igStore, IG_CONTEXT, {
        loadTicket: loadTicketFromStore(igStore),
      }),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(
      ["duplicate", "stored"].sort(),
    );
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledTimes(1);
    expect(igStore.tickets).toHaveLength(0);
    expect(igStore.emails).toHaveLength(0);

    const recovered = await reloadConversationSnapshot(
      igStore,
      "instagram",
      recoverEvent.externalConversationId,
      identityLookupFromEvent(recoverEvent),
    );
    expect(recovered.state).toBe("awaiting_persona");
    expect(recovered.ticketId).toBeNull();
    expect(recovered.intakeSessionVersion).toBe(previousVersion + 1);
    expect(recovered.lastPromptKey).toBe(PERSONA_PROMPT.personaRecover);
    expect(welcomeOutboundCount(igStore)).toBe(2);
    expect(lastOutbound(igStore)).toContain("welcome to Cloutflow");
    expect(lastOutbound(igStore)).not.toContain("Stale Brand");
    expect(lastOutbound(igStore)).not.toContain("Raise ticket");
    expect(recovered.collected.brandName).toBeNull();
    expect(recovered.collected.campaignMonth).toBeNull();
    expect(recovered.collected.email).toBeNull();
    expect(recovered.collected.igIssueCategory).toBeNull();
    expect(recovered.collected.igCreatorReason).toBeNull();
    expect(recovered.collected.creatorName).toBeNull();
    expect(recovered.collected.issueDescription).toBeNull();
    expect(recovered.collected.campaignMonthConfirmed).toBe(false);
    expect(recovered.collected.cachedUsername).toBe(cachedUsername);

    const retry = await ingestInstagramInboundMessage(
      recoverEvent,
      igStore,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(igStore) },
    );
    expect(retry.outcome).toBe("duplicate");
    expect(igStore.tickets).toHaveLength(0);
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledTimes(1);
    expect(
      (await reloadConversationSnapshot(
        igStore,
        "instagram",
        recoverEvent.externalConversationId,
        identityLookupFromEvent(recoverEvent),
      )).intakeSessionVersion,
    ).toBe(previousVersion + 1);

    const selected = await sendIg(
      igStore,
      igEvent("ig.persona", PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD),
    );
    expect(selected.result.outcome).toBe("stored");
    expect(selected.snapshot.state).toBe("awaiting_creator_reason");
    expect(lastOutbound(igStore)).toContain(CREATOR_REASON_TEXT);
    expect(igStore.tickets).toHaveLength(0);
    expect(igStore.emails).toHaveLength(0);

    const waStore = createStore("whatsapp");
    await sendWati(waStore, watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi" }));
    const waPrevious = stampIncompletePostCompletion(waStore);
    vi.mocked(watiSend.sendWatiInteractiveMessage).mockClear();
    const waEvent = eventFromWatiPayload(
      watiTextPayload({ text: "Hello again", whatsappMessageId: "wamid.recover" }),
    );
    const [waFirst, waSecond] = await Promise.all([
      ingestWhatsAppInboundMessage(waEvent, waStore, WATI_CONTEXT, {
        loadTicket: loadTicketFromStore(waStore),
      }),
      ingestWhatsAppInboundMessage(waEvent, waStore, WATI_CONTEXT, {
        loadTicket: loadTicketFromStore(waStore),
      }),
    ]);
    expect([waFirst.outcome, waSecond.outcome].sort()).toEqual(
      ["duplicate", "stored"].sort(),
    );
    expect(watiSend.sendWatiInteractiveMessage).toHaveBeenCalledTimes(1);
    const waRecovered = await reloadConversationSnapshot(
      waStore,
      "whatsapp",
      waEvent.externalConversationId,
      identityLookupFromEvent(waEvent),
    );
    expect(waRecovered.state).toBe("awaiting_persona");
    expect(waRecovered.lastPromptKey).toBe(PERSONA_PROMPT.personaRecover);
    expect(waRecovered.intakeSessionVersion).toBe(waPrevious + 1);
    expect(waRecovered.collected.brandName).toBeNull();
    expect(waStore.tickets).toHaveLength(0);
    expect(waStore.emails).toHaveLength(0);

    const waRetry = await ingestWhatsAppInboundMessage(
      waEvent,
      waStore,
      WATI_CONTEXT,
      { loadTicket: loadTicketFromStore(waStore) },
    );
    expect(waRetry.outcome).toBe("duplicate");
    expect(watiSend.sendWatiInteractiveMessage).toHaveBeenCalledTimes(1);

    await sendWati(
      waStore,
      watiTextPayload({
        text: PERSONA_CREATOR_TITLE,
        type: "button",
        buttonReply: { title: PERSONA_CREATOR_TITLE },
        whatsappMessageId: "wamid.persona",
      }),
    );
    expect(waStore.conversations[0]?.state).toBe("awaiting_creator_reason");
    expect(waStore.tickets).toHaveLength(0);
  });

  it("7. complete collected data still recovers to the Raise/Edit summary", async () => {
    const igStore = createStore("instagram");
    await playIgToBrokenPostCompletion(igStore);
    const recovered = await sendIg(igStore, igEvent("ig.complete", "Hi"));
    expect(recovered.snapshot.state).toBe("creator_confirmation");
    expect(recovered.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.creatorConfirm);
    expect(lastOutbound(igStore)).toContain("Should I raise a support ticket");
    expect(lastOutbound(igStore)).toContain("Brand: Acme");
    expect(igStore.tickets).toHaveLength(0);
  });

  it("8. exact unambiguous ticket is relinked and incomplete intake does not restart", async () => {
    const igStore = createStore("instagram");
    await sendIg(igStore, igEvent("ig.hi", "Hi"));
    stampIncompletePostCompletion(igStore);
    const canonical = scopedExternalConversationId(IG_PAGE, IG_CONTACT);
    igStore.tickets.push({
      id: "existing-ig",
      status: "open",
      ticketCode: "CF-2026-00999",
      ticket_code: "CF-2026-00999",
      sourceChannel: "instagram",
      source_channel: "instagram",
      external_contact_id: IG_CONTACT,
      external_conversation_id: canonical,
      identity_status: "unambiguous",
      recipient_account_id: IG_PAGE,
      provider: META_INSTAGRAM_PROVIDER,
      campaign_name: null,
      creator_email: CREATOR_EMAIL,
    });
    vi.mocked(instagramSend.sendInstagramQuickReplies).mockClear();
    const follow = await sendIg(igStore, igEvent("ig.relink", "Hi"));
    expect(igStore.tickets).toHaveLength(1);
    expect(follow.snapshot.ticketId).toBe("existing-ig");
    expect(follow.snapshot.state).not.toBe("awaiting_persona");
    expect(follow.snapshot.state).not.toBe("creator_confirmation");
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });

  it("9. quarantined identity rows stay unchanged and fail closed", async () => {
    const quarantined = createStore("instagram");
    quarantined.conversations.push({
      id: "quarantined-row",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: IG_PAGE,
      identityStatus: "quarantined",
      externalConversationId: scopedExternalConversationId(IG_PAGE, IG_CONTACT),
      externalContactId: IG_CONTACT,
      displayName: "riya_creates",
      state: "awaiting_post_completion",
      ticketId: null,
      routingIntent: "creator_support",
      currentIntakeField: null,
      lastPromptKey: "awaiting_post_completion",
      lastActivityAt: "2026-09-03T09:00:00.000Z",
      lastProcessedExternalMessageId: "mid.old",
      collectedData: { ...STALE_CREATOR_COLLECTED },
      intakeSessionVersion: 4,
    });
    const beforeQuarantined = cloneConversation(quarantined.conversations[0]!);
    const quarantinedResult = await ingestInstagramInboundMessage(
      igEvent("ig.quarantined", "Hi"),
      quarantined,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(quarantined) },
    );
    expect(quarantinedResult).toMatchObject({
      outcome: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(quarantined.conversations[0]).toEqual(beforeQuarantined);
  });

  it("10. audited sender-only ambiguous row is never mutated", async () => {
    const igStore = createStore("instagram");
    igStore.conversations.push({
      id: "audited-ambiguous",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: null,
      identityStatus: "ambiguous",
      externalConversationId: IG_CONTACT,
      externalContactId: IG_CONTACT,
      displayName: "riya_creates",
      state: "awaiting_post_completion",
      ticketId: null,
      routingIntent: "creator_support",
      currentIntakeField: null,
      lastPromptKey: "awaiting_post_completion",
      lastActivityAt: "2026-09-03T09:00:00.000Z",
      lastProcessedExternalMessageId: "mid.legacy",
      collectedData: { ...STALE_CREATOR_COLLECTED },
      intakeSessionVersion: 2,
    });
    const before = cloneConversation(igStore.conversations[0]!);
    vi.mocked(instagramSend.sendInstagramQuickReplies).mockClear();
    const result = await ingestInstagramInboundMessage(
      igEvent("ig.legacy", "Hi"),
      igStore,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(igStore) },
    );
    expect(result).toMatchObject({
      outcome: "failed",
      errorCode: IDENTITY_AMBIGUOUS,
    });
    expect(igStore.conversations).toHaveLength(1);
    expect(igStore.conversations[0]).toEqual(before);
    expect(igStore.conversations[0]?.externalConversationId).toBe(IG_CONTACT);
    expect(igStore.conversations[0]?.identityStatus).toBe("ambiguous");
    expect(igStore.tickets).toHaveLength(0);
    expect(igStore.emails).toHaveLength(0);
    expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });

  it("brand post-completion does not restart as incomplete creator intake", async () => {
    const igStore = createStore("instagram");
    await sendIg(igStore, igEvent("ig.hi", "Hi"));
    await sendIg(
      igStore,
      igEvent("ig.brand", PERSONA_BRAND_TITLE, PERSONA_BRAND_PAYLOAD),
    );
    await sendIg(
      igStore,
      igEvent("ig.call", BRAND_BOOK_CALL_TITLE, BRAND_BOOK_CALL_PAYLOAD),
    );
    expect(igStore.conversations[0]?.state).toBe("awaiting_post_completion");
    const follow = await sendIg(igStore, igEvent("ig.thanks", "Thanks"));
    expect(follow.snapshot.state).toBe("awaiting_post_completion");
    expect(lastOutbound(igStore)).toContain(POST_COMPLETION_QUESTION_TEXT);
    expect(igStore.tickets).toHaveLength(0);
  });
});

describe("Phase A compatibility", () => {
  it("Phase A can still attach an unstamped exact ticket", async () => {
    await runWithIdentitySchemaPhaseAsync("a", async () => {
      const store = withDurableConversationPersistence(
        createMemoryChatbotStore("instagram", { identitySchema: "current" }),
      );
      await sendIg(store, igEvent("a.hi", "Hi"));
      const canonical = scopedExternalConversationId(IG_PAGE, IG_CONTACT);
      store.tickets.push({
        id: "phase-a-ticket",
        status: "open",
        ticketCode: "CF-2026-00777",
        ticket_code: "CF-2026-00777",
        sourceChannel: "instagram",
        source_channel: "instagram",
        external_contact_id: IG_CONTACT,
        external_conversation_id: canonical,
        identity_status: null,
        campaign_name: null,
      });
      store.conversations[0]!.state = "awaiting_post_completion";
      store.conversations[0]!.ticketId = null;
      const follow = await sendIg(store, igEvent("a.follow", "Any update?"));
      expect(follow.result.outcome).toBe("stored");
      expect(follow.snapshot.ticketId).toBe("phase-a-ticket");
      expect(store.tickets).toHaveLength(1);
    });
  });
});
