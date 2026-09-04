import { afterEach, describe, expect, it, vi } from "vitest";
import * as envCheck from "@/lib/email/env-check";
import * as ensureAlias from "@/lib/email/ensure-reply-alias";
import * as emailSend from "@/lib/email/send";
import {
  sendAcknowledgementForTicket,
  sendCreatorReplyEmail,
  sendInternalSupportNotificationForTicket,
  sendResolutionEmail,
} from "@/lib/email/ticket-mail";
import {
  sendInstagramCreatorReplyEmail,
  sendInstagramInboundHelpNotification,
  sendInstagramResolutionTranscriptEmail,
  sendInstagramTicketConfirmationEmail,
} from "@/lib/email/instagram-ticket-mail";
import type { DbTicket } from "@/lib/tickets/types";

const ALIAS = "t-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@reply.cloutflow.com";

function ticket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "existing-ticket-uuid",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: "+919876543210",
    creator_email: "riya@example.com",
    social_handle: "riya",
    platform: "instagram",
    issue_type: "payment_delayed",
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
    source_channel: "website",
    status: "open",
    priority: "normal",
    assigned_team: "Creator Support",
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: "Need help",
    internal_notes: null,
    acknowledgement_email_requested: true,
    acknowledgement_email_sent_at: null,
    resolution_summary: null,
    first_response_at: null,
    resolved_at: null,
    customer_last_notified_at: null,
    metadata: null,
    external_contact_id: null,
    external_conversation_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockSend() {
  vi.spyOn(envCheck, "isBrevoConfigured").mockReturnValue(true);
  const ensure = vi
    .spyOn(ensureAlias, "ensureTicketReplyToAddress")
    .mockResolvedValue(ALIAS);
  const send = vi.spyOn(emailSend, "sendTransactionalEmail").mockResolvedValue({
    messageId: "smtp-1",
    accepted: ["riya@example.com"],
    rejected: [],
    status: "accepted_by_brevo",
  });
  return { ensure, send };
}

describe("creator-facing Reply-To uses a lazily ensured opaque alias", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SUPPORT_INBOX_EMAIL;
  });

  it("sets Reply-To on website acknowledgement, staff reply, and resolution mail", async () => {
    const { ensure, send } = mockSend();
    const existing = ticket();

    await sendAcknowledgementForTicket(existing);
    await sendCreatorReplyEmail({ ticket: existing, commentText: "Update" });
    await sendResolutionEmail({
      ticket: existing,
      resolutionSummary: "Paid today",
    });

    expect(ensure.mock.calls).toEqual([
      [existing.id],
      [existing.id],
      [existing.id],
    ]);
    for (const [input] of send.mock.calls) {
      expect(input.replyTo).toBe(ALIAS);
    }
  });

  it("sets Reply-To on Instagram and WATI creator-facing confirmation, reply, and resolution mail", async () => {
    const { ensure, send } = mockSend();
    process.env.SUPPORT_INBOX_EMAIL = "help@cloutflow.com";
    const ig = ticket({ source_channel: "instagram" });
    const wa = ticket({ id: "existing-wa-ticket", source_channel: "whatsapp" });

    await sendInstagramTicketConfirmationEmail({
      ticket: ig,
      transcriptText: "hi",
    });
    await sendInstagramTicketConfirmationEmail({
      ticket: wa,
      transcriptText: "hi",
    });
    await sendInstagramCreatorReplyEmail({
      ticket: ig,
      commentText: "Staff reply",
    });
    await sendInstagramResolutionTranscriptEmail({
      ticket: ig,
      transcriptText: "thread",
      resolutionSummary: "Done",
    });

    expect(ensure).toHaveBeenCalledWith(ig.id);
    expect(ensure).toHaveBeenCalledWith(wa.id);
    expect(send.mock.calls.length).toBe(4);
    for (const [input] of send.mock.calls) {
      expect(input.replyTo).toBe(ALIAS);
    }
  });

  it("does not allocate or attach an alias when the ticket has no creator email", async () => {
    const { ensure, send } = mockSend();
    const result = await sendAcknowledgementForTicket(
      ticket({ creator_email: null }),
    );
    expect(result.outcome).toBe("failed");
    expect(ensure).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps requester Reply-To on internal inbox notifications and does not call alias allocation", async () => {
    const { ensure, send } = mockSend();
    process.env.SUPPORT_INBOX_EMAIL = "help@cloutflow.com";
    await sendInternalSupportNotificationForTicket(ticket());
    await sendInstagramInboundHelpNotification({
      ticket: ticket({ source_channel: "instagram" }),
      messagePreview: "new reply",
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0].replyTo).toBe("riya@example.com");
    expect(send.mock.calls[1]?.[0].replyTo).toBeUndefined();
  });
});
