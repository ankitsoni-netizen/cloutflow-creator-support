import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  sendStaffWhatsAppReply,
  isWhatsAppTicket,
} from "@/lib/tickets/whatsapp-reply";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import type { DbTicket } from "@/lib/tickets/types";
import * as whatsappProvider from "@/lib/meta/whatsapp-provider";
import * as watiSend from "@/lib/wati/send";
import * as metaSend from "@/lib/meta/whatsapp-send";
import * as instagramTicketMail from "@/lib/email/instagram-ticket-mail";
import { WHATSAPP_MESSAGING_WINDOW_STAFF_WARNING } from "@/lib/meta/routing-copy";

const WA_ID = "16315551181";
const CONVO_EXTERNAL_ID = "123456123:16315551181";

function ticket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-1",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: "+16315551181",
    creator_email: "riya@example.com",
    social_handle: "riya",
    platform: "instagram",
    issue_type: "payment_delayed",
    campaign_name: null,
    brand_name: null,
    campaign_month: "2026-08-01",
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: "creator_support",
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: null,
    source_channel: "whatsapp",
    status: "open",
    priority: "normal",
    assigned_team: "Creator Support",
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: "Payment delayed",
    internal_notes: null,
    acknowledgement_email_requested: true,
    acknowledgement_email_sent_at: null,
    resolution_summary: null,
    first_response_at: null,
    resolved_at: null,
    customer_last_notified_at: null,
    metadata: null,
    external_contact_id: WA_ID,
    external_conversation_id: CONVO_EXTERNAL_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function store(overrides: Partial<InstagramIngestStore> = {}): InstagramIngestStore {
  const messages: Array<Record<string, unknown>> = [];
  const emails: Array<Record<string, unknown>> = [];
  return {
    async getConversation() {
      return {
        id: "convo-1",
        displayName: null,
        ticketId: "ticket-1",
        state: "ticket_open",
        routingIntent: "creator_support",
        currentIntakeField: null,
        lastPromptKey: null,
        lastActivityAt: new Date().toISOString(),
        lastProcessedExternalMessageId: "wamid.1",
        collectedData: {},
        externalContactId: WA_ID,
        intakeSessionVersion: 0,
      };
    },
    async claimOutboundMessage(input) {
      const existing = messages.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (existing) {
        return {
          outcome: "duplicate" as const,
          id: existing.id as string,
          deliveryStatus: String(existing.deliveryStatus),
          externalMessageId: (existing.externalMessageId as string | null) ?? null,
        };
      }
      messages.push({
        id: "out-1",
        idempotencyKey: input.idempotencyKey,
        deliveryStatus: "pending",
        recipientExternalId: input.recipientExternalId,
        messageBody: input.messageBody,
      });
      return { outcome: "claimed" as const, id: "out-1" };
    },
    async markOutboundMessage(id, patch) {
      const row = messages.find((message) => message.id === id);
      if (row) Object.assign(row, patch);
    },
    async claimEmailDelivery(input) {
      const existing = emails.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (existing) {
        return {
          outcome: "duplicate" as const,
          id: existing.id as string,
          deliveryStatus: String(existing.deliveryStatus),
        };
      }
      emails.push({ id: "email-1", idempotencyKey: input.idempotencyKey, deliveryStatus: "pending" });
      return { outcome: "claimed" as const, id: "email-1" };
    },
    async markEmailDelivery() {},
    ...overrides,
  } as InstagramIngestStore;
}

describe("CRM WhatsApp replies", () => {
  it("sends a public reply to the ticket wa_id", async () => {
    const send = vi
      .spyOn(whatsappProvider, "sendWhatsAppProviderText")
      .mockResolvedValue({
        ok: true,
        metaMessageId: "wamid.staff",
        recipientId: WA_ID,
      });
    vi.spyOn(instagramTicketMail, "sendInstagramCreatorReplyEmail").mockResolvedValue({
      outcome: "sent",
      messageId: "brevo-1",
    });
    const result = await sendStaffWhatsAppReply({
      ticket: ticket(),
      commentId: "comment-1",
      commentText: "We are looking into this.",
      store: store(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.whatsapp).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: WA_ID, text: "We are looking into this." }),
    );
    send.mockRestore();
  });

  it("routes CRM public replies through WATI when WHATSAPP_PROVIDER=wati", async () => {
    const previous = process.env.WHATSAPP_PROVIDER;
    process.env.WHATSAPP_PROVIDER = "wati";
    process.env.WATI_API_ENDPOINT = "https://live-mt-server.wati.io/tenant";
    process.env.WATI_API_TOKEN = "wati-token";
    process.env.WATI_CHANNEL_PHONE_NUMBER = "17435002445";
    const wati = vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati.crm",
      recipientId: WA_ID,
    });
    const meta = vi.spyOn(metaSend, "sendWhatsAppText");
    vi.spyOn(instagramTicketMail, "sendInstagramCreatorReplyEmail").mockResolvedValue({
      outcome: "skipped",
      errorCode: "no_email",
    });
    try {
      const result = await sendStaffWhatsAppReply({
        ticket: ticket(),
        commentId: "comment-wati",
        commentText: "WATI reply",
        store: store(),
      });
      expect(result.ok).toBe(true);
      expect(wati).toHaveBeenCalled();
      expect(meta).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.WHATSAPP_PROVIDER;
      else process.env.WHATSAPP_PROVIDER = previous;
      delete process.env.WATI_API_ENDPOINT;
      delete process.env.WATI_API_TOKEN;
      delete process.env.WATI_CHANNEL_PHONE_NUMBER;
      wati.mockRestore();
      meta.mockRestore();
    }
  });

  it("does not send when the recipient would not match the conversation", async () => {
    const send = vi.spyOn(whatsappProvider, "sendWhatsAppProviderText");
    const result = await sendStaffWhatsAppReply({
      ticket: ticket(),
      commentId: "comment-1",
      commentText: "Hello",
      store: store({
        async getConversation() {
          return {
            id: "convo-1",
            displayName: null,
            ticketId: "ticket-1",
            state: "ticket_open",
            routingIntent: "creator_support",
            currentIntakeField: null,
            lastPromptKey: null,
            lastActivityAt: new Date().toISOString(),
            lastProcessedExternalMessageId: "wamid.1",
            collectedData: {},
            externalContactId: "99999999999",
            intakeSessionVersion: 0,
          };
        },
      }),
    });
    expect(result).toMatchObject({ ok: false, errorCode: "recipient_mismatch" });
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("does not double-send when the same comment is retried", async () => {
    const send = vi
      .spyOn(whatsappProvider, "sendWhatsAppProviderText")
      .mockResolvedValue({
        ok: true,
        metaMessageId: "wamid.staff",
        recipientId: WA_ID,
      });
    vi.spyOn(instagramTicketMail, "sendInstagramCreatorReplyEmail").mockResolvedValue({
      outcome: "sent",
      messageId: "brevo-1",
    });
    const memory = store();
    await sendStaffWhatsAppReply({
      ticket: ticket(),
      commentId: "comment-1",
      commentText: "We are looking into this.",
      store: memory,
    });
    send.mockClear();
    const retry = await sendStaffWhatsAppReply({
      ticket: ticket(),
      commentId: "comment-1",
      commentText: "We are looking into this.",
      store: memory,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.alreadySent).toBe(true);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("marks outside-window failures without sending a template", async () => {
    const send = vi.spyOn(whatsappProvider, "sendWhatsAppProviderText");
    const marked: Array<Record<string, unknown>> = [];
    const result = await sendStaffWhatsAppReply({
      ticket: ticket(),
      commentId: "comment-window",
      commentText: "Please retry this text.",
      store: store({
        async getConversation() {
          return {
            id: "convo-1",
            displayName: null,
            ticketId: "ticket-1",
            state: "ticket_open",
            routingIntent: "creator_support",
            currentIntakeField: null,
            lastPromptKey: null,
            lastActivityAt: "2020-01-01T00:00:00.000Z",
            lastProcessedExternalMessageId: "wamid.1",
            collectedData: {},
            externalContactId: WA_ID,
            intakeSessionVersion: 0,
          };
        },
        async markOutboundMessage(_id, patch) {
          marked.push(patch);
        },
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.whatsapp).toBe("failed");
      expect(result.whatsappErrorCode).toBe("outside_customer_service_window");
      expect(result.messagingWindowExpired).toBe(true);
    }
    expect(marked[0]).toMatchObject({
      deliveryStatus: "failed",
      deliveryErrorCode: "outside_customer_service_window",
    });
    expect(send).not.toHaveBeenCalled();
    expect(WHATSAPP_MESSAGING_WINDOW_STAFF_WARNING).toMatch(/customer-service window/i);
    send.mockRestore();
  });

  it("keeps WhatsApp success when the mirrored email fails", async () => {
    const send = vi
      .spyOn(whatsappProvider, "sendWhatsAppProviderText")
      .mockResolvedValue({
        ok: true,
        metaMessageId: "wamid.staff",
        recipientId: WA_ID,
      });
    vi.spyOn(instagramTicketMail, "sendInstagramCreatorReplyEmail").mockResolvedValue({
      outcome: "failed",
      errorCode: "brevo_failed",
    });
    const result = await sendStaffWhatsAppReply({
      ticket: ticket(),
      commentId: "comment-email",
      commentText: "We are looking into this.",
      store: store(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.whatsapp).toBe("sent");
      expect(result.email).toBe("failed");
    }
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });

  it("identifies WhatsApp tickets only", () => {
    expect(isWhatsAppTicket(ticket())).toBe(true);
    expect(isWhatsAppTicket(ticket({ source_channel: "instagram" }))).toBe(false);
    expect(isWhatsAppTicket(ticket({ source_channel: "website" }))).toBe(false);
  });

  it("never sends WhatsApp from the internal-note action", () => {
    const source = readFileSync(
      new URL("../workflow-actions.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function addInternalNoteAction");
    const end = source.indexOf("export async function queueCreatorReplyAction");
    const noteFn = source.slice(start, end);
    expect(noteFn).toContain("send_to_creator: false");
    expect(noteFn).not.toContain("sendStaffWhatsAppReply");
    expect(noteFn).not.toContain("sendWhatsAppText");
    expect(noteFn).not.toContain("sendWhatsAppProviderText");
  });

  it("routes CRM WhatsApp tickets through the provider adapter from the composer", () => {
    const composer = readFileSync(
      new URL("../../../components/ticket/ReplyComposer.tsx", import.meta.url),
      "utf8",
    );
    const workflow = readFileSync(
      new URL("../workflow-actions.ts", import.meta.url),
      "utf8",
    );
    const reply = readFileSync(
      new URL("../whatsapp-reply.ts", import.meta.url),
      "utf8",
    );
    expect(composer).toContain('sourceChannel.trim().toLowerCase() === "whatsapp"');
    expect(composer).toContain("isWhatsApp");
    expect(workflow).toContain("isWhatsAppTicket(ticket)");
    expect(workflow).toContain("sendStaffWhatsAppReply");
    expect(reply).toContain("sendWhatsAppProviderText");
  });
});
