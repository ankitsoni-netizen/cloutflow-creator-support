import { describe, expect, it } from "vitest";
import { escapeHtml, isValidEmailAddress } from "@/lib/email/html";
import { isBrevoConfigured } from "@/lib/email/env-check";
import { buildTicketAcknowledgementEmail } from "@/lib/email/templates/ticket-acknowledgement";
import { buildTicketReplyEmail } from "@/lib/email/templates/ticket-reply";
import { buildTicketResolutionEmail } from "@/lib/email/templates/ticket-resolution";
import {
  formatTicketEmailLabels,
  sendAcknowledgementForTicket,
  buildAcknowledgementEmailContent,
  buildInstagramTicketAcknowledgementContent,
} from "@/lib/email/ticket-mail";
import {
  formatCampaignMonthForDisplay,
  mapIssueTypeFromDb,
} from "@/lib/tickets/map";
import type { DbTicket } from "@/lib/tickets/types";

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });
});

describe("ticket email display formatting", () => {
  it("maps issue_type via shared ISSUE_TYPE_FROM_DB helper", () => {
    expect(mapIssueTypeFromDb("payment_delayed")).toBe("Payment Delayed");
  });

  it("formats campaign_month as Month YYYY without timezone shift", () => {
    expect(formatCampaignMonthForDisplay("2026-08-01")).toBe("August 2026");
    expect(formatCampaignMonthForDisplay("2026-01-01")).toBe("January 2026");
    expect(formatCampaignMonthForDisplay("2026-12")).toBe("December 2026");
  });

  it("formats DbTicket labels for email templates", () => {
    const labels = formatTicketEmailLabels({
      id: "t1",
      ticket_code: "CF-2026-00001",
      creator_name: "Riya Sharma",
      creator_phone: null,
      creator_email: "riya@example.com",
      social_handle: null,
      platform: "instagram",
      issue_type: "payment_delayed",
      campaign_name: "Summer",
      brand_name: "Acme",
      campaign_month: "2026-08-01",
      cloutflow_poc_name: null,
      cloutflow_poc_contact_number: null,
      request_category: null,
      company_name: null,
      requester_type: null,
      topic_or_module: null,
      intake_details: null,
      source_channel: "phone_call",
      status: "in_progress",
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(labels.issueType).toBe("Payment Delayed");
    expect(labels.campaignMonth).toBe("August 2026");
    expect(labels.ticketStatus).toBe("In Progress");
  });
});

describe("acknowledgement template", () => {
  it("includes formatted issue type and campaign month and escapes HTML", () => {
    const labels = {
      issueType: mapIssueTypeFromDb("payment_delayed"),
      campaignMonth: formatCampaignMonthForDisplay("2026-08-01"),
    };
    const email = buildTicketAcknowledgementEmail({
      creatorName: `Riya <b>Sharma</b>`,
      ticketCode: "CF-2026-00001",
      enquiryCategory: labels.issueType,
      detailRows: [
        { label: "Issue type", value: labels.issueType },
        { label: "Brand", value: "Acme" },
        { label: "Campaign", value: "Summer Launch" },
        { label: "Campaign month", value: labels.campaignMonth },
      ],
    });

    expect(email.subject).toBe(
      "We've received your request — CF-2026-00001",
    );
    expect(email.html).toContain("Payment Delayed");
    expect(email.html).toContain("August 2026");
    expect(email.html).not.toContain("payment_delayed");
    expect(email.html).not.toContain("2026-08-01");
    expect(email.text).toContain("Issue type: Payment Delayed");
    expect(email.text).toContain("Campaign month: August 2026");
    expect(email.html).toContain("Riya &lt;b&gt;Sharma&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Sharma</b>");
  });
});

describe("Instagram acknowledgement reuses the website template", () => {
  const instagramTicket: DbTicket = {
    id: "t1",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: "+919876543210",
    creator_email: "riya@example.com",
    social_handle: "riya_creates",
    platform: "youtube",
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it("keeps website acknowledgement rows unchanged", () => {
    const website = buildAcknowledgementEmailContent({
      ...instagramTicket,
      source_channel: "website",
      issue_description: "Website enquiry body",
    });
    expect(website.detailRows.some((row) => row.label === "Original inquiry")).toBe(
      false,
    );
    expect(website.detailRows.some((row) => row.label === "Issue type")).toBe(
      false,
    );
  });

  it("renders ticket code, creator, platform, username, campaign, brand, month and original inquiry", () => {
    const content = buildInstagramTicketAcknowledgementContent(instagramTicket);
    const email = buildTicketAcknowledgementEmail(content);
    expect(email.subject).toBe("We've received your request — CF-2026-00001");
    expect(email.html).toContain("We&#39;ve received your request");
    expect(email.text).toContain("Ticket code: CF-2026-00001");
    expect(email.text).toContain("Platform: YouTube");
    expect(email.text).toContain("Username: riya_creates");
    expect(email.text).toContain("Campaign: Summer Drop");
    expect(email.text).toContain("Brand: Acme");
    expect(email.text).toContain("Campaign month: August 2026");
    expect(email.text).toContain("Original inquiry: Need help with a campaign");
    expect(email.text).toContain("follow up as soon as possible");
    expect(email.html).not.toContain(instagramTicket.id);
  });
});

describe("reply template", () => {
  it("includes formatted campaign month and escapes staff reply", () => {
    const email = buildTicketReplyEmail({
      creatorName: "Riya Sharma",
      ticketCode: "CF-2026-00001",
      staffReply: `Hello <img src=x onerror=alert(1)>`,
      ticketStatus: "In Progress",
      brand: "Acme",
      campaignName: "Summer Launch",
      campaignMonth: formatCampaignMonthForDisplay("2026-08-01"),
    });

    expect(email.subject).toBe(
      "Update on your Cloutflow support ticket CF-2026-00001",
    );
    expect(email.html).toContain("August 2026");
    expect(email.html).not.toContain("2026-08-01");
    expect(email.text).toContain("Campaign month: August 2026");
    expect(email.html).toContain(
      "Hello &lt;img src=x onerror=alert(1)&gt;",
    );
  });
});

describe("resolution template", () => {
  it("includes formatted issue type and campaign month safely", () => {
    const email = buildTicketResolutionEmail({
      creatorName: "Riya Sharma",
      ticketCode: "CF-2026-00001",
      issueType: mapIssueTypeFromDb("payment_delayed"),
      resolutionSummary: `Paid on <script>`,
      brand: "Acme",
      campaignName: "Summer",
      campaignMonth: formatCampaignMonthForDisplay("2026-08-01"),
    });

    expect(email.subject).toBe(
      "Resolved: Your Cloutflow support ticket CF-2026-00001",
    );
    expect(email.html).toContain("Payment Delayed");
    expect(email.html).toContain("August 2026");
    expect(email.html).not.toContain("payment_delayed");
    expect(email.html).not.toContain("2026-08-01");
    expect(email.html).toContain("Paid on &lt;script&gt;");
    expect(email.text).toContain("Issue type: Payment Delayed");
    expect(email.text).toContain("Campaign month: August 2026");
  });
});

describe("acknowledgement send gates", () => {
  const baseTicket: DbTicket = {
    id: "t1",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: null,
    creator_email: "riya@example.com",
    social_handle: null,
    platform: "instagram",
    issue_type: "payment_delayed",
    campaign_name: "Summer",
    brand_name: "Acme",
    campaign_month: "2026-08-01",
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: null,
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: null,
    source_channel: "phone_call",
    status: "open",
    priority: "normal",
    assigned_team: "Creator Support",
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: null,
    internal_notes: null,
    acknowledgement_email_requested: false,
    acknowledgement_email_sent_at: null,
    resolution_summary: null,
    first_response_at: null,
    resolved_at: null,
    customer_last_notified_at: null,
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it("skips when acknowledgement is not requested", async () => {
    const result = await sendAcknowledgementForTicket(baseTicket);
    expect(result.outcome).toBe("skipped");
  });

  it("fails when creator email is missing", async () => {
    const result = await sendAcknowledgementForTicket({
      ...baseTicket,
      acknowledgement_email_requested: true,
      creator_email: null,
    });
    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/creator email/i);
  });

  it("treats already-sent acknowledgement as sent without resending", async () => {
    const result = await sendAcknowledgementForTicket({
      ...baseTicket,
      acknowledgement_email_requested: true,
      acknowledgement_email_sent_at: new Date().toISOString(),
    });
    expect(result.outcome).toBe("sent");
  });
});

describe("env and email helpers", () => {
  it("detects missing Brevo configuration without network calls", () => {
    expect(
      isBrevoConfigured({
        BREVO_SMTP_HOST: "",
      }),
    ).toBe(false);
  });

  it("validates email addresses", () => {
    expect(isValidEmailAddress("a@b.com")).toBe(true);
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("a@b.com\nBcc: evil@x.com")).toBe(false);
  });
});
