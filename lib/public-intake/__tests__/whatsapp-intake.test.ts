import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/whatsapp/tickets/route";
import { mapWebsiteFormToDbInsert } from "@/lib/public-intake/map";
import { validateWebsiteTicketBody } from "@/lib/public-intake/validate";
import { handleWhatsAppTicketPost } from "@/lib/public-intake/whatsapp-intake";
import type { DbTicket } from "@/lib/tickets/types";
import { NextRequest } from "next/server";

const TEST_API_KEY = "whatsapp-intake-test-key";

const creatorSupportBody = {
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
  message: "Payment for July deliverables is still pending.",
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
    source_channel: "whatsapp",
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

function authorizedEnv(): Record<string, string | undefined> {
  return { WHATSAPP_INTAKE_API_KEY: TEST_API_KEY };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const serialized =
    typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/whatsapp/tickets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: serialized,
  });
}

function stubSupabase(created: DbTicket, onInsert?: (row: unknown) => void) {
  return {
    from: vi.fn(() => ({
      insert: vi.fn((row: unknown) => {
        onInsert?.(row);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: created, error: null })),
          })),
        };
      }),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  };
}

describe("whatsapp intake mapping", () => {
  it("stamps source_channel whatsapp when requested", () => {
    const validated = validateWebsiteTicketBody(creatorSupportBody);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const mapped = mapWebsiteFormToDbInsert(validated.value, "whatsapp");
    expect("insert" in mapped).toBe(true);
    if (!("insert" in mapped)) return;
    expect(mapped.insert.source_channel).toBe("whatsapp");
  });

  it("defaults source_channel to website when omitted", () => {
    const validated = validateWebsiteTicketBody(creatorSupportBody);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const mapped = mapWebsiteFormToDbInsert(validated.value);
    expect("insert" in mapped).toBe(true);
    if (!("insert" in mapped)) return;
    expect(mapped.insert.source_channel).toBe("website");
  });
});

describe("whatsapp intake GET", () => {
  it("returns a lightweight availability check without secrets", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      service: "Cloutflow WhatsApp ticket intake",
      status: "available",
      method: "POST",
    });
    expect(JSON.stringify(body)).not.toMatch(/api.?key|secret|WHATSAPP_INTAKE/i);
  });
});

describe("whatsapp intake POST", () => {
  it("creates a creator_support ticket with source_channel whatsapp", async () => {
    let inserted: Record<string, unknown> | undefined;
    const created = sampleTicket();
    const supabase = stubSupabase(created, (row) => {
      inserted = row as Record<string, unknown>;
    });
    const response = await handleWhatsAppTicketPost(
      postRequest(creatorSupportBody, { "x-api-key": TEST_API_KEY }),
      {
        env: authorizedEnv(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        sendAcknowledgement: async () => ({ outcome: "sent" }),
        sendInternalNotification: async () => ({ outcome: "sent" }),
      },
    );

    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.ticketCode).toBe("CF-2026-00042");
    expect(body.acknowledgementSent).toBe(true);
    expect(inserted?.source_channel).toBe("whatsapp");
  });

  it("returns 401 when x-api-key is missing", async () => {
    const response = await handleWhatsAppTicketPost(
      postRequest(creatorSupportBody),
      { env: authorizedEnv() },
    );
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, message: "Unauthorized." });
  });

  it("returns 401 when x-api-key is wrong", async () => {
    const response = await handleWhatsAppTicketPost(
      postRequest(creatorSupportBody, { "x-api-key": "wrong-key" }),
      { env: authorizedEnv() },
    );
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, message: "Unauthorized." });
    expect(JSON.stringify(body)).not.toContain(TEST_API_KEY);
  });

  it("returns 503 when WHATSAPP_INTAKE_API_KEY is unset", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleWhatsAppTicketPost(
      postRequest(creatorSupportBody, { "x-api-key": TEST_API_KEY }),
      { env: {} },
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(body.message).not.toMatch(/unauthorized/i);
    expect(JSON.stringify(body)).not.toContain(TEST_API_KEY);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join(" ");
    expect(logged).not.toContain(TEST_API_KEY);
    errorSpy.mockRestore();
  });

  it("accepts a lean creator_support payload and stores null for optional fields", async () => {
    const leanBody = {
      category: "creator_support",
      name: "Riya Sharma",
      phone: "+919876543210",
      email: "riya@example.com",
      socialHandle: "@riya",
      issueType: "Payment Delayed / Not Received",
      message: "Payment for July deliverables is still pending.",
    };

    const validated = validateWebsiteTicketBody(leanBody, {
      lenientCreatorFields: true,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    if (validated.value.category !== "creator_support") return;
    expect(validated.value.platform).toBeNull();
    expect(validated.value.brandName).toBeNull();
    expect(validated.value.campaignName).toBeNull();
    expect(validated.value.campaignMonth).toBeNull();

    const mapped = mapWebsiteFormToDbInsert(validated.value, "whatsapp");
    expect("insert" in mapped).toBe(true);
    if (!("insert" in mapped)) return;
    expect(mapped.insert.platform).toBeNull();
    expect(mapped.insert.brand_name).toBeNull();
    expect(mapped.insert.campaign_name).toBeNull();
    expect(mapped.insert.campaign_month).toBeNull();
    expect(mapped.insert.source_channel).toBe("whatsapp");

    let inserted: Record<string, unknown> | undefined;
    const created = sampleTicket({
      platform: null,
      brand_name: null,
      campaign_name: null,
      campaign_month: null,
    });
    const supabase = stubSupabase(created, (row) => {
      inserted = row as Record<string, unknown>;
    });
    const response = await handleWhatsAppTicketPost(
      postRequest(leanBody, { "x-api-key": TEST_API_KEY }),
      {
        env: authorizedEnv(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        sendAcknowledgement: async () => ({ outcome: "sent" }),
        sendInternalNotification: async () => ({ outcome: "sent" }),
      },
    );

    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(inserted?.platform).toBeNull();
    expect(inserted?.brand_name).toBeNull();
    expect(inserted?.campaign_name).toBeNull();
    expect(inserted?.campaign_month).toBeNull();
    expect(inserted?.source_channel).toBe("whatsapp");
  });

  it("rejects the same lean payload on the website path without the flag", () => {
    const leanBody = {
      category: "creator_support",
      name: "Riya Sharma",
      phone: "+919876543210",
      email: "riya@example.com",
      socialHandle: "@riya",
      issueType: "Payment Delayed / Not Received",
      message: "Payment for July deliverables is still pending.",
    };

    const result = validateWebsiteTicketBody(leanBody);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Platform must be Instagram or YouTube.");
  });

  it("reuses shared validation for an invalid platform", async () => {
    const response = await handleWhatsAppTicketPost(
      postRequest(
        { ...creatorSupportBody, platform: "TikTok" },
        { "x-api-key": TEST_API_KEY },
      ),
      { env: authorizedEnv() },
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      message: "Platform must be Instagram or YouTube.",
    });
  });
});
