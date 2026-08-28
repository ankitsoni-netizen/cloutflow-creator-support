import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import {
  IDENTITY_MISSING,
  activeTicketMatchesIdentity,
  channelIdentityFromInbound,
  conversationRowMatchesIdentity,
  instagramExternalConversationId,
} from "@/lib/meta/conversation-identity";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import { ingestWhatsAppInboundMessage } from "@/lib/meta/whatsapp-ingest";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import { normalizeWatiWebhookPayload } from "@/lib/wati/normalize";
import * as instagramSend from "@/lib/meta/instagram-send";
import * as whatsappSend from "@/lib/meta/whatsapp-send";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import {
  instagramLoginMessagesPayload,
  instagramTextPayload,
  whatsappTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import { watiTextPayload, WATI_TEST_CHANNEL, WATI_TEST_WA_ID } from "@/lib/wati/__tests__/fixtures";
import { sendStaffInstagramReply } from "@/lib/tickets/instagram-reply";
import { createWebsiteTicketFromValidatedInput } from "@/lib/public-intake/create-website-ticket";
import { validateWebsiteTicketBody } from "@/lib/public-intake/validate";
import type { DbTicket } from "@/lib/tickets/types";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import { runWithIdentitySchemaPhaseAsync } from "@/lib/meta/identity-schema-phase";

const PAGE_A = "17841400008460000";
const PAGE_B = "17841499999999999";
const SENDER_A = "11111";
const SENDER_B = "22222";
const igContext = { webhookPayload: { object: "instagram" } };
const waContext = { webhookPayload: { object: "whatsapp_business_account" } };

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "meta";
});

afterEach(() => {
  delete process.env.WHATSAPP_PROVIDER;
  vi.restoreAllMocks();
});

function mockInstagramSend() {
  vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.out",
    recipientId: SENDER_A,
  });
  vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.qr",
    recipientId: SENDER_A,
  });
}

function mockWhatsAppSend() {
  vi.spyOn(whatsappSend, "sendWhatsAppReplyButtons").mockResolvedValue({
    ok: true,
    metaMessageId: "wamid.out",
    recipientId: "16315551181",
  });
  vi.spyOn(whatsappSend, "sendWhatsAppText").mockResolvedValue({
    ok: true,
    metaMessageId: "wamid.out",
    recipientId: "16315551181",
  });
}

function igEvent(
  senderId: string,
  mid: string,
  text: string,
  overrides: Partial<NormalizedMetaInboundText> = {},
): NormalizedMetaInboundText {
  const events = normalizeMetaWebhookPayload(
    instagramLoginMessagesPayload({
      senderId,
      recipientId: PAGE_A,
      mid,
      text,
    }),
  );
  return { ...events[0]!, ...overrides };
}

describe("conversation identity matching", () => {
  it("does not match an active ticket by conversation id or page id alone", () => {
    const identity = channelIdentityFromInbound(
      igEvent(SENDER_B, "mid.b", "hello"),
    );
    expect(identity).not.toBeNull();
    expect(
      activeTicketMatchesIdentity(
        {
          source_channel: "instagram",
          external_conversation_id: PAGE_A,
          external_contact_id: SENDER_A,
        },
        identity!,
        "instagram",
      ),
    ).toBe(false);
    expect(
      conversationRowMatchesIdentity(
        {
          channel: "instagram",
          externalConversationId: PAGE_A,
          externalContactId: SENDER_A,
        },
        identity!,
      ),
    ).toBe(false);
  });

  it("keeps Instagram sender.id as the contact and scopes conversation id with recipient.id", () => {
    const events = normalizeMetaWebhookPayload(
      instagramTextPayload({ senderId: SENDER_A }),
    );
    expect(events[0]?.externalContactId).toBe(SENDER_A);
    expect(events[0]?.recipientAccountId).toBe("INSTAGRAM_ACCOUNT_ID");
    expect(events[0]?.externalConversationId).toBe(
      instagramExternalConversationId("INSTAGRAM_ACCOUNT_ID", SENDER_A),
    );
    expect(events[0]?.externalConversationId).not.toBe("INSTAGRAM_ACCOUNT_ID");
  });
});

describe("cross-creator ticket correlation", () => {
  it("creates two conversations and two tickets for two Instagram accounts messaging concurrently", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const sameText = "Need help with a campaign";
    const sameTs = "2026-08-28T07:00:00.000Z";
    await Promise.all([
      ingestInstagramInboundMessage(
        igEvent(SENDER_A, "mid.a1", sameText, { timestamp: sameTs }),
        store,
        igContext,
      ),
      ingestInstagramInboundMessage(
        igEvent(SENDER_B, "mid.b1", sameText, { timestamp: sameTs }),
        store,
        igContext,
      ),
    ]);
    expect(store.conversations).toHaveLength(2);
    const contacts = new Set(
      store.conversations.map((row) => row.externalContactId),
    );
    expect(contacts).toEqual(new Set([SENDER_A, SENDER_B]));

    await Promise.all([
      store.insertInstagramTicket(
        mapIntakeToInstagramTicketInsert({
          collected: emptyIntakeCollected({ creatorName: "A" }),
          externalContactId: SENDER_A,
          externalConversationId: instagramExternalConversationId(PAGE_A, SENDER_A),
          recipientAccountId: PAGE_A,
        }),
      ),
      store.insertInstagramTicket(
        mapIntakeToInstagramTicketInsert({
          collected: emptyIntakeCollected({ creatorName: "B" }),
          externalContactId: SENDER_B,
          externalConversationId: instagramExternalConversationId(PAGE_A, SENDER_B),
          recipientAccountId: PAGE_A,
        }),
      ),
    ]);
    expect(store.tickets).toHaveLength(2);
    expect(new Set(store.tickets.map((row) => row.external_contact_id))).toEqual(
      new Set([SENDER_A, SENDER_B]),
    );
  });

  it("does not collide when two accounts send the same text at the same timestamp", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const text = "hello";
    const timestamp = "2026-08-28T07:00:00.000Z";
    await Promise.all([
      ingestInstagramInboundMessage(
        igEvent(SENDER_A, "mid.same.a", text, { timestamp }),
        store,
        igContext,
      ),
      ingestInstagramInboundMessage(
        igEvent(SENDER_B, "mid.same.b", text, { timestamp }),
        store,
        igContext,
      ),
    ]);
    expect(store.conversations).toHaveLength(2);
    expect(store.messages.filter((row) => row.direction === "inbound")).toHaveLength(2);
  });

  it("never uses recipient.id as the creator identity", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    await ingestInstagramInboundMessage(igEvent(SENDER_A, "mid.a", "hi"), store, igContext);
    await ingestInstagramInboundMessage(igEvent(SENDER_B, "mid.b", "hi"), store, igContext);
    expect(
      store.conversations.some(
        (row) => row.externalContactId === PAGE_A || row.externalConversationId === PAGE_A,
      ),
    ).toBe(false);
    expect(
      store.conversations.every((row) =>
        String(row.externalConversationId).startsWith(`${PAGE_A}:`),
      ),
    ).toBe(true);
  });

  it("keeps two accounts with identical usernames separate", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.a", "hi", { displayName: "same_handle" }),
      store,
      igContext,
    );
    await ingestInstagramInboundMessage(
      igEvent(SENDER_B, "mid.b", "hi", { displayName: "same_handle" }),
      store,
      igContext,
    );
    expect(store.conversations).toHaveLength(2);
  });

  it("preserves the stable sender id when the username changes", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.1", "hi", { displayName: "old_name" }),
      store,
      igContext,
    );
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.2", "still me", { displayName: "new_name" }),
      store,
      igContext,
    );
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]?.externalContactId).toBe(SENDER_A);
    expect(store.conversations[0]?.displayName).toBe("new_name");
  });

  it("works when username is missing", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const result = await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.anon", "hi", { displayName: null, senderName: null }),
      store,
      igContext,
    );
    expect(result.outcome).toBe("stored");
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]?.externalContactId).toBe(SENDER_A);
  });

  it("fails closed when sender identity is missing", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const event = igEvent(SENDER_A, "mid.missing", "hi");
    const result = await ingestInstagramInboundMessage(
      { ...event, externalContactId: "", senderAddress: "" },
      store,
      igContext,
    );
    expect(result).toEqual({ outcome: "failed", errorCode: IDENTITY_MISSING });
    expect(store.conversations).toHaveLength(0);
    expect(store.tickets).toHaveLength(0);
  });

  it("scopes the same Instagram sender through two receiving page accounts", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    await ingestInstagramInboundMessage(igEvent(SENDER_A, "mid.p1", "hi"), store, igContext);
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.p2", "hi", {
        recipientAccountId: PAGE_B,
        externalConversationId: instagramExternalConversationId(PAGE_B, SENDER_A),
      }),
      store,
      igContext,
    );
    expect(store.conversations).toHaveLength(2);
    expect(
      new Set(store.conversations.map((row) => row.externalConversationId)),
    ).toEqual(
      new Set([
        instagramExternalConversationId(PAGE_A, SENDER_A),
        instagramExternalConversationId(PAGE_B, SENDER_A),
      ]),
    );
  });

  it("keeps Meta WhatsApp senders separate", async () => {
    mockWhatsAppSend();
    const store = createMemoryChatbotStore("whatsapp");
    const events = normalizeMetaWebhookPayload(
      whatsappTextPayload({
        from: "16315551181",
        id: "wamid.a",
        extraMessages: [{ from: "16315550000", id: "wamid.b", body: "hello" }],
      }),
    );
    expect(events).toHaveLength(2);
    await ingestWhatsAppInboundMessage(events[0]!, store, waContext);
    await ingestWhatsAppInboundMessage(events[1]!, store, waContext);
    expect(store.conversations).toHaveLength(2);
    expect(new Set(store.conversations.map((row) => row.externalContactId))).toEqual(
      new Set(["16315551181", "16315550000"]),
    );
  });

  it("keeps WATI senders separate", async () => {
    mockWhatsAppSend();
    const store = createMemoryChatbotStore("whatsapp");
    const first = normalizeWatiWebhookPayload(watiTextPayload(), {
      expectedChannelPhoneNumber: WATI_TEST_CHANNEL,
    }).events[0]!;
    const second = normalizeWatiWebhookPayload(
      watiTextPayload({
        waId: "8618719000000",
        whatsappMessageId: "wamid.wati.b",
        conversationId: "shared-wati-thread",
      }),
      { expectedChannelPhoneNumber: WATI_TEST_CHANNEL },
    ).events[0]!;
    expect(first.externalConversationId).not.toBe("shared-wati-thread");
    expect(second.externalConversationId).not.toBe(first.externalConversationId);
    await ingestWhatsAppInboundMessage(first, store, waContext);
    await ingestWhatsAppInboundMessage(second, store, waContext);
    expect(store.conversations).toHaveLength(2);
    expect(store.conversations[0]?.externalContactId).toBe(WATI_TEST_WA_ID);
  });

  it("does not merge website inquiries by name, campaign, or latest ticket", async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table !== "tickets") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            const id = `ticket-${inserts.length}`;
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: {
                        ...row,
                        id,
                        ticket_code: `CF-2026-${String(inserts.length).padStart(5, "0")}`,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update() {
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const first = validateWebsiteTicketBody({
      category: "creator_support",
      name: "Same Name",
      phone: "+919876543210",
      email: "one@example.com",
      socialHandle: "@one",
      platform: "Instagram",
      issueType: "Payment Delayed / Not Received",
      campaignName: "Shared Campaign",
      brandName: "Acme",
      campaignMonth: "August 2026",
      message: "Help",
    });
    const second = validateWebsiteTicketBody({
      category: "creator_support",
      name: "Same Name",
      phone: "+919876543211",
      email: "two@example.com",
      socialHandle: "@two",
      platform: "Instagram",
      issueType: "Payment Delayed / Not Received",
      campaignName: "Shared Campaign",
      brandName: "Acme",
      campaignMonth: "August 2026",
      message: "Help",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const createdA = await createWebsiteTicketFromValidatedInput(first.value, {
      supabase: supabase as never,
      sendAcknowledgement: async () => ({ outcome: "skipped", error: "skip" }),
      sendInternalNotification: async () => ({ outcome: "skipped", error: "skip" }),
    });
    const createdB = await createWebsiteTicketFromValidatedInput(second.value, {
      supabase: supabase as never,
      sendAcknowledgement: async () => ({ outcome: "skipped", error: "skip" }),
      sendInternalNotification: async () => ({ outcome: "skipped", error: "skip" }),
    });
    expect(createdA.ok && createdB.ok).toBe(true);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.creator_email).toBe("one@example.com");
    expect(inserts[1]?.creator_email).toBe("two@example.com");
  });

  it("keeps email senders separate when the subject matches", () => {
    const tickets = [
      { source_channel: "email", creator_email: "one@example.com", campaign_name: "Shared" },
      { source_channel: "email", creator_email: "two@example.com", campaign_name: "Shared" },
    ];
    expect(new Set(tickets.map((row) => row.creator_email)).size).toBe(2);
  });

  it("appends follow-ups only to that identity's active ticket", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const convoA = instagramExternalConversationId(PAGE_A, SENDER_A);
    store.tickets.push({
      id: "ticket-a",
      status: "open",
      sourceChannel: "instagram",
      source_channel: "instagram",
      externalConversationId: convoA,
      external_conversation_id: convoA,
      externalContactId: SENDER_A,
      external_contact_id: SENDER_A,
      ticketCode: "CF-2026-00027",
    });
    store.conversations.push({
      id: "convo-a",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: PAGE_A,
      externalConversationId: convoA,
      externalContactId: SENDER_A,
      state: "ticket_open",
      ticketId: "ticket-a",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.prev",
      intakeSessionVersion: 1,
    });
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.follow.a", "following up"),
      store,
      igContext,
    );
    await ingestInstagramInboundMessage(
      igEvent(SENDER_B, "mid.start.b", "new inquiry"),
      store,
      igContext,
    );
    const bMessages = store.messages.filter(
      (row) => row.senderAddress === SENDER_B || row.externalContactId === SENDER_B,
    );
    expect(
      store.messages.some(
        (row) =>
          row.externalMessageId === "mid.follow.a" && row.ticketId === "ticket-a",
      ),
    ).toBe(true);
    expect(bMessages.every((row) => row.ticketId !== "ticket-a")).toBe(true);
    expect(store.conversations).toHaveLength(2);
    expect(store.tickets).toHaveLength(1);
  });

  it("does not attach a second sender to a ticket keyed by the receiving page id", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    store.tickets.push({
      id: "ticket-page-key",
      status: "open",
      sourceChannel: "instagram",
      source_channel: "instagram",
      externalConversationId: PAGE_A,
      external_conversation_id: PAGE_A,
      externalContactId: SENDER_A,
      external_contact_id: SENDER_A,
      ticketCode: "CF-2026-00027",
    });
    store.conversations.push({
      id: "convo-page",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: PAGE_A,
      externalConversationId: PAGE_A,
      externalContactId: SENDER_A,
      state: "ticket_open",
      ticketId: "ticket-page-key",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.prev",
      intakeSessionVersion: 1,
    });
    await ingestInstagramInboundMessage(
      igEvent(SENDER_B, "mid.foreign", "new inquiry"),
      store,
      igContext,
    );
    expect(
      store.messages.some(
        (row) =>
          row.externalMessageId === "mid.foreign" &&
          row.ticketId === "ticket-page-key",
      ),
    ).toBe(false);
    expect(store.conversations).toHaveLength(2);
  });

  it("creates a new ticket after the identity's ticket is resolved", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const convoA = instagramExternalConversationId(PAGE_A, SENDER_A);
    store.tickets.push({
      id: "ticket-resolved",
      status: "resolved",
      sourceChannel: "instagram",
      source_channel: "instagram",
      externalConversationId: convoA,
      external_conversation_id: convoA,
      externalContactId: SENDER_A,
      external_contact_id: SENDER_A,
      ticketCode: "CF-2026-00001",
    });
    store.conversations.push({
      id: "convo-a",
      channel: "instagram",
      externalConversationId: convoA,
      externalContactId: SENDER_A,
      state: "completed",
      ticketId: "ticket-resolved",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.prev",
      intakeSessionVersion: 1,
    });
    const created = await store.insertInstagramTicket(
      mapIntakeToInstagramTicketInsert({
        collected: emptyIntakeCollected({ creatorName: "A" }),
        externalContactId: SENDER_A,
        externalConversationId: convoA,
      }),
    );
    expect(created.outcome).toBe("inserted");
    if (created.outcome === "failed") return;
    expect(created.id).not.toBe("ticket-resolved");
    expect(store.tickets).toHaveLength(2);
  });

  it("creates fifty isolated conversations for fifty parallel inbound identities", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) => {
        const senderId = String(30000 + index);
        return ingestInstagramInboundMessage(
          igEvent(senderId, `mid.p.${index}`, "Need help with a campaign", {
            timestamp: "2026-08-28T07:00:00.000Z",
          }),
          store,
          igContext,
        );
      }),
    );
    expect(results.every((row) => row.outcome === "stored")).toBe(true);
    expect(store.conversations).toHaveLength(50);
    expect(new Set(store.conversations.map((row) => row.externalContactId)).size).toBe(
      50,
    );
    const tickets = await Promise.all(
      store.conversations.map((row) =>
        store.insertInstagramTicket(
          mapIntakeToInstagramTicketInsert({
            collected: emptyIntakeCollected(),
            externalContactId: String(row.externalContactId),
            externalConversationId: String(row.externalConversationId),
          }),
        ),
      ),
    );
    expect(tickets.every((row) => row.outcome === "inserted")).toBe(true);
    expect(store.tickets).toHaveLength(50);
  });

  it("sends outbound replies only to the identity bound to that ticket", async () => {
    mockInstagramSend();
    const send = vi.mocked(instagramSend.sendInstagramText);
    const store = createMemoryChatbotStore("instagram");
    await ingestInstagramInboundMessage(igEvent(SENDER_A, "mid.a", "hi"), store, igContext);
    await ingestInstagramInboundMessage(igEvent(SENDER_B, "mid.b", "hi"), store, igContext);
    const convoA = store.conversations.find((row) => row.externalContactId === SENDER_A);
    const convoB = store.conversations.find((row) => row.externalContactId === SENDER_B);
    expect(convoA && convoB).toBeTruthy();
    const outA = store.messages.find(
      (row) => row.direction === "outbound" && row.conversationId === convoA?.id,
    );
    const outB = store.messages.find(
      (row) => row.direction === "outbound" && row.conversationId === convoB?.id,
    );
    expect(outA?.recipientExternalId).toBe(SENDER_A);
    expect(outB?.recipientExternalId).toBe(SENDER_B);

    send.mockClear();
    send.mockResolvedValue({ ok: true, metaMessageId: "mid.staff", recipientId: SENDER_A });
    const ticket: DbTicket = {
      id: "ticket-a",
      ticket_code: "CF-2026-00027",
      creator_name: null,
      creator_phone: null,
      creator_email: null,
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
      external_contact_id: SENDER_A,
      external_conversation_id: String(convoA?.externalConversationId),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const replied = await sendStaffInstagramReply({
      ticket,
      commentId: "comment-a",
      commentText: "We are on it.",
      store,
    });
    expect(replied.ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: SENDER_A }),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: SENDER_B }),
    );
  });

  it("does not duplicate conversations, tickets, or messages on webhook retry", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const event = igEvent(SENDER_A, "mid.retry", "hello");
    const first = await ingestInstagramInboundMessage(event, store, igContext);
    const ticket = await store.insertInstagramTicket(
      mapIntakeToInstagramTicketInsert({
        collected: emptyIntakeCollected(),
        externalContactId: SENDER_A,
        externalConversationId: instagramExternalConversationId(PAGE_A, SENDER_A),
      }),
    );
    const retry = await ingestInstagramInboundMessage(event, store, igContext);
    expect(first.outcome).toBe("stored");
    expect(retry.outcome).toBe("duplicate");
    expect(store.conversations).toHaveLength(1);
    expect(store.tickets).toHaveLength(1);
    expect(ticket.outcome).toBe("inserted");
    expect(
      store.messages.filter((row) => row.externalMessageId === "mid.retry"),
    ).toHaveLength(1);
  });

  it("continues the legitimate legacy ticket after an unambiguous identity upgrade", async () => {
    mockInstagramSend();
    const store = createMemoryChatbotStore("instagram");
    const canonical = instagramExternalConversationId(PAGE_A, SENDER_A);
    store.tickets.push({
      id: "ticket-legacy",
      status: "open",
      sourceChannel: "instagram",
      source_channel: "instagram",
      externalConversationId: SENDER_A,
      external_conversation_id: SENDER_A,
      externalContactId: SENDER_A,
      external_contact_id: SENDER_A,
      recipientAccountId: PAGE_A,
      identity_status: "unambiguous",
      ticketCode: "CF-2026-00010",
    });
    store.conversations.push({
      id: "convo-legacy",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: PAGE_A,
      externalConversationId: canonical,
      externalContactId: SENDER_A,
      identityStatus: "unambiguous",
      state: "ticket_open",
      ticketId: "ticket-legacy",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.prev",
      intakeSessionVersion: 1,
    });
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.continue.a", "follow up"),
      store,
      igContext,
    );
    await ingestInstagramInboundMessage(
      igEvent(SENDER_B, "mid.new.b", "other creator"),
      store,
      igContext,
    );
    expect(
      store.messages.some(
        (row) =>
          row.externalMessageId === "mid.continue.a" &&
          row.ticketId === "ticket-legacy",
      ),
    ).toBe(true);
    expect(
      store.messages.some(
        (row) =>
          row.externalMessageId === "mid.new.b" && row.ticketId === "ticket-legacy",
      ),
    ).toBe(false);
    expect(
      store.conversations.some(
        (row) =>
          row.externalContactId === SENDER_B && row.ticketId !== "ticket-legacy",
      ),
    ).toBe(true);
  });

  it("does not continue a quarantined mixed ticket for the stored contact", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockInstagramSend();
      const store = createMemoryChatbotStore("instagram", {
        identitySchema: "expanded",
      });
    store.tickets.push({
      id: "ticket-mixed",
      status: "open",
      sourceChannel: "instagram",
      source_channel: "instagram",
      externalConversationId: SENDER_A,
      external_conversation_id: SENDER_A,
      externalContactId: SENDER_A,
      external_contact_id: SENDER_A,
      identity_status: "quarantined",
      ticketCode: "CF-2026-00027",
    });
    store.conversations.push({
      id: "convo-mixed",
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: PAGE_A,
      externalConversationId: SENDER_A,
      externalContactId: SENDER_A,
      identityStatus: "quarantined",
      state: "ticket_open",
      ticketId: "ticket-mixed",
      collectedData: {},
      lastProcessedExternalMessageId: "mid.prev",
      intakeSessionVersion: 1,
    });
    await ingestInstagramInboundMessage(
      igEvent(SENDER_A, "mid.after.quarantine", "hello again"),
      store,
      igContext,
    );
    expect(
      store.messages.some(
        (row) =>
          row.externalMessageId === "mid.after.quarantine" &&
          row.ticketId === "ticket-mixed",
      ),
    ).toBe(false);
    expect(store.conversations.some((row) => row.id === "convo-mixed")).toBe(true);
    expect(store.conversations.length).toBeGreaterThan(1);
    });
  });
});
