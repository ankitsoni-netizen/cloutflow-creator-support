import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import {
  CREATOR_CAMPAIGN_ISSUE_TITLE,
  CREATOR_EXISTING_CAMPAIGN_TITLE,
  CREATOR_TICKET_CONFIRM_TITLE,
  PERSONA_CREATOR_TITLE,
} from "@/lib/meta/instagram-persona-copy";
import { ingestWhatsAppInboundMessage } from "@/lib/meta/whatsapp-ingest";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { normalizeWatiWebhookPayload } from "@/lib/wati/normalize";
import {
  WATI_TEST_CHANNEL,
  WATI_TEST_WA_ID,
  watiTextPayload,
} from "@/lib/wati/__tests__/fixtures";
import * as watiSend from "@/lib/wati/send";
import * as instagramTicketMail from "@/lib/email/instagram-ticket-mail";
import { sendStaffWhatsAppReply } from "@/lib/tickets/whatsapp-reply";
import { whatsappCrmConversationLookup } from "@/lib/tickets/whatsapp-crm-identity";
import type { DbTicket } from "@/lib/tickets/types";

pinIdentitySchemaPhase("c");

const CONTEXT = {
  webhookPayload: { provider: WATI_WHATSAPP_PROVIDER, sanitized: true },
};
const CREATOR_EMAIL = "riya@example.com";
const OTHER_WA_ID = "15551234567";

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "wati";
  process.env.WATI_CONVERSATION_TARGET_MODE = "recipient";
  process.env.WATI_CHANNEL_PHONE_NUMBER = WATI_TEST_CHANNEL;
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
  vi.spyOn(instagramTicketMail, "sendInstagramTicketConfirmationEmail").mockResolvedValue({
    outcome: "sent",
    messageId: "brevo-ack-1",
  });
});

afterEach(() => {
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.WATI_CONVERSATION_TARGET_MODE;
  delete process.env.WATI_CHANNEL_PHONE_NUMBER;
  vi.restoreAllMocks();
});

function eventFromPayload(payload: Record<string, unknown>) {
  const now = new Date();
  const normalized = normalizeWatiWebhookPayload({
    ...payload,
    timestamp: String(Math.floor(now.getTime() / 1000)),
    created: now.toISOString(),
  });
  expect(normalized.events).toHaveLength(1);
  return normalized.events[0]!;
}

function createStore() {
  return withDurableConversationPersistence(
    createMemoryChatbotStore("whatsapp", { identitySchema: "expanded" }),
  );
}

async function sendWati(
  store: ReturnType<typeof createStore>,
  payload: Record<string, unknown>,
) {
  const event = eventFromPayload(payload);
  const result = await ingestWhatsAppInboundMessage(event, store, CONTEXT);
  const snapshot = await reloadConversationSnapshot(
    store,
    "whatsapp",
    event.externalConversationId,
    identityLookupFromEvent(event),
  );
  return { result, event, snapshot };
}

async function playCreatorIntake(
  store: ReturnType<typeof createStore>,
  waId = WATI_TEST_WA_ID,
  prefix = "life",
) {
  await sendWati(
    store,
    watiTextPayload({
      waId,
      text: "Hi",
      whatsappMessageId: `wamid.${prefix}.hi`,
    }),
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
  await sendWati(
    store,
    watiTextPayload({
      waId,
      text: `Acme, August 2026, ${CREATOR_EMAIL}`,
      whatsappMessageId: `wamid.${prefix}.campaign`,
    }),
  );
  await sendWati(
    store,
    watiTextPayload({
      waId,
      text: "Yes",
      type: "button",
      buttonReply: { title: "Yes" },
      whatsappMessageId: `wamid.${prefix}.yes`,
    }),
  );
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
    source_channel: "whatsapp",
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

async function timelineBodies(store: ReturnType<typeof createStore>, ticket: DbTicket) {
  const lookup = whatsappCrmConversationLookup(ticket);
  const conversation = await store.getConversation(
    "whatsapp",
    ticket.external_conversation_id ?? "",
    lookup,
  );
  expect(conversation && !("errorCode" in conversation)).toBe(true);
  if (!conversation || "errorCode" in conversation) return [];
  return store.listSupportTranscript({
    conversationId: conversation.id,
    ticketId: ticket.id,
  });
}

describe("WATI post-ticket lifecycle", () => {
  it("creates one ticket, queues acknowledgement email once, and links the intake timeline", async () => {
    const store = createStore();
    const created = await playCreatorIntake(store);
    expect(created.result.outcome).toBe("stored");
    expect(created.snapshot.state).toBe("awaiting_post_completion");
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.creator_email).toBe(CREATOR_EMAIL);
    expect(store.tickets[0]?.campaign_name).toBeNull();
    expect(store.tickets[0]?.metadata).toMatchObject({
      provider: WATI_WHATSAPP_PROVIDER,
    });
    expect(store.tickets[0]?.identity_status).toBe("unambiguous");
    expect(store.conversations[0]?.ticketId).toBe(store.tickets[0]?.id);

    expect(instagramTicketMail.sendInstagramTicketConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(instagramTicketMail.sendInstagramTicketConfirmationEmail).mock.calls[0]?.[0]
        ?.ticket.creator_email,
    ).toBe(CREATOR_EMAIL);
    expect(
      store.emails.filter((row) => row.purpose === "whatsapp-ticket-confirmation"),
    ).toHaveLength(1);

    const retry = await ingestWhatsAppInboundMessage(created.event, store, CONTEXT);
    expect(retry.outcome).toBe("duplicate");
    expect(store.tickets).toHaveLength(1);
    expect(instagramTicketMail.sendInstagramTicketConfirmationEmail).toHaveBeenCalledTimes(1);

    const ticket = ticketFromStore(store);
    const rows = await timelineBodies(store, ticket);
    const inbound = store.messages.filter((message) => message.direction === "inbound");
    const outbound = store.messages.filter((message) => message.direction === "outbound");
    expect(inbound.length).toBeGreaterThanOrEqual(6);
    expect(outbound.length).toBeGreaterThanOrEqual(6);
    expect(rows).toHaveLength(inbound.length + outbound.length);
    expect(inbound.every((message) => message.ticketId === ticket.id)).toBe(true);
    expect(outbound.every((message) => message.ticketId === ticket.id)).toBe(true);
  });

  it("appends a creator follow-up to the same ticket without creating another", async () => {
    const store = createStore();
    await playCreatorIntake(store);
    const follow = await sendWati(
      store,
      watiTextPayload({
        text: "Any update?",
        whatsappMessageId: "wamid.life.follow",
      }),
    );
    expect(store.tickets).toHaveLength(1);
    expect(follow.snapshot.ticketId).toBe(store.tickets[0]?.id);
    expect(follow.snapshot.state).not.toBe("awaiting_persona");
    const ticket = ticketFromStore(store);
    const rows = await timelineBodies(store, ticket);
    expect(rows.some((row) => row.messageBody === "Any update?")).toBe(true);
  });

  it("sends a CRM reply to the ticket wa_id in recipient mode and records it once", async () => {
    const store = createStore();
    await playCreatorIntake(store);
    const ticket = ticketFromStore(store);
    vi.mocked(watiSend.sendWatiSessionText).mockClear();
    const sent = await sendStaffWhatsAppReply({
      ticket,
      commentId: "comment-crm-1",
      commentText: "We are looking into this.",
      store,
    });
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.whatsapp).toBe("sent");
      expect(sent.alreadySent).toBeFalsy();
    }

    const retry = await sendStaffWhatsAppReply({
      ticket,
      commentId: "comment-crm-1",
      commentText: "We are looking into this.",
      store,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.alreadySent).toBe(true);

    const staff = store.messages.filter((message) => message.purpose === "staff_reply");
    expect(staff).toHaveLength(1);
    expect(staff[0]?.recipientExternalId).toBe(WATI_TEST_WA_ID);
    expect(staff[0]?.recipientExternalId).not.toBe(WATI_TEST_CHANNEL);
    expect(String(staff[0]?.recipientExternalId)).not.toContain(":");
    expect(staff[0]?.ticketId).toBe(ticket.id);

    const rows = await timelineBodies(store, ticket);
    expect(
      rows.filter((row) => row.messageBody === "We are looking into this."),
    ).toHaveLength(1);
  });

  it("preserves failed CRM delivery for retry without duplicating the outbound row", async () => {
    const store = createStore();
    await playCreatorIntake(store);
    const ticket = ticketFromStore(store);
    vi.mocked(watiSend.sendWatiSessionText).mockResolvedValueOnce({
      ok: false,
      errorCode: "wati_send_failed",
      retryable: true,
      messagingWindowExpired: false,
      httpStatus: 500,
    });
    const failed = await sendStaffWhatsAppReply({
      ticket,
      commentId: "comment-fail",
      commentText: "Retry me",
      store,
    });
    expect(failed.ok).toBe(true);
    if (failed.ok) expect(failed.whatsapp).toBe("failed");
    expect(
      store.messages.filter((message) => message.purpose === "staff_reply"),
    ).toHaveLength(1);
    expect(store.messages.some((message) => message.deliveryStatus === "failed")).toBe(
      true,
    );

    vi.mocked(watiSend.sendWatiSessionText).mockResolvedValueOnce({
      ok: true,
      metaMessageId: "wamid.crm.retry",
      recipientId: WATI_TEST_WA_ID,
    });
    const retried = await sendStaffWhatsAppReply({
      ticket,
      commentId: "comment-fail",
      commentText: "Retry me",
      store,
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.whatsapp).toBe("sent");
    expect(
      store.messages.filter((message) => message.purpose === "staff_reply"),
    ).toHaveLength(1);
  });

  it("keeps two WATI creators isolated across tickets, email, and CRM replies", async () => {
    const store = createStore();
    await playCreatorIntake(store, WATI_TEST_WA_ID, "one");
    await playCreatorIntake(store, OTHER_WA_ID, "two");
    expect(store.tickets).toHaveLength(2);
    expect(store.tickets[0]?.external_contact_id).toBe(WATI_TEST_WA_ID);
    expect(store.tickets[1]?.external_contact_id).toBe(OTHER_WA_ID);
    expect(store.tickets[0]?.id).not.toBe(store.tickets[1]?.id);

    const first = ticketFromStore(store, 0);
    const second = ticketFromStore(store, 1);
    const firstRows = await timelineBodies(store, first);
    const secondRows = await timelineBodies(store, second);
    expect(firstRows.some((row) => row.messageBody === "Hi")).toBe(true);
    expect(secondRows.some((row) => row.messageBody === "Hi")).toBe(true);
    expect(
      store.messages.some(
        (message) =>
          message.ticketId === first.id &&
          String(message.conversationId) === String(store.conversations[1]?.id),
      ),
    ).toBe(false);

    const reply = await sendStaffWhatsAppReply({
      ticket: first,
      commentId: "comment-iso",
      commentText: "Only for creator one",
      store,
    });
    expect(reply.ok).toBe(true);
    const staff = store.messages.find((message) => message.commentId === "comment-iso");
    expect(staff?.recipientExternalId).toBe(WATI_TEST_WA_ID);
    expect(staff?.ticketId).toBe(first.id);
  });

  it("fails closed when the ticket contact does not match the conversation", async () => {
    const store = createStore();
    await playCreatorIntake(store);
    const ticket = ticketFromStore(store);
    const result = await sendStaffWhatsAppReply({
      ticket: {
        ...ticket,
        external_contact_id: OTHER_WA_ID,
      },
      commentId: "comment-mismatch",
      commentText: "Nope",
      store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["identity_ambiguous", "recipient_mismatch", "conversation_missing"]).toContain(
        result.errorCode,
      );
    }
    expect(
      store.messages.filter((message) => message.purpose === "staff_reply"),
    ).toHaveLength(0);
  });

  it("sends recipient-mode CRM text to wa_id only", async () => {
    const store = createStore();
    await playCreatorIntake(store);
    const ticket = ticketFromStore(store);
    const result = await sendStaffWhatsAppReply({
      ticket,
      commentId: "comment-target",
      commentText: "Target check",
      store,
    });
    expect(result.ok).toBe(true);
    const outbound = store.messages.find((message) => message.commentId === "comment-target");
    expect(outbound?.recipientExternalId).toBe(WATI_TEST_WA_ID);
    expect(outbound?.recipientExternalId).not.toBe(`${WATI_TEST_CHANNEL}:${WATI_TEST_WA_ID}`);
    expect(outbound?.recipientExternalId).not.toBe(WATI_TEST_CHANNEL);
    expect(watiSend.sendWatiSessionText).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: WATI_TEST_WA_ID }),
    );
  });
});
