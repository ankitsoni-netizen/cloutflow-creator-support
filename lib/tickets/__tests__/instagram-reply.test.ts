import { describe, expect, it, vi } from "vitest";
import {
  sendStaffInstagramReply,
  isInstagramTicket,
} from "@/lib/tickets/instagram-reply";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import type { DbTicket } from "@/lib/tickets/types";
import * as instagramSend from "@/lib/meta/instagram-send";
import { runWithIdentitySchemaPhaseAsync } from "@/lib/meta/identity-schema-phase";

function ticket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-1",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: "+919876543210",
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
    source_channel: "instagram",
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
    external_contact_id: "12334",
    external_conversation_id: "12334",
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
        lastProcessedExternalMessageId: "mid.1",
        collectedData: {},
        externalContactId: "12334",
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

describe("CRM Instagram replies", () => {
  it("sends a public reply to the ticket IGSID", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.staff",
      recipientId: "12334",
    });
    const result = await sendStaffInstagramReply({
      ticket: ticket(),
      commentId: "comment-1",
      commentText: "We are looking into this.",
      store: store(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instagram).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "12334", text: "We are looking into this." }),
    );
    send.mockRestore();
  });

  it("does not store the creator IGSID as the outbound sender", async () => {
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.staff",
      recipientId: "12334",
    });
    const claimed: Array<Record<string, unknown>> = [];
    await sendStaffInstagramReply({
      ticket: ticket(),
      commentId: "comment-sender",
      commentText: "We are looking into this.",
      store: store({
        async claimOutboundMessage(input) {
          claimed.push(input as unknown as Record<string, unknown>);
          return { outcome: "claimed" as const, id: "out-1" };
        },
      }),
    });
    expect(claimed[0]?.recipientExternalId).toBe("12334");
    expect(claimed[0]?.senderAddress).not.toBe("12334");
    vi.restoreAllMocks();
  });

  it("does not send when the recipient would not match the conversation", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText");
    const result = await sendStaffInstagramReply({
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
            lastProcessedExternalMessageId: "mid.1",
            collectedData: {},
            externalContactId: "99999",
            intakeSessionVersion: 0,
          };
        },
      }),
    });
    expect(result).toMatchObject({ ok: false, errorCode: "identity_ambiguous" });
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("does not double-send when the same comment is retried", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.staff",
      recipientId: "12334",
    });
    const memory = store();
    await sendStaffInstagramReply({
      ticket: ticket(),
      commentId: "comment-1",
      commentText: "We are looking into this.",
      store: memory,
    });
    send.mockClear();
    const retry = await sendStaffInstagramReply({
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

  it("marks outbound failed without dropping the queued content", async () => {
    vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: false,
      errorCode: "http_5xx",
      retryable: true,
      messagingWindowExpired: false,
      deliveryUnknown: false,
      httpStatus: 500,
    });
    const marked: Array<Record<string, unknown>> = [];
    const result = await sendStaffInstagramReply({
      ticket: ticket(),
      commentId: "comment-fail",
      commentText: "Please retry this text.",
      store: store({
        async markOutboundMessage(_id, patch) {
          marked.push(patch);
        },
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instagram).toBe("failed");
    expect(marked[0]).toMatchObject({
      deliveryStatus: "failed",
      deliveryErrorCode: "http_5xx",
    });
  });

  it("identifies Instagram tickets only", () => {
    expect(isInstagramTicket(ticket())).toBe(true);
    expect(isInstagramTicket(ticket({ source_channel: "website" }))).toBe(false);
  });

  it("rejects ordinary replies on resolved tickets", async () => {
    const result = await sendStaffInstagramReply({
      ticket: ticket({ status: "resolved" }),
      commentId: "comment-resolved",
      commentText: "Too late",
      store: store(),
    });
    expect(result).toMatchObject({ ok: false, errorCode: "ticket_not_active" });
  });

  it("allows resolution notifications on resolved tickets", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.resolve",
      recipientId: "12334",
    });
    const result = await sendStaffInstagramReply({
      ticket: ticket({ status: "resolved" }),
      commentId: "comment-resolve",
      commentText: "Resolved on our side.",
      store: store(),
      allowResolvedTicket: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instagram).toBe("sent");
    expect(send).toHaveBeenCalled();
    send.mockRestore();
  });

  it("skips Graph send when Instagram was already delivered", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.should-not-send",
      recipientId: "12334",
    });
    const result = await sendStaffInstagramReply({
      ticket: ticket({ status: "resolved" }),
      commentId: "comment-email-only",
      commentText: "Resolved on our side.",
      store: store(),
      allowResolvedTicket: true,
      skipInstagramDelivery: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instagram).toBe("sent");
      expect(result.alreadySent).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("refuses Phase A replies when the conversation key is page-only", async () => {
    const send = vi.spyOn(instagramSend, "sendInstagramText");
    const result = await sendStaffInstagramReply({
      ticket: ticket({
        external_contact_id: "12334",
        external_conversation_id: "17841400008460000",
      }),
      commentId: "comment-page-only",
      commentText: "Should not send.",
      store: store(),
    });
    expect(result).toMatchObject({ ok: false, errorCode: "identity_ambiguous" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses replies when the ticket identity is quarantined or ambiguous", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      const send = vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
        ok: true,
        metaMessageId: "mid.should-not-send",
        recipientId: "12334",
      });
      for (const identity_status of ["quarantined", "ambiguous"] as const) {
        const result = await sendStaffInstagramReply({
          ticket: ticket({ status: "resolved", identity_status }),
          commentId: `comment-${identity_status}`,
          commentText: "Should not send.",
          store: store(),
          allowResolvedTicket: true,
        });
        expect(result).toMatchObject({ ok: false, errorCode: "identity_ambiguous" });
      }
      expect(send).not.toHaveBeenCalled();
      send.mockRestore();
    });
  });
});
