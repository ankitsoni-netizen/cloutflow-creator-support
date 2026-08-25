import { describe, expect, it, vi, afterEach } from "vitest";
import { applyInstagramEffects } from "@/lib/meta/instagram-effects";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { emptyConversationSnapshot } from "@/lib/meta/conversation-machine";
import {
  creatorTicketRaisedText,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import type { DbTicket } from "@/lib/tickets/types";
import * as instagramSend from "@/lib/meta/instagram-send";
import * as instagramMail from "@/lib/email/instagram-ticket-mail";

function dbTicket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-1",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: "+919876543210",
    creator_email: "riya@example.com",
    social_handle: "riya_creates",
    platform: "instagram",
    issue_type: null,
    campaign_name: "Summer Drop",
    brand_name: "Acme",
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
    issue_description: "Need help with a campaign",
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

function collected() {
  return emptyIntakeCollected({
    creatorName: "Riya Sharma",
    email: "riya@example.com",
    phoneNormalized: "+919876543210",
    platform: "instagram",
    socialHandle: "riya_creates",
    campaignName: "Summer Drop",
    brandName: "Acme",
    campaignMonth: "2026-08-01",
    originalInboundText: "Need help with a campaign",
  });
}

function memoryStore(): InstagramIngestStore & {
  tickets: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
} {
  const tickets: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const emails: Array<Record<string, unknown>> = [];
  let ids = 0;
  const nextId = () => `id-${++ids}`;

  return {
    tickets,
    messages,
    async findActiveInstagramTicket() {
      const row = tickets.find((ticket) =>
        ["open", "in_progress", "waiting"].includes(String(ticket.status)),
      );
      if (!row) return null;
      return {
        id: row.id as string,
        status: String(row.status),
        ticketCode: String(row.ticketCode ?? row.ticket_code ?? ""),
      };
    },
    async insertInstagramTicket(row: Record<string, unknown>) {
      const id = nextId();
      const ticketCode = `CF-2026-${String(tickets.length + 1).padStart(5, "0")}`;
      tickets.push({
        id,
        status: "open",
        ticketCode,
        ticket_code: ticketCode,
        ...row,
      });
      return { outcome: "inserted" as const, id, ticketCode };
    },
    async getTicket(id: string) {
      const row = tickets.find((ticket) => ticket.id === id);
      if (!row) return null;
      return {
        id: String(row.id),
        status: String(row.status),
        ticketCode: String(row.ticketCode ?? row.ticket_code ?? ""),
      };
    },
    async linkSupportMessagesToTicket() {
      return;
    },
    async markMessagesRoutingKind() {
      return;
    },
    async listSupportTranscript() {
      return [];
    },
    async listFailedOutbounds() {
      return [];
    },
    async listRetryableOutbounds() {
      return [];
    },
    async saveConversationSnapshot() {
      return { outcome: "updated" as const };
    },
    async reserveOutboundAndSnapshot(input: {
      conversationId: string;
      snapshot: Record<string, unknown>;
      lastMessageAt: string;
      displayName: string | null;
      expectedLastProcessedExternalMessageId?: string | null;
      outbounds: Array<Record<string, unknown>>;
    }) {
      const reserved = [];
      for (const outbound of input.outbounds) {
        const claimed = await (this as unknown as InstagramIngestStore).claimOutboundMessage({
          conversationId: input.conversationId,
          ticketId: (outbound.ticketId as string | null) ?? null,
          channel: "instagram",
          recipientExternalId: String(outbound.recipientExternalId),
          senderAddress: (outbound.senderAddress as string | null) ?? null,
          messageBody: String(outbound.messageBody),
          idempotencyKey: String(outbound.idempotencyKey),
          purpose: String(outbound.purpose ?? "prompt"),
        });
        if (claimed.outcome === "failed") {
          return { outcome: "failed" as const, errorCode: claimed.errorCode };
        }
        reserved.push({
          id: claimed.id,
          idempotencyKey: String(outbound.idempotencyKey),
          deliveryStatus:
            claimed.outcome === "duplicate"
              ? claimed.deliveryStatus
              : "pending",
          claimed: claimed.outcome === "claimed",
        });
      }
      return { outcome: "reserved" as const, outbounds: reserved };
    },
    async claimOutboundMessage(input: Record<string, unknown>) {
      const duplicate = messages.find(
        (message) => message.idempotencyKey === input.idempotencyKey,
      );
      if (duplicate) {
        return {
          outcome: "duplicate" as const,
          id: duplicate.id as string,
          deliveryStatus: String(duplicate.deliveryStatus ?? "pending"),
          externalMessageId: (duplicate.externalMessageId as string | null) ?? null,
          conversationId: (duplicate.conversationId as string | null) ?? null,
          idempotencyKey: (duplicate.idempotencyKey as string | null) ?? null,
        };
      }
      const id = nextId();
      messages.push({
        id,
        ...input,
        deliveryStatus: "pending",
      });
      return { outcome: "claimed" as const, id };
    },
    async markOutboundMessage(id: string, patch: Record<string, unknown>) {
      const row = messages.find((message) => message.id === id);
      if (!row) return;
      Object.assign(row, patch);
    },
    async claimEmailDelivery(input: Record<string, unknown>) {
      const duplicate = emails.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (duplicate) {
        return {
          outcome: "duplicate" as const,
          id: duplicate.id as string,
          deliveryStatus: String(duplicate.deliveryStatus ?? "pending"),
        };
      }
      const id = nextId();
      emails.push({ id, ...input, deliveryStatus: "pending" });
      return { outcome: "claimed" as const, id };
    },
    async markEmailDelivery() {
      return;
    },
  } as unknown as InstagramIngestStore & {
    tickets: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
  };
}

describe("applyInstagramEffects ticket creation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the short Instagram confirmation before waiting for email", async () => {
    const order: string[] = [];
    const qrSend = vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockImplementation(
      async (options) => {
        order.push(`ig:${options.text}`);
        return {
          ok: true,
          metaMessageId: "mid.out",
          recipientId: "12334",
        };
      },
    );
    vi.spyOn(instagramSend, "sendInstagramText").mockImplementation(async (options) => {
      order.push(`ig-text:${options.text}`);
      return {
        ok: true,
        metaMessageId: "mid.out",
        recipientId: "12334",
      };
    });
    vi.spyOn(instagramMail, "sendInstagramTicketConfirmationEmail").mockImplementation(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push("email");
        return { outcome: "sent", messageId: "brevo-1" };
      },
    );
    const store = memoryStore();
    const ticket = dbTicket();
    const result = await applyInstagramEffects({
      effects: [{ type: "create_ticket" }],
      snapshotTicketId: null,
      collected: collected(),
      inboundMessageId: "mid.campaign",
      inboundText: "Summer Drop, Acme, August 2026",
      intakeSessionVersion: 1,
      snapshotToPersist: emptyConversationSnapshot({
        state: "ticket_open",
        intakeSessionVersion: 1,
      }),
      lastMessageAt: "2026-08-25T10:00:00.000Z",
      event: {
        externalContactId: "12334",
        externalConversationId: "12334",
      },
      deps: {
        store,
        recipientId: "12334",
        conversationId: "convo-1",
        outboundSenderAddress: "17841400008460000",
        loadTicket: async () => ticket,
      },
    });
    expect(store.tickets).toHaveLength(1);
    expect(result.ticketId).toBe(store.tickets[0]?.id);
    expect(result.snapshotPersisted).toBe(true);
    expect(order[0]).toBe(
      `ig:${withPostCompletionQuestion(creatorTicketRaisedText("CF-2026-00001"))}`,
    );
    expect(order).toContain("email");
    expect(order.indexOf("email")).toBeGreaterThan(0);
    expect(order.some((item) => item.includes("We've also sent"))).toBe(false);
    expect(qrSend).toHaveBeenCalled();
    const outbound = store.messages.find((message) =>
      String(message.idempotencyKey ?? "").includes("awaiting_post_completion"),
    );
    expect(outbound?.externalMessageId).toBe("mid.out");
    expect(outbound?.deliveryStatus).toBe("sent");
  });

  it("does not send an email-follow-up Instagram message when acknowledgement delivery fails", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    vi.spyOn(instagramMail, "sendInstagramTicketConfirmationEmail").mockResolvedValue({
      outcome: "failed",
      errorCode: "email_send_failed",
    });
    const store = memoryStore();
    await applyInstagramEffects({
      effects: [{ type: "create_ticket" }],
      snapshotTicketId: null,
      collected: collected(),
      inboundMessageId: "mid.campaign",
      inboundText: "Summer Drop, Acme, August 2026",
      intakeSessionVersion: 1,
      snapshotToPersist: emptyConversationSnapshot({
        state: "ticket_open",
        intakeSessionVersion: 1,
      }),
      lastMessageAt: "2026-08-25T10:00:00.000Z",
      event: {
        externalContactId: "12334",
        externalConversationId: "12334",
      },
      deps: {
        store,
        recipientId: "12334",
        conversationId: "convo-1",
        outboundSenderAddress: "17841400008460000",
        loadTicket: async () => dbTicket(),
      },
    });
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledTimes(1);
    expect(instagramSend.sendInstagramQuickReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        text: withPostCompletionQuestion(creatorTicketRaisedText("CF-2026-00001")),
      }),
    );
  });

  it("does not insert a second ticket when an active Instagram ticket already exists", async () => {
    vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
      ok: true,
      metaMessageId: "mid.out",
      recipientId: "12334",
    });
    vi.spyOn(instagramMail, "sendInstagramTicketConfirmationEmail").mockResolvedValue({
      outcome: "sent",
      messageId: "brevo-1",
    });
    const store = memoryStore();
    store.tickets.push({
      id: "ticket-existing",
      status: "open",
      ticketCode: "CF-2026-00001",
      ticket_code: "CF-2026-00001",
    });
    await applyInstagramEffects({
      effects: [{ type: "create_ticket" }],
      snapshotTicketId: null,
      collected: collected(),
      inboundMessageId: "mid.campaign",
      inboundText: "Summer Drop, Acme, August 2026",
      intakeSessionVersion: 1,
      snapshotToPersist: emptyConversationSnapshot({
        state: "ticket_open",
        intakeSessionVersion: 1,
      }),
      lastMessageAt: "2026-08-25T10:00:00.000Z",
      event: {
        externalContactId: "12334",
        externalConversationId: "12334",
      },
      deps: {
        store,
        recipientId: "12334",
        conversationId: "convo-1",
        outboundSenderAddress: "17841400008460000",
        loadTicket: async () => dbTicket({ id: "ticket-existing" }),
      },
    });
    expect(store.tickets).toHaveLength(1);
    expect(store.tickets[0]?.id).toBe("ticket-existing");
  });
});
