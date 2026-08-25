import { describe, expect, it, vi, afterEach } from "vitest";
import {
  instagramTicketEmailSubject,
  sendInstagramTicketConfirmationEmail,
} from "@/lib/email/instagram-ticket-mail";
import { buildTicketAcknowledgementEmail } from "@/lib/email/templates/ticket-acknowledgement";
import { buildInstagramTicketAcknowledgementContent } from "@/lib/email/ticket-mail";
import * as emailSend from "@/lib/email/send";
import * as envCheck from "@/lib/email/env-check";
import type { DbTicket } from "@/lib/tickets/types";

function ticket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "internal-db-id",
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

describe("Instagram ticket email subject", () => {
  it("uses the ticket-code subject consistently for CRM replies", () => {
    expect(instagramTicketEmailSubject("CF-2026-00001")).toBe(
      "[CF-2026-00001] Cloutflow Creator Support",
    );
  });
});

describe("Instagram ticket confirmation email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("reuses the website acknowledgement template and BCCs the help inbox", async () => {
    vi.spyOn(envCheck, "isBrevoConfigured").mockReturnValue(true);
    const send = vi.spyOn(emailSend, "sendTransactionalEmail").mockResolvedValue({
      messageId: "brevo-1",
      accepted: ["riya@example.com"],
      rejected: [],
      status: "accepted_by_brevo",
    });
    const previousInbox = process.env.SUPPORT_INBOX_EMAIL;
    process.env.SUPPORT_INBOX_EMAIL = "help@cloutflow.com";

    const dbTicket = ticket();
    const expected = buildTicketAcknowledgementEmail(
      buildInstagramTicketAcknowledgementContent(dbTicket),
    );
    const result = await sendInstagramTicketConfirmationEmail({
      ticket: dbTicket,
      transcriptText: "ignored",
    });

    expect(result.outcome).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "riya@example.com",
        subject: expected.subject,
        html: expected.html,
        text: expected.text,
        bccEmails: ["help@cloutflow.com"],
      }),
    );
    expect(expected.subject).toBe("We've received your request — CF-2026-00001");
    expect(expected.html).toContain("We&#39;ve received your request");
    expect(JSON.stringify(send.mock.calls)).not.toContain("internal-db-id");

    if (previousInbox === undefined) {
      delete process.env.SUPPORT_INBOX_EMAIL;
    } else {
      process.env.SUPPORT_INBOX_EMAIL = previousInbox;
    }
  });
});
