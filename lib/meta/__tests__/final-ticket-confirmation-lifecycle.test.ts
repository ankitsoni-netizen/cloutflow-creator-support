import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import { ingestWhatsAppInboundMessage } from "@/lib/meta/whatsapp-ingest";
import {
  emptyConversationSnapshot,
  reduceChannelConversation,
  reduceInstagramConversation,
} from "@/lib/meta/conversation-machine";
import {
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_CAMPAIGN_ISSUE_TITLE,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_TITLE,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  CREATOR_TICKET_CONFIRM_TITLE,
  CREATOR_TICKET_EDIT_PAYLOAD,
  CREATOR_TICKET_EDIT_TITLE,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
  creatorTicketRaisedText,
} from "@/lib/meta/instagram-persona-copy";
import {
  CAMPAIGN_MONTH_NO_PAYLOAD,
  CAMPAIGN_MONTH_YES_PAYLOAD,
  campaignMonthConfirmationText,
} from "@/lib/meta/month-confirmation";
import {
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  WHATSAPP_INTAKE_COPY,
} from "@/lib/meta/routing-copy";
import { PERSONA_PROMPT } from "@/lib/meta/prompt-keys";
import { drainDueInstagramEmails } from "@/lib/meta/instagram-email-outbox";
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
const OTHER_EMAIL = "amit@example.com";
const IG_CONTEXT = { webhookPayload: { sanitized: true } };
const WATI_CONTEXT = {
  webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
};

function igEvent(
  mid: string,
  text: string,
  payload: string | null = null,
  contactId = "12334",
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
    recipientAccountId: "17841400008460000",
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
    creator_name: (row!.creator_name as string | null) ?? null,
    creator_phone: (row!.creator_phone as string | null) ?? null,
    creator_email: (row!.creator_email as string | null) ?? null,
    social_handle: (row!.social_handle as string | null) ?? null,
    platform: String(row!.platform ?? "instagram"),
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
    intake_details: (row!.intake_details as Record<string, unknown> | null) ?? null,
    source_channel: channelFromRow(row!),
    status: "open",
    priority: "normal",
    assigned_team: "Creator Support",
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: (row!.issue_description as string | null) ?? null,
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

function channelFromRow(row: Record<string, unknown>): "instagram" | "whatsapp" {
  return row.source_channel === "whatsapp" ? "whatsapp" : "instagram";
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

async function playIgToDetails(
  store: ReturnType<typeof createStore>,
  contactId = "12334",
  prefix = "ig",
) {
  await sendIg(store, igEvent(`${prefix}.hi`, "Hi", null, contactId));
  await sendIg(
    store,
    igEvent(`${prefix}.persona`, PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD, contactId),
  );
  await sendIg(
    store,
    igEvent(
      `${prefix}.existing`,
      CREATOR_EXISTING_CAMPAIGN_TITLE,
      CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
      contactId,
    ),
  );
  await sendIg(
    store,
    igEvent(
      `${prefix}.issue`,
      CREATOR_CAMPAIGN_ISSUE_TITLE,
      CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
      contactId,
    ),
  );
  return sendIg(
    store,
    igEvent(
      `${prefix}.campaign`,
      `Acme, August 2026, ${CREATOR_EMAIL}`,
      null,
      contactId,
    ),
  );
}

async function playWatiToDetails(
  store: ReturnType<typeof createStore>,
  waId = WATI_TEST_WA_ID,
  prefix = "wa",
  email = CREATOR_EMAIL,
) {
  await sendWati(
    store,
    watiTextPayload({ waId, text: "Hi", whatsappMessageId: `wamid.${prefix}.hi` }),
  );
  await sendWati(
    store,
    watiTextPayload({
      waId,
      text: PERSONA_CREATOR_TITLE,
      type: "button",
      buttonReply: { title: PERSONA_CREATOR_TITLE },
      whatsappMessageId: `wamid.${prefix}.persona`,
    }),
  );
  await sendWati(
    store,
    watiTextPayload({
      waId,
      text: CREATOR_EXISTING_CAMPAIGN_TITLE,
      whatsappMessageId: `wamid.${prefix}.existing`,
    }),
  );
  await sendWati(
    store,
    watiTextPayload({
      waId,
      text: CREATOR_CAMPAIGN_ISSUE_TITLE,
      whatsappMessageId: `wamid.${prefix}.issue`,
    }),
  );
  return sendWati(
    store,
    watiTextPayload({
      waId,
      text: `Acme, August 2026, ${email}`,
      whatsappMessageId: `wamid.${prefix}.campaign`,
    }),
  );
}

async function confirmMonthIg(store: ReturnType<typeof createStore>, prefix = "ig") {
  return sendIg(
    store,
    igEvent(`${prefix}.yes`, "Yes", CAMPAIGN_MONTH_YES_PAYLOAD),
  );
}

async function raiseIg(store: ReturnType<typeof createStore>, prefix = "ig") {
  return sendIg(
    store,
    igEvent(`${prefix}.raise`, CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
  );
}

async function confirmMonthWati(
  store: ReturnType<typeof createStore>,
  waId = WATI_TEST_WA_ID,
  prefix = "wa",
) {
  return sendWati(
    store,
    watiTextPayload({
      waId,
      text: "Yes",
      type: "button",
      buttonReply: { title: "Yes" },
      whatsappMessageId: `wamid.${prefix}.yes`,
    }),
  );
}

async function raiseWati(
  store: ReturnType<typeof createStore>,
  waId = WATI_TEST_WA_ID,
  prefix = "wa",
) {
  return sendWati(
    store,
    watiTextPayload({
      waId,
      text: CREATOR_TICKET_CONFIRM_TITLE,
      type: "button",
      buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
      whatsappMessageId: `wamid.${prefix}.raise`,
    }),
  );
}

function confirmationText(result: { snapshot: { lastPromptKey: string | null } } & {
  result?: unknown;
}, outbound: Array<Record<string, unknown>>) {
  const last = [...outbound].reverse().find((row) => row.direction === "outbound");
  return String(last?.messageBody ?? "");
}

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "wati";
  process.env.WATI_CONVERSATION_TARGET_MODE = "recipient";
  process.env.WATI_CHANNEL_PHONE_NUMBER = WATI_TEST_CHANNEL;
  vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.out",
    recipientId: "12334",
  });
  vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.out.text",
    recipientId: "12334",
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

describe("shared final ticket confirmation (Instagram + WATI)", () => {
  it("1. details lead to month confirmation on both channels", async () => {
    const igStore = createStore("instagram");
    const ig = await playIgToDetails(igStore);
    expect(ig.snapshot.state).toBe("awaiting_month_confirmation");
    expect(ig.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.monthConfirm);
    expect(confirmationText(ig, igStore.messages)).toBe(
      campaignMonthConfirmationText("2026-08-01"),
    );

    const waStore = createStore("whatsapp");
    const wa = await playWatiToDetails(waStore);
    expect(wa.snapshot.state).toBe("awaiting_month_confirmation");
    expect(wa.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.monthConfirm);
  });

  it("2. month Yes leads to the final summary, not ticket creation", async () => {
    const igStore = createStore("instagram");
    await playIgToDetails(igStore);
    const igYes = await confirmMonthIg(igStore);
    expect(igYes.snapshot.state).toBe("creator_confirmation");
    expect(igStore.tickets).toHaveLength(0);
    expect(confirmationText(igYes, igStore.messages)).toContain("Brand: Acme");
    expect(confirmationText(igYes, igStore.messages)).toContain(CREATOR_EMAIL);
    expect(confirmationText(igYes, igStore.messages)).not.toContain("Campaign:");

    const waStore = createStore("whatsapp");
    await playWatiToDetails(waStore);
    const waYes = await confirmMonthWati(waStore);
    expect(waYes.snapshot.state).toBe("creator_confirmation");
    expect(waStore.tickets).toHaveLength(0);
  });

  it("3. month No clears only the month", async () => {
    const igStore = createStore("instagram");
    await playIgToDetails(igStore);
    const denied = await sendIg(
      igStore,
      igEvent("ig.no", "No", CAMPAIGN_MONTH_NO_PAYLOAD),
    );
    expect(denied.snapshot.collected.campaignMonth).toBeNull();
    expect(denied.snapshot.collected.brandName).toBe("Acme");
    expect(denied.snapshot.collected.email).toBe(CREATOR_EMAIL);
    expect(denied.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.monthConfirmReask);
  });

  it("4. a corrected month produces a new confirmation key", async () => {
    const igStore = createStore("instagram");
    const details = await playIgToDetails(igStore);
    await sendIg(igStore, igEvent("ig.no", "No", CAMPAIGN_MONTH_NO_PAYLOAD));
    const corrected = await sendIg(igStore, igEvent("ig.july", "July 2026"));
    expect(corrected.snapshot.state).toBe("awaiting_month_confirmation");
    expect(corrected.snapshot.collected.campaignMonth).toBe("2026-07-01");
    expect(corrected.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.monthConfirmCorrected);
    expect(corrected.snapshot.lastPromptKey).not.toBe(details.snapshot.lastPromptKey);
  });

  it("5. the final summary contains required values and no campaign name", async () => {
    const play = [
      { text: "Hi", payload: null },
      { text: PERSONA_CREATOR_TITLE, payload: PERSONA_CREATOR_PAYLOAD },
      { text: CREATOR_EXISTING_CAMPAIGN_TITLE, payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD },
      { text: CREATOR_CAMPAIGN_ISSUE_TITLE, payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD },
      { text: `Acme, August 2026, ${CREATOR_EMAIL}`, payload: null },
      { text: "Yes", payload: CAMPAIGN_MONTH_YES_PAYLOAD },
    ];
    let last = reduceInstagramConversation(emptyConversationSnapshot(), {
      text: "Hi",
      quickReplyPayload: null,
      timestamp: "2026-09-03T10:00:00.000Z",
      messageId: "mid.start",
    });
    for (const [index, step] of play.entries()) {
      last = reduceInstagramConversation(last.snapshot, {
        text: step.text,
        quickReplyPayload: step.payload,
        timestamp: "2026-09-03T10:00:00.000Z",
        messageId: `mid.${index}`,
      });
    }
    const effect = last.effects.find(
      (item) => item.type === "send_quick_replies" || item.type === "send_text",
    );
    const text = effect && "text" in effect ? effect.text : "";
    expect(last.snapshot.state).toBe("creator_confirmation");
    expect(text).toContain("Brand: Acme");
    expect(text).toContain("Month: August 2026");
    expect(text).toContain(`Email: ${CREATOR_EMAIL}`);
    expect(text).toContain("Issue type: Campaign issue");
    expect(text).not.toContain("Campaign:");
    expect(last.snapshot.collected.campaignName).toBeNull();
  });

  it("6-7. Edit details creates no ticket and a later raise uses the edited values", async () => {
    const igStore = createStore("instagram");
    await playIgToDetails(igStore);
    await confirmMonthIg(igStore);
    const edited = await sendIg(
      igStore,
      igEvent("ig.edit", CREATOR_TICKET_EDIT_TITLE, CREATOR_TICKET_EDIT_PAYLOAD),
    );
    expect(igStore.tickets).toHaveLength(0);
    expect(edited.snapshot.state).toBe("creator_campaign_details");
    expect(edited.snapshot.lastPromptKey).toContain(PERSONA_PROMPT.creatorEdit);
    const revised = await sendIg(
      igStore,
      igEvent("ig.campaign.2", `Nike, September 2026, ${CREATOR_EMAIL}`),
    );
    expect(revised.snapshot.state).toBe("awaiting_month_confirmation");
    const yes = await confirmMonthIg(igStore, "ig2");
    expect(yes.snapshot.state).toBe("creator_confirmation");
    expect(confirmationText(yes, igStore.messages)).toContain("Brand: Nike");
    expect(confirmationText(yes, igStore.messages)).toContain("September 2026");
    expect(igStore.tickets).toHaveLength(0);
  });

  it("8-13. Raise ticket creates one ticket, queues one email, and retries stay unique", async () => {
    const igStore = createStore("instagram");
    await playIgToDetails(igStore);
    await confirmMonthIg(igStore);
    const raised = await raiseIg(igStore);
    expect(raised.result.outcome).toBe("stored");
    expect(igStore.tickets).toHaveLength(1);
    expect(igStore.tickets[0]?.campaign_name).toBeNull();
    expect(raised.snapshot.ticketId).toBe(String(igStore.tickets[0]?.id));
    expect(igStore.tickets[0]?.identity_status).toBe("unambiguous");
    const igTicket = ticketFromStore(igStore);
    expect(confirmationText(raised, igStore.messages)).toContain(
      creatorTicketRaisedText(igTicket.ticket_code),
    );
    expect(emailSend.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const igMail = vi.mocked(emailSend.sendTransactionalEmail).mock.calls[0]?.[0];
    expect(igMail?.toEmail).toBe(CREATOR_EMAIL);
    expect(igMail?.text).toContain(igTicket.ticket_code);
    expect(JSON.stringify(igMail)).not.toContain("internal-db-id");
    expect(
      igStore.emails.filter((row) => row.purpose === "instagram-ticket-confirmation"),
    ).toHaveLength(1);

    const repeatRaise = await sendIg(
      igStore,
      igEvent("ig.raise.2", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(igStore.tickets).toHaveLength(1);
    expect(repeatRaise.snapshot.ticketId).toBe(igTicket.id);

    const duplicate = await ingestInstagramInboundMessage(
      raised.event,
      igStore,
      IG_CONTEXT,
      { loadTicket: loadTicketFromStore(igStore) },
    );
    expect(duplicate.outcome).toBe("duplicate");
    expect(igStore.tickets).toHaveLength(1);
    expect(emailSend.sendTransactionalEmail).toHaveBeenCalledTimes(1);

    vi.mocked(emailSend.sendTransactionalEmail).mockClear();
    const waStore = createStore("whatsapp");
    await playWatiToDetails(waStore);
    await confirmMonthWati(waStore);
    const waRaised = await raiseWati(waStore);
    expect(waStore.tickets).toHaveLength(1);
    expect(waStore.tickets[0]?.campaign_name).toBeNull();
    expect(waStore.tickets[0]?.metadata).toMatchObject({
      provider: WATI_WHATSAPP_PROVIDER,
    });
    const waTicket = ticketFromStore(waStore);
    expect(confirmationText(waRaised, waStore.messages)).toContain(waTicket.ticket_code);
    expect(emailSend.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const waMail = vi.mocked(emailSend.sendTransactionalEmail).mock.calls[0]?.[0];
    expect(waMail?.toEmail).toBe(CREATOR_EMAIL);
    expect(waMail?.text).toContain(waTicket.ticket_code);
    expect(waMail?.metadata).toMatchObject({
      purpose: "whatsapp-ticket-confirmation",
    });
    expect(
      waStore.emails.filter((row) => row.purpose === "whatsapp-ticket-confirmation"),
    ).toHaveLength(1);
  });

  it("14. email failure stays retryable and does not roll back the ticket", async () => {
    vi.mocked(emailSend.sendTransactionalEmail).mockRejectedValueOnce(
      new Error("brevo unavailable"),
    );
    const waStore = createStore("whatsapp");
    await playWatiToDetails(waStore);
    await confirmMonthWati(waStore);
    await raiseWati(waStore);
    expect(waStore.tickets).toHaveLength(1);
    const email = waStore.emails.find(
      (row) => row.purpose === "whatsapp-ticket-confirmation",
    );
    expect(email?.deliveryStatus).toBe("failed");
    email!.updatedAt = "2026-09-03T09:00:00.000Z";

    vi.mocked(emailSend.sendTransactionalEmail).mockResolvedValue({
      messageId: "brevo-retry",
      accepted: [CREATOR_EMAIL],
      rejected: [],
      status: "accepted_by_brevo",
    });
    const drained = await drainDueInstagramEmails({
      store: waStore,
      now: new Date("2026-09-03T10:01:00.000Z"),
      loadTicket: loadTicketFromStore(waStore),
    });
    expect(drained.claimed).toBeGreaterThanOrEqual(1);
    expect(drained.sent).toBeGreaterThanOrEqual(1);
    expect(waStore.tickets).toHaveLength(1);
    expect(email?.deliveryStatus).toBe("sent");
  });

  it("15. DM failure does not roll back the ticket or duplicate email", async () => {
    vi.mocked(watiSend.sendWatiInteractiveMessage).mockImplementation(async (options) => {
      if (options.text.includes("Ticket ID:")) {
        return {
          ok: false,
          errorCode: "wati_send_failed",
          retryable: true,
          messagingWindowExpired: false,
          httpStatus: 500,
        };
      }
      return {
        ok: true,
        metaMessageId: "wamid.ok",
        recipientId: WATI_TEST_WA_ID,
      };
    });
    const waStore = createStore("whatsapp");
    await playWatiToDetails(waStore);
    await confirmMonthWati(waStore);
    await raiseWati(waStore);
    expect(waStore.tickets).toHaveLength(1);
    expect(emailSend.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(
      waStore.emails.filter((row) => row.purpose === "whatsapp-ticket-confirmation"),
    ).toHaveLength(1);
  });

  it("16-20. Instagram campaign_name stays null, WATI uses provider=wati, timeline and isolation hold", async () => {
    const igStore = createStore("instagram");
    await playIgToDetails(igStore);
    await confirmMonthIg(igStore);
    const raised = await raiseIg(igStore);
    expect(igStore.tickets[0]?.campaign_name).toBeNull();
    expect(igStore.tickets[0]?.identity_status).toBe("unambiguous");
    expect(raised.snapshot.ticketId).toBe(String(igStore.tickets[0]?.id));
    const igTicket = ticketFromStore(igStore);
    const igRows = await igStore.listSupportTranscript({
      conversationId: String(igStore.conversations[0]?.id),
      ticketId: igTicket.id,
    });
    expect(igRows.some((row) => row.messageBody === "Hi")).toBe(true);
    const follow = await sendIg(igStore, igEvent("ig.follow", "Any update?"));
    expect(igStore.tickets).toHaveLength(1);
    expect(follow.snapshot.ticketId).toBe(igTicket.id);
    expect(follow.snapshot.state).not.toBe("awaiting_persona");

    const other = await playIgToDetails(igStore, "99991", "igb");
    expect(other.snapshot.state).toBe("awaiting_month_confirmation");
    await sendIg(
      igStore,
      igEvent("igb.yes", "Yes", CAMPAIGN_MONTH_YES_PAYLOAD, "99991"),
    );
    await sendIg(
      igStore,
      igEvent(
        "igb.raise",
        CREATOR_TICKET_CONFIRM_TITLE,
        CREATOR_TICKET_CONFIRM_PAYLOAD,
        "99991",
      ),
    );
    expect(igStore.tickets).toHaveLength(2);
    expect(igStore.tickets[0]?.external_contact_id).not.toBe(
      igStore.tickets[1]?.external_contact_id,
    );

    const waStore = createStore("whatsapp");
    await playWatiToDetails(waStore);
    await confirmMonthWati(waStore);
    await raiseWati(waStore);
    expect(waStore.tickets[0]?.metadata).toMatchObject({
      provider: WATI_WHATSAPP_PROVIDER,
    });
    expect(waStore.tickets[0]?.identity_status).toBe("unambiguous");
    await playWatiToDetails(waStore, "15550001111", "wb", OTHER_EMAIL);
    await confirmMonthWati(waStore, "15550001111", "wb");
    await raiseWati(waStore, "15550001111", "wb");
    expect(waStore.tickets).toHaveLength(2);
    expect(waStore.tickets[0]?.creator_email).toBe(CREATOR_EMAIL);
    expect(waStore.tickets[1]?.creator_email).toBe(OTHER_EMAIL);
  });

  it("21. Meta WhatsApp month Yes still creates a ticket without the persona summary", () => {
    const first = reduceChannelConversation(
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
      first.snapshot,
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
    const campaign = reduceChannelConversation(
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
      campaign.snapshot,
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
    expect(yes.snapshot.collected.campaignName).toBeNull();
  });
});
