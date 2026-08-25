import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, runtime } from "@/app/api/tickets/[ticketId]/whatsapp-reply/route";
import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { loadTicketById } from "@/lib/tickets/email-delivery";
import { sendStaffWhatsAppReply } from "@/lib/tickets/whatsapp-reply";
import { resetStaffActionRateLimitForTests } from "@/lib/tickets/staff-rate-limit";
import type { DbTicket } from "@/lib/tickets/types";

vi.mock("@/lib/tickets/auth-action", () => ({
  getActiveStaffContext: vi.fn(),
}));

vi.mock("@/lib/tickets/email-delivery", () => ({
  loadTicketById: vi.fn(),
}));

vi.mock("@/lib/tickets/whatsapp-reply", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tickets/whatsapp-reply")>(
    "@/lib/tickets/whatsapp-reply",
  );
  return {
    ...actual,
    sendStaffWhatsAppReply: vi.fn(),
  };
});

const staff = {
  ok: true as const,
  user: { id: "staff-1" },
  profile: { user_id: "staff-1", full_name: "Asha", role: "agent", team: "Creator Support", is_active: true },
  supabase: {},
};

function whatsappTicket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-wa",
    ticket_code: "CF-2026-00009",
    creator_name: "Riya Sharma",
    creator_phone: "+16315551181",
    creator_email: "riya@example.com",
    social_handle: "riya",
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
    external_contact_id: "16315551181",
    external_conversation_id: "123456123:16315551181",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function postRequest(ticketId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/tickets/${ticketId}/whatsapp-reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tickets/[ticketId]/whatsapp-reply", () => {
  beforeEach(() => {
    resetStaffActionRateLimitForTests();
    vi.mocked(getActiveStaffContext).mockResolvedValue(staff as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports the nodejs runtime handler", () => {
    expect(runtime).toBe("nodejs");
    expect(typeof POST).toBe("function");
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(getActiveStaffContext).mockResolvedValue({
      ok: false,
      error: "Your session expired. Please sign in again.",
    });
    const response = await POST(postRequest("ticket-wa", { commentId: "c1", commentText: "Hi" }), {
      params: Promise.resolve({ ticketId: "ticket-wa" }),
    });
    expect(response.status).toBe(401);
    expect(sendStaffWhatsAppReply).not.toHaveBeenCalled();
  });

  it("sends an authenticated WhatsApp ticket reply through Cloud API", async () => {
    vi.mocked(loadTicketById).mockResolvedValue({ data: whatsappTicket() });
    vi.mocked(sendStaffWhatsAppReply).mockResolvedValue({
      ok: true,
      whatsapp: "sent",
      email: "sent",
    });
    const response = await POST(
      postRequest("ticket-wa", { commentId: "comment-1", commentText: "We are looking into this." }),
      { params: Promise.resolve({ ticketId: "ticket-wa" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      whatsapp: "sent",
      email: "sent",
      alreadySent: false,
    });
    expect(sendStaffWhatsAppReply).toHaveBeenCalledWith({
      ticket: expect.objectContaining({
        source_channel: "whatsapp",
        external_contact_id: "16315551181",
      }),
      commentId: "comment-1",
      commentText: "We are looking into this.",
    });
  });

  it("does not send when the ticket is not a WhatsApp ticket", async () => {
    vi.mocked(loadTicketById).mockResolvedValue({
      data: whatsappTicket({ source_channel: "instagram" }),
    });
    const response = await POST(
      postRequest("ticket-ig", { commentId: "c1", commentText: "Hello" }),
      { params: Promise.resolve({ ticketId: "ticket-ig" }) },
    );
    expect(response.status).toBe(400);
    expect(sendStaffWhatsAppReply).not.toHaveBeenCalled();
  });
});
