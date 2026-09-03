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
import { CAMPAIGN_MONTH_NO_PAYLOAD, CAMPAIGN_MONTH_YES_PAYLOAD } from "@/lib/meta/month-confirmation";
import { INTAKE_STATES_BLOCKED_AFTER_TICKET } from "@/lib/meta/ticket-finalization";
import { drainDueInstagramEmails } from "@/lib/meta/instagram-email-outbox";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { classifyWatiSendFailureCode } from "@/lib/wati/send";
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
const IG_CONTEXT = { webhookPayload: { sanitized: true } };
const WATI_CONTEXT = {
  webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
};

function igEvent(
  mid: string,
  text: string,
  payload: string | null = null,
): NormalizedMetaInboundText {
  return {
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    externalEventId: mid,
    externalMessageId: mid,
    externalConversationId: "12334",
    externalContactId: "12334",
    displayName: "riya_creates",
    senderName: "riya_creates",
    senderAddress: "12334",
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
    creator_email: (row!.creator_email as string | null) ?? CREATOR_EMAIL,
    social_handle: null,
    platform: "instagram",
    issue_type: null,
    campaign_name: null,
    brand_name: "Acme",
    campaign_month: "2026-08-01",
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: "creator_support",
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: null,
    source_channel: channelFromRow(row!),
    status: String(row!.status ?? "open"),
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
  return { result, snapshot };
}

function eventFromWatiPayload(payload: Record<string, unknown>) {
  const now = Date.parse("2026-09-03T10:00:00.000Z");
  const normalized = normalizeWatiWebhookPayload({
    ...payload,
    timestamp: String(Math.floor(now / 1000)),
    created: "2026-09-03T10:00:00.000Z",
  });
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
  return { result, snapshot };
}

async function playIgToConfirmation(store: ReturnType<typeof createStore>) {
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
    igEvent("ig.issue", CREATOR_CAMPAIGN_ISSUE_TITLE, CREATOR_CAMPAIGN_ISSUE_PAYLOAD),
  );
  await sendIg(
    store,
    igEvent("ig.campaign", `Acme, August 2026, ${CREATOR_EMAIL}`),
  );
  return sendIg(store, igEvent("ig.yes", "Yes", CAMPAIGN_MONTH_YES_PAYLOAD));
}

async function playIgToMonthAsk(store: ReturnType<typeof createStore>) {
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
    igEvent("ig.issue", CREATOR_CAMPAIGN_ISSUE_TITLE, CREATOR_CAMPAIGN_ISSUE_PAYLOAD),
  );
  return sendIg(
    store,
    igEvent("ig.campaign", `Acme, August 2026, ${CREATOR_EMAIL}`),
  );
}

async function playWatiToConfirmation(store: ReturnType<typeof createStore>) {
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
  return sendWati(
    store,
    watiTextPayload({
      text: "Yes",
      type: "button",
      buttonReply: { title: "Yes" },
      whatsappMessageId: "wamid.yes",
    }),
  );
}

function lastOutbound(store: ReturnType<typeof createStore>): string {
  const last = [...store.messages]
    .reverse()
    .find((row) => row.direction === "outbound");
  return String(last?.messageBody ?? "");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function confirmationGraphCalls(): number {
  return vi.mocked(instagramSend.sendInstagramQuickReplies).mock.calls.filter(
    (call) =>
      String(call[0]?.text ?? "").includes("Should I raise a support ticket"),
  ).length;
}

function ticketClosingGraphCalls(): number {
  return vi.mocked(instagramSend.sendInstagramQuickReplies).mock.calls.filter(
    (call) => String(call[0]?.text ?? "").includes("Ticket ID:"),
  ).length;
}

function ticketClosingWatiCalls(): number {
  return vi.mocked(watiSend.sendWatiInteractiveMessage).mock.calls.filter(
    (call) => String(call[0]?.text ?? "").includes("Ticket ID:"),
  ).length;
}

function unlinkToCreatorConfirmation(
  store: ReturnType<typeof createStore>,
  ticketCode: string,
) {
  const row = store.conversations[0];
  expect(row).toBeTruthy();
  const openTickets = store.tickets.filter(
    (candidate) => String(candidate.status) === "open",
  );
  expect(openTickets).toHaveLength(1);
  const ticket = openTickets[0]!;
  ticket.ticketCode = ticketCode;
  ticket.ticket_code = ticketCode;
  row!.state = "creator_confirmation";
  row!.ticketId = null;
  row!.lastPromptKey = "creator_confirm:v2";
}

function seedHistoricalConversations(
  store: ReturnType<typeof createStore>,
  channel: "instagram" | "whatsapp",
) {
  store.conversations.push({
    id: "hist-provider-null",
    channel,
    externalConversationId: "legacy-provider-null",
    externalContactId: "legacy-provider-null",
    provider: null,
    recipientAccountId: null,
    identityStatus: null,
    identity_status: null,
    state: "creator_confirmation",
    ticketId: null,
    routingIntent: "creator_support",
    collectedData: { brandName: "Legacy Null" },
    lastPromptKey: "creator_confirm:v2",
    lastProcessedExternalMessageId: "legacy.null.mid",
    intakeSessionVersion: 1,
  });
  store.conversations.push({
    id: "hist-ambiguous",
    channel,
    externalConversationId: "legacy-ambiguous",
    externalContactId: "legacy-ambiguous",
    provider: channel === "whatsapp" ? WATI_WHATSAPP_PROVIDER : META_INSTAGRAM_PROVIDER,
    recipientAccountId: "999000111",
    identityStatus: "ambiguous",
    identity_status: "ambiguous",
    state: "creator_confirmation",
    ticketId: null,
    routingIntent: "creator_support",
    collectedData: { brandName: "Legacy Ambiguous" },
    lastPromptKey: "creator_confirm:v2",
    lastProcessedExternalMessageId: "legacy.amb.mid",
    intakeSessionVersion: 1,
  });
}

function historicalSnapshot(store: ReturnType<typeof createStore>) {
  return cloneJson(
    store.conversations.filter(
      (row) =>
        row.id === "hist-provider-null" || row.id === "hist-ambiguous",
    ),
  );
}

function failObsoleteConfirmationGraph() {
  vi.mocked(instagramSend.sendInstagramQuickReplies).mockImplementation(
    async (options) => {
      if (options.text.includes("Should I raise a support ticket")) {
        return {
          ok: false,
          errorCode: "instagram_send_failed",
          retryable: true,
          messagingWindowExpired: false,
          httpStatus: 500,
          deliveryUnknown: false,
        };
      }
      return {
        ok: true,
        metaMessageId: "mid.ok",
        recipientId: "12334",
      };
    },
  );
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

describe("P0 post-commit Instagram confirmation regression", () => {
  it("Raise ticket never returns to creator_confirmation, including a second Raise", async () => {
    const store = createStore("instagram");
    const confirmed = await playIgToConfirmation(store);
    expect(confirmed.snapshot.state).toBe("creator_confirmation");
    const raised = await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(raised.result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(raised.snapshot.state).toBe("awaiting_post_completion");
    expect(raised.snapshot.ticketId).toBe(String(store.tickets[0]?.id));
    expect(INTAKE_STATES_BLOCKED_AFTER_TICKET.has(raised.snapshot.state)).toBe(false);
    expect(lastOutbound(store)).toContain(
      creatorTicketRaisedText(String(store.tickets[0]?.ticketCode)),
    );

    const again = await sendIg(
      store,
      igEvent("ig.raise.2", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(store.tickets).toHaveLength(1);
    expect(again.snapshot.state).toBe("awaiting_post_completion");
    expect(again.snapshot.state).not.toBe("creator_confirmation");
    expect(lastOutbound(store)).not.toContain("Should I raise a support ticket");
  });

  it("keeps a linked active ticket when identity lookup misses it", async () => {
    const store = createStore("instagram");
    await playIgToConfirmation(store);
    await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(store.conversations[0]?.ticketId).toBeTruthy();
    store.tickets[0]!.external_conversation_id = "not-the-canonical-key";
    const follow = await sendIg(store, igEvent("ig.hi.2", "Hi"));
    expect(follow.result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(follow.snapshot.ticketId).toBe(String(store.tickets[0]?.id));
    expect(follow.snapshot.state).not.toBe("creator_confirmation");
    expect(INTAKE_STATES_BLOCKED_AFTER_TICKET.has(follow.snapshot.state)).toBe(false);
  });

  it("retries after a post-commit snapshot failure without a second ticket or confirmation", async () => {
    const store = createStore("instagram");
    await playIgToConfirmation(store);
    const originalSave = store.saveConversationSnapshot.bind(store);
    let failedOnce = false;
    store.saveConversationSnapshot = async (id, snapshot, lastMessageAt, displayName) => {
      if (!failedOnce && snapshot.state === "awaiting_post_completion") {
        failedOnce = true;
        return { outcome: "failed" as const, errorCode: "conversation_update_failed" };
      }
      return originalSave(id, snapshot, lastMessageAt, displayName);
    };
    const first = await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(store.tickets).toHaveLength(1);
    expect(first.result.outcome).toBe("failed");
    const retry = await sendIg(
      store,
      igEvent("ig.raise.retry", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(retry.result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(retry.snapshot.state).toBe("awaiting_post_completion");
    expect(retry.snapshot.state).not.toBe("creator_confirmation");
  });

  it("Graph send failure after reservation does not replay confirmation", async () => {
    vi.mocked(instagramSend.sendInstagramQuickReplies).mockImplementation(async (options) => {
      if (options.text.includes("Ticket ID:")) {
        return {
          ok: false,
          errorCode: "graph_send_failed",
          retryable: true,
          messagingWindowExpired: false,
          httpStatus: 500,
          deliveryUnknown: false,
        };
      }
      return {
        ok: true,
        metaMessageId: "mid.ok",
        recipientId: "12334",
      };
    });
    const store = createStore("instagram");
    await playIgToConfirmation(store);
    const raised = await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(raised.result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(raised.snapshot.state).toBe("awaiting_post_completion");
    const follow = await sendIg(store, igEvent("ig.follow", "Any update?"));
    expect(follow.snapshot.state).not.toBe("creator_confirmation");
    expect(store.tickets).toHaveLength(1);
  });
});

describe("P0 WATI closing and email", () => {
  it("records post-ticket state and email even when WATI send fails", async () => {
    vi.mocked(watiSend.sendWatiInteractiveMessage).mockImplementation(async (options) => {
      if (options.text.includes("Ticket ID:")) {
        return {
          ok: false,
          errorCode: "http_5xx",
          retryable: true,
          messagingWindowExpired: false,
          httpStatus: 500,
          operation: "buttons",
        };
      }
      return {
        ok: true,
        metaMessageId: "wamid.ok",
        recipientId: WATI_TEST_WA_ID,
      };
    });
    const store = createStore("whatsapp");
    await playWatiToConfirmation(store);
    const raised = await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise",
      }),
    );
    expect(store.tickets).toHaveLength(1);
    expect(raised.snapshot.state).toBe("awaiting_post_completion");
    expect(raised.snapshot.state).not.toBe("creator_confirmation");
    expect(
      store.emails.filter((row) => row.purpose === "whatsapp-ticket-confirmation"),
    ).toHaveLength(1);
    expect(raised.result.outcome).toBe("failed");
    expect(raised.result.errorCode).toBe(
      "wati_buttons_http_5xx_retryable_post_ticket_closing",
    );

    vi.mocked(watiSend.sendWatiInteractiveMessage).mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.ok.retry",
      recipientId: WATI_TEST_WA_ID,
    });
    const retry = await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise.retry",
      }),
    );
    expect(retry.result.outcome).toBe("stored");
    expect(store.tickets).toHaveLength(1);
    expect(retry.snapshot.state).toBe("awaiting_post_completion");
    expect(
      store.emails.filter((row) => row.purpose === "whatsapp-ticket-confirmation"),
    ).toHaveLength(1);
  });

  it("concurrent Raise events create one ticket", async () => {
    const store = createStore("whatsapp");
    await playWatiToConfirmation(store);
    const [first, second] = await Promise.all([
      ingestWhatsAppInboundMessage(
        eventFromWatiPayload(
          watiTextPayload({
            text: CREATOR_TICKET_CONFIRM_TITLE,
            type: "button",
            buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
            whatsappMessageId: "wamid.raise.a",
          }),
        ),
        store,
        WATI_CONTEXT,
        { loadTicket: loadTicketFromStore(store) },
      ),
      ingestWhatsAppInboundMessage(
        eventFromWatiPayload(
          watiTextPayload({
            text: CREATOR_TICKET_CONFIRM_TITLE,
            type: "button",
            buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
            whatsappMessageId: "wamid.raise.b",
          }),
        ),
        store,
        WATI_CONTEXT,
        { loadTicket: loadTicketFromStore(store) },
      ),
    ]);
    expect([first.outcome, second.outcome].every((outcome) => outcome !== "failed")).toBe(
      true,
    );
    expect(store.tickets).toHaveLength(1);
  });
});

describe("sanitized WATI failure codes", () => {
  it("never includes recipient, URL, token, or message text", () => {
    const code = classifyWatiSendFailureCode({
      operation: "buttons",
      httpStatus: 500,
      retryable: true,
      stage: "post_ticket_closing",
    });
    expect(code).toBe("wati_buttons_http_5xx_retryable_post_ticket_closing");
    expect(code).not.toContain("Bearer");
    expect(code).not.toContain("live.wati.io");
    expect(code).not.toContain("@");
    expect(code).not.toContain(WATI_TEST_WA_ID);
  });
});

describe("P0 navigation and email drain", () => {
  it("Month No keeps brand/email and Edit details requires a new campaign bundle", async () => {
    const store = createStore("instagram");
    const asked = await playIgToMonthAsk(store);
    expect(asked.snapshot.state).toBe("awaiting_month_confirmation");
    const denied = await sendIg(
      store,
      igEvent("ig.no", "No", CAMPAIGN_MONTH_NO_PAYLOAD),
    );
    expect(denied.snapshot.state).toBe("awaiting_month_confirmation");
    expect(denied.snapshot.collected.brandName).toBe("Acme");
    expect(denied.snapshot.collected.email).toBe(CREATOR_EMAIL);
    expect(denied.snapshot.collected.campaignMonth).toBeNull();
    expect(denied.snapshot.collected.igPersona).toBe("creator");

    const month = await sendIg(store, igEvent("ig.month.fix", "September 2026"));
    expect(month.snapshot.state).toBe("awaiting_month_confirmation");
    const yes = await sendIg(store, igEvent("ig.yes.2", "Yes", CAMPAIGN_MONTH_YES_PAYLOAD));
    expect(yes.snapshot.state).toBe("creator_confirmation");

    const edited = await sendIg(
      store,
      igEvent("ig.edit", CREATOR_TICKET_EDIT_TITLE, CREATOR_TICKET_EDIT_PAYLOAD),
    );
    expect(edited.snapshot.state).toBe("creator_campaign_details");
    expect(edited.snapshot.collected.brandName).toBeNull();
    expect(edited.snapshot.collected.email).toBeNull();
    expect(edited.snapshot.collected.campaignMonth).toBeNull();
    expect(edited.snapshot.collected.igIssueCategory).toBe("campaign");
  });

  it("Brevo failure leaves a drainable email and does not create a second ticket", async () => {
    vi.mocked(emailSend.sendTransactionalEmail).mockRejectedValueOnce(
      new Error("brevo unavailable"),
    );
    const store = createStore("whatsapp");
    await playWatiToConfirmation(store);
    const raised = await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise.mail",
      }),
    );
    expect(store.tickets).toHaveLength(1);
    expect(raised.snapshot.state).toBe("awaiting_post_completion");
    const email = store.emails.find(
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
      store,
      now: new Date("2026-09-03T10:01:00.000Z"),
      loadTicket: loadTicketFromStore(store),
    });
    expect(drained.claimed).toBeGreaterThanOrEqual(1);
    expect(drained.sent).toBeGreaterThanOrEqual(1);
    expect(store.tickets).toHaveLength(1);
    expect(email?.deliveryStatus).toBe("sent");
  });

  it("two Instagram creators keep isolated conversations", async () => {
    const store = createStore("instagram");
    await playIgToConfirmation(store);
    await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    const otherHi = igEvent("ig2.hi", "Hi");
    otherHi.externalConversationId = "99991";
    otherHi.externalContactId = "99991";
    otherHi.senderAddress = "99991";
    const other = await sendIg(store, otherHi);
    expect(other.snapshot.state).toBe("awaiting_persona");
    expect(store.tickets).toHaveLength(1);
    expect(store.conversations).toHaveLength(2);
  });
});

describe("Production audit shapes in P0 ingest", () => {
  it("Instagram CF-2026-00041 retry repairs only link/state after a failed confirmation resend", async () => {
    const store = createStore("instagram");
    await playIgToConfirmation(store);
    await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(store.tickets).toHaveLength(1);
    unlinkToCreatorConfirmation(store, "CF-2026-00041");
    seedHistoricalConversations(store, "instagram");
    const historical = historicalSnapshot(store);
    const creator = store.conversations[0]!;
    const creatorContact = creator.externalContactId;
    const creatorRecipient = creator.recipientAccountId;
    const confirmationSends = confirmationGraphCalls();
    const closingSends = ticketClosingGraphCalls();
    const emailSends = vi.mocked(emailSend.sendTransactionalEmail).mock.calls.length;
    const closingRows = store.messages.filter(
      (row) =>
        row.direction === "outbound" &&
        String(row.messageBody ?? "").includes("Ticket ID:"),
    );
    expect(closingRows).toHaveLength(1);
    expect(closingRows[0]?.deliveryStatus).toBe("sent");
    const email = store.emails.find(
      (row) => row.purpose === "instagram-ticket-confirmation",
    );
    expect(email?.deliveryStatus).toBe("sent");

    const raiseEvent = store.events.find((row) => row.externalEventId === "ig.raise");
    expect(raiseEvent).toBeTruthy();
    raiseEvent!.processingStatus = "failed";
    raiseEvent!.errorCode = "instagram_send_failed";
    failObsoleteConfirmationGraph();

    const retry = await sendIg(
      store,
      igEvent("ig.raise", CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    );
    expect(retry.result.outcome).not.toBe("failed");
    expect(retry.result.errorCode).not.toBe("instagram_send_failed");
    expect(store.tickets.filter((row) => String(row.status) === "open")).toHaveLength(1);
    expect(String(store.tickets[0]?.ticketCode ?? store.tickets[0]?.ticket_code)).toBe(
      "CF-2026-00041",
    );
    expect(retry.snapshot.ticketId).toBe(String(store.tickets[0]?.id));
    expect(store.conversations[0]?.ticketId).toBe(String(store.tickets[0]?.id));
    expect(retry.snapshot.state).toBe("awaiting_post_completion");
    expect(retry.snapshot.state).not.toBe("creator_confirmation");
    expect(INTAKE_STATES_BLOCKED_AFTER_TICKET.has(retry.snapshot.state)).toBe(false);
    expect(confirmationGraphCalls()).toBe(confirmationSends);
    expect(ticketClosingGraphCalls()).toBe(closingSends);
    expect(vi.mocked(emailSend.sendTransactionalEmail).mock.calls.length).toBe(emailSends);
    expect(
      store.messages.filter(
        (row) =>
          row.direction === "outbound" &&
          String(row.messageBody ?? "").includes("Ticket ID:"),
      ),
    ).toHaveLength(1);
    expect(email?.deliveryStatus).toBe("sent");
    expect(store.conversations[0]?.externalContactId).toBe(creatorContact);
    expect(store.conversations[0]?.recipientAccountId).toBe(creatorRecipient);
    expect(historicalSnapshot(store)).toEqual(historical);

    const follow = await sendIg(store, igEvent("ig.hi.after", "Hi"));
    expect(follow.snapshot.state).not.toBe("creator_confirmation");
    expect(follow.snapshot.ticketId).toBe(String(store.tickets[0]?.id));
    expect(store.tickets.filter((row) => String(row.status) === "open")).toHaveLength(1);
    const restarted = await sendIg(store, igEvent("ig.restart.after", "restart"));
    expect(restarted.snapshot.state).not.toBe("creator_confirmation");
    expect(restarted.snapshot.ticketId).toBe(String(store.tickets[0]?.id));
    const raisedAgain = await sendIg(
      store,
      igEvent(
        "ig.raise.after",
        CREATOR_TICKET_CONFIRM_TITLE,
        CREATOR_TICKET_CONFIRM_PAYLOAD,
      ),
    );
    expect(store.tickets.filter((row) => String(row.status) === "open")).toHaveLength(1);
    expect(raisedAgain.snapshot.state).not.toBe("creator_confirmation");
    expect(ticketClosingGraphCalls()).toBe(closingSends);
    expect(vi.mocked(emailSend.sendTransactionalEmail).mock.calls.length).toBe(emailSends);
  });

  it("WATI CF-2026-00040 next webhook relinks without repeating delivered closing or sent email", async () => {
    const store = createStore("whatsapp");
    await playWatiToConfirmation(store);
    await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise",
      }),
    );
    expect(store.tickets).toHaveLength(1);
    const active = store.tickets[0]!;
    active.ticketCode = "CF-2026-00040";
    active.ticket_code = "CF-2026-00040";
    store.tickets.unshift({
      ...cloneJson(active),
      id: "older-inactive-wati",
      status: "resolved",
      ticketCode: "CF-2026-00039",
      ticket_code: "CF-2026-00039",
    });
    for (const message of store.messages) {
      if (message.direction !== "outbound") continue;
      const body = String(message.messageBody ?? "");
      if (body.includes("Should I raise a support ticket")) {
        message.deliveryStatus = "read";
      }
      if (body.includes("Ticket ID:")) {
        message.deliveryStatus = "delivered";
      }
    }
    unlinkToCreatorConfirmation(store, "CF-2026-00040");
    seedHistoricalConversations(store, "whatsapp");
    const historical = historicalSnapshot(store);
    const creator = store.conversations[0]!;
    const creatorContact = creator.externalContactId;
    const creatorRecipient = creator.recipientAccountId;
    const closingSends = ticketClosingWatiCalls();
    const emailSends = vi.mocked(emailSend.sendTransactionalEmail).mock.calls.length;
    const email = store.emails.find(
      (row) => row.purpose === "whatsapp-ticket-confirmation",
    );
    expect(email?.deliveryStatus).toBe("sent");

    const retry = await sendWati(
      store,
      watiTextPayload({ text: "Hi", whatsappMessageId: "wamid.hi.repair" }),
    );
    expect(retry.result.outcome).toBe("stored");
    expect(store.tickets.filter((row) => String(row.status) === "open")).toHaveLength(1);
    expect(String(store.tickets.find((row) => String(row.status) === "open")?.ticketCode)).toBe(
      "CF-2026-00040",
    );
    expect(retry.snapshot.ticketId).toBe(String(active.id));
    expect(store.conversations[0]?.ticketId).toBe(String(active.id));
    expect(retry.snapshot.state).toBe("awaiting_post_completion");
    expect(retry.snapshot.state).not.toBe("creator_confirmation");
    expect(ticketClosingWatiCalls()).toBe(closingSends);
    expect(vi.mocked(emailSend.sendTransactionalEmail).mock.calls.length).toBe(emailSends);
    expect(email?.deliveryStatus).toBe("sent");
    expect(store.conversations[0]?.externalContactId).toBe(creatorContact);
    expect(store.conversations[0]?.recipientAccountId).toBe(creatorRecipient);
    expect(historicalSnapshot(store)).toEqual(historical);

    const restarted = await sendWati(
      store,
      watiTextPayload({ text: "restart", whatsappMessageId: "wamid.restart.repair" }),
    );
    expect(restarted.snapshot.state).not.toBe("creator_confirmation");
    expect(restarted.snapshot.ticketId).toBe(String(active.id));
    const raisedAgain = await sendWati(
      store,
      watiTextPayload({
        text: CREATOR_TICKET_CONFIRM_TITLE,
        type: "button",
        buttonReply: { title: CREATOR_TICKET_CONFIRM_TITLE },
        whatsappMessageId: "wamid.raise.repair",
      }),
    );
    expect(store.tickets.filter((row) => String(row.status) === "open")).toHaveLength(1);
    expect(raisedAgain.snapshot.state).not.toBe("creator_confirmation");
    expect(ticketClosingWatiCalls()).toBe(closingSends);
    expect(vi.mocked(emailSend.sendTransactionalEmail).mock.calls.length).toBe(emailSends);
  });
});
