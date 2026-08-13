import { describe, expect, it, vi } from "vitest";
import {
  buildCorsHeaders,
  isOriginPermitted,
  resolveAllowedOrigin,
} from "@/lib/public-intake/cors";
import {
  createWebsiteTicketFromValidatedInput,
  toPublicWebsiteTicketResponse,
} from "@/lib/public-intake/create-website-ticket";
import {
  normalizeWebsiteIssueType,
  normalizeWebsitePlatform,
  WEBSITE_ISSUE_TYPES,
  WEBSITE_PLATFORMS,
} from "@/lib/public-intake/constants";
import { mapWebsiteFormToDbInsert } from "@/lib/public-intake/map";
import { validateWebsiteTicketBody } from "@/lib/public-intake/validate";
import {
  formatCampaignMonthForDisplay,
  mapDbTicketToTicket,
  mapIssueTypeFromDb,
} from "@/lib/tickets/map";
import type { DbTicket } from "@/lib/tickets/types";
import type { ValidatedWebsiteTicketInput } from "@/lib/public-intake/validate";
import {
  buildAcknowledgementDetailRows,
  buildAcknowledgementEmailContent,
  buildInternalNotificationDetailRows,
  buildInternalNotificationEmailContent,
  sendInternalSupportNotificationForTicket,
} from "@/lib/email/ticket-mail";
import { buildTicketAcknowledgementEmail } from "@/lib/email/templates/ticket-acknowledgement";
import { buildWebsiteInternalNotificationEmail } from "@/lib/email/templates/website-internal-notification";
import { formatDateTime } from "@/lib/utils";

const creatorSupportBody = {
  category: "creator_support",
  name: " Riya Sharma ",
  phone: "+919876543210",
  email: " Riya@Example.com ",
  socialHandle: " @riya ",
  platform: "Instagram",
  issueType: "Payment Delayed / Not Received",
  campaignName: " Summer Launch ",
  brandName: " Acme ",
  campaignMonth: "August 2026",
  cloutflowPocName: " Priya Sharma ",
  cloutflowPocContactNumber: "+919876543210",
  message: " Payment for July deliverables is still pending. ",
  companyWebsite: "",
};

function sampleTicket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-uuid",
    ticket_code: "CF-2026-00042",
    creator_name: "Riya Sharma",
    creator_phone: "+919876543210",
    creator_email: "riya@example.com",
    social_handle: "@riya",
    platform: "instagram",
    issue_type: "payment_delayed",
    campaign_name: "Summer Launch",
    brand_name: "Acme",
    campaign_month: "2026-08-01",
    cloutflow_poc_name: "Priya Sharma",
    cloutflow_poc_contact_number: "+919876543210",
    request_category: "creator_support",
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: { category: "creator_support" },
    source_channel: "website",
    status: "open",
    priority: "normal",
    assigned_team: "Creator Support",
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: "Payment pending",
    internal_notes: null,
    acknowledgement_email_requested: true,
    acknowledgement_email_sent_at: null,
    resolution_summary: null,
    first_response_at: null,
    resolved_at: null,
    customer_last_notified_at: null,
    metadata: null,
    created_at: "2026-08-11T10:00:00.000Z",
    updated_at: "2026-08-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("website intake validation by category", () => {
  it("accepts creator_support with full campaign fields", () => {
    const result = validateWebsiteTicketBody(creatorSupportBody);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBe("creator_support");
    expect(result.value.email).toBe("riya@example.com");
  });

  it("accepts creator_support without optional message and POC fields", () => {
    const result = validateWebsiteTicketBody({
      ticketType: "creator-support",
      name: "Riya Sharma",
      email: "riya@example.com",
      phone: "+919876543210",
      socialHandle: "@riya",
      platform: "Instagram",
      issueType: "Other",
      campaignName: "Summer Launch",
      brandName: "Acme",
      campaignMonth: "August 2026",
      website: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBe("creator_support");
    if (result.value.category !== "creator_support") return;
    expect(result.value.message).toBe("");
    expect(result.value.cloutflowPocName).toBeNull();
    expect(result.value.cloutflowPocContactNumber).toBeNull();
  });

  it("accepts kebab-case ticketType aliases from cloutflow.com/help", () => {
    const result = validateWebsiteTicketBody({
      ticketType: "brand-support",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Need account help",
      company: "Acme Brands",
      website: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBe("brand_support");
  });

  it("accepts track_campaign", () => {
    const result = validateWebsiteTicketBody({
      category: "track_campaign",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Where is my campaign?",
      company: "Acme",
      campaignNameOrId: "SUMMER-01",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts product_demo with optional phone", () => {
    const result = validateWebsiteTicketBody({
      category: "product_demo",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Book a demo",
      company: "Acme",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts brand_support", () => {
    const result = validateWebsiteTicketBody({
      category: "brand_support",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Need support",
      company: "Acme",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts reporting_analytics", () => {
    const result = validateWebsiteTicketBody({
      category: "reporting_analytics",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Need export help",
      company: "Acme",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts payments_commercials for brand and creator", () => {
    const brand = validateWebsiteTicketBody({
      category: "payments_commercials",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Invoice question",
      requesterType: "brand",
      company: "Acme",
      campaignNameOrId: "C-1",
    });
    expect(brand.ok).toBe(true);

    const creator = validateWebsiteTicketBody({
      category: "payments-commercials",
      name: "Riya",
      email: "riya@example.com",
      message: "Payment status",
      audience: "creator",
      socialHandle: "@riya",
    });
    expect(creator.ok).toBe(true);
  });

  it("accepts product_documentation", () => {
    const result = validateWebsiteTicketBody({
      category: "product_documentation",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Need docs",
      topicOrModule: "Analytics",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid categories", () => {
    const result = validateWebsiteTicketBody({
      category: "unknown_category",
      name: "Alex",
      email: "alex@brand.com",
      message: "Hello",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/category/i);
  });

  it("rejects missing required fields for brand_support", () => {
    const result = validateWebsiteTicketBody({
      category: "brand_support",
      name: "Alex",
      email: "alex@brand.com",
      message: "Hello",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/company/i);
  });

  it("rejects invalid email", () => {
    const result = validateWebsiteTicketBody({
      ...creatorSupportBody,
      email: "not-an-email",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown issueType with the existing error", () => {
    const result = validateWebsiteTicketBody({
      ...creatorSupportBody,
      issueType: "not-a-real-issue",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Select a valid issue type.");
  });

  it("rejects unknown platform with the existing error", () => {
    const result = validateWebsiteTicketBody({
      ...creatorSupportBody,
      platform: "TikTok",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Platform must be Instagram or YouTube.");
  });

  it("rejects honeypot submissions from either honeypot field", () => {
    expect(
      validateWebsiteTicketBody({
        ...creatorSupportBody,
        companyWebsite: "https://spam.example",
      }).ok,
    ).toBe(false);
    expect(
      validateWebsiteTicketBody({
        category: "brand_support",
        name: "Alex",
        email: "alex@brand.com",
        message: "Hello",
        company: "Acme",
        website: "bot",
      }).ok,
    ).toBe(false);
  });
});

describe("creator_support issueType and platform aliases", () => {
  const issueTypeAliases: Array<[string, (typeof WEBSITE_ISSUE_TYPES)[number]]> =
    [
      ["Payment delayed", "Payment Delayed / Not Received"],
      ["payment_delayed", "Payment Delayed / Not Received"],
      ["TDS query", "TDS Query"],
      ["tds_query", "TDS Query"],
      ["GST query", "GST Query"],
      ["gst_query", "GST Query"],
      ["POC / conduct concern", "POC / Conduct Concern"],
      ["poc_conduct_concern", "POC / Conduct Concern"],
      ["Other", "Other"],
      ["other", "Other"],
    ];

  it.each(issueTypeAliases)(
    "maps issueType alias %s to %s",
    (alias, canonical) => {
      expect(normalizeWebsiteIssueType(alias)).toBe(canonical);
      expect(normalizeWebsiteIssueType(alias.toUpperCase())).toBe(canonical);
      expect(normalizeWebsiteIssueType(` ${alias} `)).toBe(canonical);

      const result = validateWebsiteTicketBody({
        ...creatorSupportBody,
        issueType: alias,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      if (result.value.category !== "creator_support") return;
      expect(result.value.issueType).toBe(canonical);
    },
  );

  it.each([...WEBSITE_ISSUE_TYPES])(
    "still accepts the exact issueType label %s",
    (label) => {
      expect(normalizeWebsiteIssueType(label)).toBe(label);

      const result = validateWebsiteTicketBody({
        ...creatorSupportBody,
        issueType: label,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      if (result.value.category !== "creator_support") return;
      expect(result.value.issueType).toBe(label);
    },
  );

  it("returns null for an unknown issueType", () => {
    expect(normalizeWebsiteIssueType("not-a-real-issue")).toBeNull();
    expect(normalizeWebsiteIssueType("")).toBeNull();
    expect(normalizeWebsiteIssueType(null)).toBeNull();
  });

  const platformAliases: Array<[string, (typeof WEBSITE_PLATFORMS)[number]]> = [
    ["instagram", "Instagram"],
    ["INSTAGRAM", "Instagram"],
    ["youtube", "YouTube"],
    ["YOUTUBE", "YouTube"],
    ["YouTube", "YouTube"],
  ];

  it.each(platformAliases)(
    "maps platform alias %s to %s",
    (alias, canonical) => {
      expect(normalizeWebsitePlatform(alias)).toBe(canonical);

      const result = validateWebsiteTicketBody({
        ...creatorSupportBody,
        platform: alias,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      if (result.value.category !== "creator_support") return;
      expect(result.value.platform).toBe(canonical);
    },
  );

  it.each([...WEBSITE_PLATFORMS])(
    "still accepts the exact platform label %s",
    (label) => {
      expect(normalizeWebsitePlatform(label)).toBe(label);

      const result = validateWebsiteTicketBody({
        ...creatorSupportBody,
        platform: label,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      if (result.value.category !== "creator_support") return;
      expect(result.value.platform).toBe(label);
    },
  );

  it("returns null for an unknown platform", () => {
    expect(normalizeWebsitePlatform("TikTok")).toBeNull();
    expect(normalizeWebsitePlatform("")).toBeNull();
    expect(normalizeWebsitePlatform(null)).toBeNull();
  });
});

describe("website intake database mapping", () => {
  it("maps creator_support onto issue_type without fake campaign placeholders", () => {
    const validated = validateWebsiteTicketBody(creatorSupportBody);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const mapped = mapWebsiteFormToDbInsert(validated.value);
    expect("insert" in mapped).toBe(true);
    if (!("insert" in mapped)) return;
    expect(mapped.insert.source_channel).toBe("website");
    expect(mapped.insert.request_category).toBe("creator_support");
    expect(mapped.insert.issue_type).toBe("payment_delayed");
    expect(mapped.insert.campaign_month).toBe("2026-08-01");
    expect(mapped.insert).not.toHaveProperty("ticket_code");
  });

  it("maps general categories with null campaign/issue fields", () => {
    const validated = validateWebsiteTicketBody({
      category: "brand_support",
      name: "Alex Brand",
      email: "alex@brand.com",
      message: "Need help",
      company: "Acme",
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const mapped = mapWebsiteFormToDbInsert(validated.value);
    expect("insert" in mapped).toBe(true);
    if (!("insert" in mapped)) return;
    expect(mapped.insert.request_category).toBe("brand_support");
    expect(mapped.insert.issue_type).toBeNull();
    expect(mapped.insert.platform).toBeNull();
    expect(mapped.insert.campaign_name).toBeNull();
    expect(mapped.insert.brand_name).toBeNull();
    expect(mapped.insert.campaign_month).toBeNull();
    expect(mapped.insert.company_name).toBe("Acme");
    expect(JSON.stringify(mapped.insert)).not.toMatch(/Not applicable/i);
  });

  it("maps website source and category through the CRM ticket mapper", () => {
    const ticket = mapDbTicketToTicket(
      sampleTicket({
        issue_type: null,
        platform: null,
        brand_name: null,
        campaign_month: null,
        campaign_name: null,
        request_category: "brand_support",
        company_name: "Acme",
        social_handle: null,
      }),
    );
    expect(ticket.sourceChannel).toBe("Website");
    expect(ticket.requestCategory).toBe("Brand support");
    expect(ticket.issueType).toBe("Brand support");
    expect(ticket.platform).toBe("");
    expect(ticket.brand).toBe("");
  });

  it("uses friendly display labels for issue type and campaign month", () => {
    expect(mapIssueTypeFromDb("payment_delayed")).toBe("Payment Delayed");
    expect(formatCampaignMonthForDisplay("2026-08-01")).toBe("August 2026");
  });
});

describe("website intake CORS and public errors", () => {
  it("allows only configured origins and never uses *", () => {
    const env = {
      NODE_ENV: "production",
      WEBSITE_INTAKE_ALLOWED_ORIGINS:
        "https://cloutflow.com,https://www.cloutflow.com",
    } as NodeJS.ProcessEnv;

    expect(resolveAllowedOrigin("https://cloutflow.com", env)).toBe(
      "https://cloutflow.com",
    );
    expect(isOriginPermitted("https://evil.example", env)).toBe(false);
    const headers = buildCorsHeaders("https://cloutflow.com", env);
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "https://cloutflow.com",
      Vary: "Origin",
    });
    expect(JSON.stringify(headers)).not.toContain("*");
  });

  it("sanitizes successful responses to public fields only", () => {
    const publicResponse = toPublicWebsiteTicketResponse({
      success: true,
      ticketCode: "CF-2026-00042",
      acknowledgementSent: true,
      message: "Your request has been submitted. An acknowledgement email has been sent.",
    });
    expect(publicResponse).toEqual({
      success: true,
      ticketCode: "CF-2026-00042",
      acknowledgementSent: true,
      message: "Your request has been submitted. An acknowledgement email has been sent.",
    });
    expect(publicResponse).not.toHaveProperty("id");
    expect(publicResponse).not.toHaveProperty("stack");
  });
});

describe("website intake create + acknowledgement", () => {
  const input: ValidatedWebsiteTicketInput = {
    category: "creator_support",
    name: "Riya Sharma",
    phone: "+919876543210",
    email: "riya@example.com",
    socialHandle: "@riya",
    platform: "Instagram",
    issueType: "Payment Delayed / Not Received",
    campaignName: "Summer Launch",
    brandName: "Acme",
    campaignMonth: "August 2026",
    cloutflowPocName: "Priya Sharma",
    cloutflowPocContactNumber: "+919876543210",
    message: "Payment pending",
  };

  it("still returns a successful ticket result when acknowledgement email fails", async () => {
    const created = sampleTicket();
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: created, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    };

    const result = await createWebsiteTicketFromValidatedInput(input, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      sendAcknowledgement: async () => ({
        outcome: "failed",
        error: "SMTP exploded with credentials",
      }),
      sendInternalNotification: async () => ({ outcome: "sent" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.success).toBe(true);
    expect(result.response.ticketCode).toBe("CF-2026-00042");
    expect(result.response.acknowledgementSent).toBe(false);
    expect(JSON.stringify(result.response)).not.toMatch(/SMTP|credentials/i);
  });

  it("builds acknowledgement content with category and relevant details", () => {
    const brandTicket = sampleTicket({
      issue_type: null,
      platform: null,
      brand_name: null,
      campaign_month: null,
      campaign_name: null,
      social_handle: null,
      cloutflow_poc_name: null,
      cloutflow_poc_contact_number: null,
      request_category: "brand_support",
      company_name: "Acme Brands",
      issue_description: "Need account help",
    });

    const content = buildAcknowledgementEmailContent(brandTicket);
    expect(content.enquiryCategory).toBe("Brand support");
    expect(content.detailRows).toEqual([
      { label: "Company", value: "Acme Brands" },
    ]);

    const email = buildTicketAcknowledgementEmail(content);
    expect(email.html).toContain("Brand support");
    expect(email.html).toContain("Acme Brands");
    expect(email.html).toContain("CF-2026-00042");
    expect(email.text).toContain("Enquiry category: Brand support");
  });

  it("includes creator-support issue details in acknowledgement rows", () => {
    const rows = buildAcknowledgementDetailRows(sampleTicket());
    expect(rows.some((row) => row.label === "Issue type")).toBe(true);
    expect(rows.some((row) => row.label === "Campaign month")).toBe(true);
  });

  it("still attempts internal notification when acknowledgement fails", async () => {
    const created = sampleTicket();
    const updateEq = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: created, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: updateEq,
        })),
      })),
    };
    const sendInternalNotification = vi.fn(async () => ({ outcome: "sent" as const }));

    const result = await createWebsiteTicketFromValidatedInput(input, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      sendAcknowledgement: async () => ({
        outcome: "failed",
        error: "SMTP exploded with credentials",
      }),
      sendInternalNotification,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.acknowledgementSent).toBe(false);
    expect(sendInternalNotification).toHaveBeenCalledTimes(1);
    expect(sendInternalNotification).toHaveBeenCalledWith(created);
    expect(updateEq).not.toHaveBeenCalled();
    expect(JSON.stringify(result.response)).not.toMatch(/SMTP|credentials/i);
  });
});

describe("website intake internal support notification", () => {
  it("builds creator-support internal notification with readable labels", () => {
    const ticket = sampleTicket({ ticket_code: "CF-2026-00005" });
    const content = buildInternalNotificationEmailContent(ticket);
    const email = buildWebsiteInternalNotificationEmail(content);

    expect(content.enquiryCategory).toBe("Creator support");
    expect(email.subject).toBe(
      "New website enquiry [CF-2026-00005] — Creator Support — Riya Sharma",
    );
    expect(email.html).toContain("Creator support");
    expect(email.html).toContain("Payment Delayed");
    expect(email.html).toContain("Instagram");
    expect(email.html).toContain("August 2026");
    expect(email.html).toContain("Website");
    expect(email.html).toContain(formatDateTime(ticket.created_at));
    expect(email.html).toContain("Payment pending");
    expect(email.html).not.toContain("creator_support");
    expect(email.html).not.toContain("payment_delayed");
    expect(email.html).not.toContain("instagram");
    expect(email.text).toContain("Issue type: Payment Delayed");
    expect(email.text).toContain("Source channel: Website");

    const rows = buildInternalNotificationDetailRows(ticket);
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: "Email", value: "riya@example.com" },
        { label: "Phone", value: "+919876543210" },
        { label: "Social handle", value: "@riya" },
        { label: "Platform", value: "Instagram" },
        { label: "Issue type", value: "Payment Delayed" },
        { label: "Brand", value: "Acme" },
        { label: "Campaign name / ID", value: "Summer Launch" },
        { label: "Campaign month", value: "August 2026" },
        { label: "Cloutflow POC", value: "Priya Sharma" },
        { label: "Cloutflow POC contact", value: "+919876543210" },
        { label: "Source channel", value: "Website" },
        { label: "Created", value: formatDateTime(ticket.created_at) },
      ]),
    );
  });

  it("omits nullable campaign fields for general website categories", () => {
    const ticket = sampleTicket({
      issue_type: null,
      platform: null,
      brand_name: null,
      campaign_month: null,
      campaign_name: null,
      social_handle: null,
      creator_phone: null,
      cloutflow_poc_name: null,
      cloutflow_poc_contact_number: null,
      request_category: "brand_support",
      company_name: "Acme Brands",
      issue_description: "Need account help",
    });

    const content = buildInternalNotificationEmailContent(ticket);
    const email = buildWebsiteInternalNotificationEmail(content);
    const rowLabels = content.detailRows.map((row) => row.label);

    expect(content.enquiryCategory).toBe("Brand support");
    expect(rowLabels).toContain("Company");
    expect(rowLabels).toContain("Email");
    expect(rowLabels).toContain("Source channel");
    expect(rowLabels).toContain("Created");
    expect(rowLabels).not.toContain("Campaign name / ID");
    expect(rowLabels).not.toContain("Campaign month");
    expect(rowLabels).not.toContain("Platform");
    expect(rowLabels).not.toContain("Issue type");
    expect(rowLabels).not.toContain("Social handle");
    expect(rowLabels).not.toContain("Phone");
    expect(email.html).toContain("Acme Brands");
    expect(email.html).toContain("Need account help");
    expect(email.html).not.toContain("creator_support");
    expect(email.html).not.toContain("brand_support");
  });

  it("escapes HTML in the internal notification template", () => {
    const email = buildWebsiteInternalNotificationEmail({
      ticketCode: "CF-2026-00005",
      deskLabel: "Creator Support",
      requesterName: `Riya <img src=x onerror=alert(1)>`,
      enquiryCategory: `Creator <b>support</b>`,
      detailRows: [
        { label: "Email", value: `riya+"@example.com` },
        { label: "Brand", value: `Acme <script>alert(1)</script>` },
      ],
      enquiryMessage: `Please help <script>alert("x")</script> & more`,
    });

    expect(email.html).toContain("Riya &lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain("Creator &lt;b&gt;support&lt;/b&gt;");
    expect(email.html).toContain("Acme &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain(
      "Please help &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more",
    );
    expect(email.html).not.toContain("<script>alert");
    expect(email.html).not.toContain("<b>support</b>");
    expect(email.html).not.toContain("<img src=x");
  });

  it("sets Reply-To to the requester email for the support inbox", async () => {
    const ticket = sampleTicket({ creator_email: "riya@example.com" });
    const sendEmail = vi.fn(async () => ({
      messageId: "msg-1",
      accepted: ["help@cloutflow.com"],
      rejected: [],
      status: "accepted_by_brevo" as const,
    }));

    const result = await sendInternalSupportNotificationForTicket(ticket, {
      getSupportInboxEmail: () => "help@cloutflow.com",
      isEmailConfigured: () => true,
      sendEmail,
    });

    expect(result.outcome).toBe("sent");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "help@cloutflow.com",
        replyTo: "riya@example.com",
        subject:
          "New website enquiry [CF-2026-00042] — Creator Support — Riya Sharma",
      }),
    );
  });

  it("fails safely when SUPPORT_INBOX_EMAIL is missing without sending mail", async () => {
    const sendEmail = vi.fn();
    const result = await sendInternalSupportNotificationForTicket(sampleTicket(), {
      getSupportInboxEmail: () => undefined,
      isEmailConfigured: () => true,
      sendEmail,
    });

    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("Support inbox email is not configured.");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
