import { afterEach, describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { IDENTITY_SCHEMA_UNAVAILABLE } from "@/lib/meta/identity-schema-phase";
import {
  runWithIdentitySchemaPhase,
  runWithIdentitySchemaPhaseAsync,
} from "@/lib/meta/identity-schema-phase";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import { instagramExternalConversationId } from "@/lib/meta/conversation-identity";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import * as instagramSend from "@/lib/meta/instagram-send";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import { instagramLoginMessagesPayload } from "@/lib/meta/__tests__/fixtures";
import { sendStaffInstagramReply } from "@/lib/tickets/instagram-reply";
import { ticketSelect, TICKET_SELECT_PHASE_A } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";

const PAGE_A = "17841400008460000";
const SENDER_A = "11111";
const SENDER_B = "22222";
const igContext = { webhookPayload: { object: "instagram" } };

afterEach(() => {
  delete process.env.IDENTITY_SCHEMA_PHASE;
  vi.restoreAllMocks();
});

function igEvent(senderId: string, mid: string, text: string): NormalizedMetaInboundText {
  const events = normalizeMetaWebhookPayload(
    instagramLoginMessagesPayload({
      senderId,
      recipientId: PAGE_A,
      mid,
      text,
    }),
  );
  const event = events.find((item) => item.externalMessageId === mid) ?? events[0];
  if (!event || event.channel !== "instagram") {
    throw new Error("expected instagram inbound fixture");
  }
  return event;
}

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

function staffTicket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-a",
    ticket_code: "CF-2026-00010",
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
    external_conversation_id: SENDER_A,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

async function ingestTwoSenders(store: ReturnType<typeof createMemoryChatbotStore>) {
  mockInstagramSend();
  await ingestInstagramInboundMessage(igEvent(SENDER_A, "mid.a", "hello a"), store, igContext);
  await ingestInstagramInboundMessage(igEvent(SENDER_B, "mid.b", "hello b"), store, igContext);
}

describe("identity rollout phases", () => {
  it("Phase A ticket select never includes new schema columns", () => {
    expect(ticketSelect()).toBe(TICKET_SELECT_PHASE_A);
    expect(ticketSelect()).not.toMatch(/identity_status/);
    expect(ticketSelect()).not.toMatch(/recipient_account_id/);
    runWithIdentitySchemaPhase("c", () => {
      expect(ticketSelect()).toMatch(/identity_status/);
    });
  });

  it("1. current schema + Phase A isolates creators and blocks page-only outbound", async () => {
    const store = createMemoryChatbotStore("instagram", { identitySchema: "current" });
    await ingestTwoSenders(store);
    const convoA = store.conversations.find((row) => row.externalContactId === SENDER_A);
    const convoB = store.conversations.find((row) => row.externalContactId === SENDER_B);
    expect(convoA?.id).toBeTruthy();
    expect(convoB?.id).toBeTruthy();
    expect(convoA?.id).not.toBe(convoB?.id);
    expect(store.conversations).toHaveLength(2);

    const send = vi.spyOn(instagramSend, "sendInstagramText");
    const blocked = await sendStaffInstagramReply({
      ticket: staffTicket({ external_conversation_id: PAGE_A }),
      commentId: "comment-page",
      commentText: "nope",
      store,
    });
    expect(blocked).toMatchObject({ ok: false, errorCode: "identity_ambiguous" });
    expect(send).not.toHaveBeenCalled();
  });

  it("2. expanded schema + Phase A still isolates creators without selecting new columns", async () => {
    const store = createMemoryChatbotStore("instagram", { identitySchema: "expanded" });
    await ingestTwoSenders(store);
    const ids = new Set(
      store.conversations
        .filter((row) => row.externalContactId === SENDER_A || row.externalContactId === SENDER_B)
        .map((row) => row.id),
    );
    expect(ids.size).toBe(2);
    expect(ticketSelect()).not.toMatch(/identity_status/);
  });

  it("3. expanded schema + Phase C continues unambiguous owners and blocks quarantined outbound", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockInstagramSend();
      const store = createMemoryChatbotStore("instagram", { identitySchema: "expanded" });
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
        igEvent(SENDER_A, "mid.continue", "follow up"),
        store,
        igContext,
      );
      await ingestInstagramInboundMessage(
        igEvent(SENDER_B, "mid.foreign", "other creator"),
        store,
        igContext,
      );
      expect(
        store.messages.some(
          (row) =>
            row.externalMessageId === "mid.continue" && row.ticketId === "ticket-legacy",
        ),
      ).toBe(true);
      expect(
        store.messages.some(
          (row) =>
            row.externalMessageId === "mid.foreign" && row.ticketId === "ticket-legacy",
        ),
      ).toBe(false);

      const send = vi.spyOn(instagramSend, "sendInstagramText");
      const blocked = await sendStaffInstagramReply({
        ticket: staffTicket({ identity_status: "quarantined" }),
        commentId: "comment-q",
        commentText: "nope",
        store,
      });
      expect(blocked).toMatchObject({ ok: false, errorCode: "identity_ambiguous" });
      expect(send).not.toHaveBeenCalled();
    });
  });

  it("4. Phase C against the current schema fails closed", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      const store = createMemoryChatbotStore("instagram", { identitySchema: "current" });
      const result = await ingestInstagramInboundMessage(
        igEvent(SENDER_A, "mid.phase-c-old", "hello"),
        store,
        igContext,
      );
      expect(result).toMatchObject({
        outcome: "failed",
        errorCode: IDENTITY_SCHEMA_UNAVAILABLE,
      });
      expect(ticketSelect()).toMatch(/identity_status/);
    });
  });
});
