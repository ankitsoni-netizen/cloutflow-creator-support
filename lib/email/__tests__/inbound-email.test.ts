import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  BREVO_INBOUND_WEBHOOK_HEADER,
  BREVO_INBOUND_WEBHOOK_SECRET_ENV,
  verifyBrevoInboundWebhookAuth,
} from "@/lib/email/inbound-auth";
import { classifyInboundEmailNoise } from "@/lib/email/inbound-classify";
import {
  applyIngestBrevoInboundEmail,
  type InMemoryInboundState,
} from "@/lib/email/inbound-ingest-core";
import {
  handleBrevoInboundEmailPayload,
  planInboundEmailItem,
} from "@/lib/email/inbound-ingest";
import {
  decideInboundAttachments,
  parseInboundEmailItem,
} from "@/lib/email/inbound-parse";
import { sanitizeInboundEmailBody } from "@/lib/email/inbound-sanitize";
import {
  collectReplyAliasLocalParts,
  parseReplyAliasLocalPart,
} from "@/lib/email/reply-alias";
import { handleBrevoInboundEmailPost } from "@/lib/email/inbound-webhook";
import { sendAcknowledgementForTicket } from "@/lib/email/ticket-mail";
import * as envCheck from "@/lib/email/env-check";
import { buildTimeline } from "@/lib/tickets/timeline";
import { isInstagramTicket } from "@/lib/tickets/instagram-reply";
import { isWhatsAppTicket } from "@/lib/tickets/whatsapp-reply";
import { readFileSync } from "node:fs";
import type { DbTicket } from "@/lib/tickets/types";
import type { TicketComment } from "@/lib/tickets/workflow-types";

const ALIAS_A = "t-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ALIAS_B = "t-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "inbound-webhook-secret-test";

function ticketRow(
  overrides: Partial<InMemoryInboundState["tickets"][number]> = {},
): InMemoryInboundState["tickets"][number] {
  return {
    id: "ticket-a",
    creatorEmail: "riya@example.com",
    status: "open",
    sourceChannel: "website",
    externalContactId: null,
    externalConversationId: null,
    recipientAccountId: null,
    identityStatus: null,
    resolvedAt: null,
    ...overrides,
  };
}

function emptyState(
  overrides: Partial<InMemoryInboundState> = {},
): InMemoryInboundState {
  return {
    tickets: [ticketRow()],
    aliases: [{ ticketId: "ticket-a", localPart: ALIAS_A, revokedAt: null }],
    events: [],
    comments: [],
    eventsAudit: [],
    attachments: [],
    ...overrides,
  };
}

let seq = 0;
function nextId() {
  seq += 1;
  return `id-${seq}`;
}

function ingest(
  state: InMemoryInboundState,
  overrides: Partial<Parameters<typeof applyIngestBrevoInboundEmail>[1]> = {},
) {
  return applyIngestBrevoInboundEmail(
    state,
    {
      messageId: "mid-1",
      aliasLocalPart: ALIAS_A,
      senderNormalized: "riya@example.com",
      bodyText: "Need an update",
      ignoreReason: null,
      attachments: [],
      ...overrides,
    },
    nextId,
  );
}

function dbTicket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-a",
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
    issue_description: "Payment delayed",
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

function brevoItem(overrides: Record<string, unknown> = {}) {
  return {
    MessageId: "<mid-1@brevo>",
    From: { Address: "riya@example.com" },
    To: [{ Address: `${ALIAS_A}@reply.cloutflow.com` }],
    ExtractedMarkdownMessage: "Need an update",
    Headers: {},
    ...overrides,
  };
}

function leakHaystack(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function expectNoSensitiveLeak(
  value: unknown,
  extras: string[] = [],
) {
  const haystack = leakHaystack(value);
  for (const needle of [
    "riya@example.com",
    "alice@example.com",
    ALIAS_A,
    SECRET,
    "download-token",
    "need an update",
    "<script>",
    ...extras,
  ]) {
    expect(haystack).not.toContain(needle.toLowerCase());
  }
}

describe("opaque reply aliases", () => {
  it("parses only t-<32-hex>@reply.cloutflow.com", () => {
    expect(parseReplyAliasLocalPart(`${ALIAS_A}@reply.cloutflow.com`)).toBe(ALIAS_A);
    expect(parseReplyAliasLocalPart("CF-2026-00001@reply.cloutflow.com")).toBeNull();
    expect(parseReplyAliasLocalPart(`${ALIAS_A}@gmail.com`)).toBeNull();
    expect(parseReplyAliasLocalPart("riya@example.com")).toBeNull();
  });

  it("does not treat a guessed ticket code as an alias", () => {
    expect(
      collectReplyAliasLocalParts(["CF-2026-00001@reply.cloutflow.com"]),
    ).toEqual([]);
    const planned = planInboundEmailItem({
      MessageId: "mid-guess",
      From: { Address: "riya@example.com" },
      To: [{ Address: "CF-2026-00001@reply.cloutflow.com" }],
      Subject: "Re: CF-2026-00001",
      ExtractedMarkdownMessage: "Hello",
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) expect(planned.aliasLocalPart).toBeNull();
  });
});

describe("inbound classify and sanitize", () => {
  it("ignores bounces, auto-replies, delivery status, and self-sent mail", () => {
    expect(
      classifyInboundEmailNoise({
        fromAddress: "mailer-daemon@example.com",
        selfSentAddresses: [],
      }),
    ).toBe("bounce");
    expect(
      classifyInboundEmailNoise({
        fromAddress: "riya@example.com",
        headers: { "Auto-Submitted": "auto-replied" },
        selfSentAddresses: [],
      }),
    ).toBe("auto_reply");
    expect(
      classifyInboundEmailNoise({
        fromAddress: "riya@example.com",
        headers: { "Content-Type": "multipart/report; report-type=delivery-status" },
        selfSentAddresses: [],
      }),
    ).toBe("delivery_status");
    expect(
      classifyInboundEmailNoise({
        fromAddress: "noreply@cloutflow.com",
        selfSentAddresses: ["noreply@cloutflow.com", "help@cloutflow.com"],
      }),
    ).toBe("self_sent");
    expect(
      classifyInboundEmailNoise({
        fromAddress: `${ALIAS_A}@reply.cloutflow.com`,
        selfSentAddresses: [],
      }),
    ).toBe("self_sent");
  });

  it("strips HTML and script content", () => {
    expect(
      sanitizeInboundEmailBody(
        null,
        `<p>Hello</p><script>alert('x')</script><img src=x onerror=alert(1)>`,
      ),
    ).toBe("Hello");
    expect(
      sanitizeInboundEmailBody("See ![x](https://evil.test/a.png) and [ok](https://ok.test)"),
    ).toBe("See and ok");
  });

  it("accepts supported attachments and rejects unsupported types and names", () => {
    const decisions = decideInboundAttachments([
      {
        name: "invoice.pdf",
        contentType: "application/pdf",
        contentLength: 1200,
      },
      {
        name: "payload.exe",
        contentType: "application/x-msdownload",
        contentLength: 12,
      },
      {
        name: "secret.png\n.exe",
        contentType: "image/png",
        contentLength: 12,
      },
    ]);
    expect(decisions.map((row) => row.status)).toEqual([
      "accepted_metadata",
      "rejected_type",
      "rejected_name",
    ]);
    expect(JSON.stringify(decisions)).not.toContain("downloadToken");
  });
});

describe("inbound ingest mapping", () => {
  it("appends to an email-origin ticket without changing the channel", () => {
    const state = emptyState({
      tickets: [ticketRow({ sourceChannel: "email" })],
    });
    const snapshot = { ...state.tickets[0] };
    expect(ingest(state).outcome).toBe("appended");
    expect(state.tickets[0]).toMatchObject({
      sourceChannel: snapshot.sourceChannel,
      externalContactId: snapshot.externalContactId,
      externalConversationId: snapshot.externalConversationId,
      recipientAccountId: snapshot.recipientAccountId,
      identityStatus: snapshot.identityStatus,
      status: "open",
    });
    expect(state.comments).toHaveLength(1);
    expect(state.tickets).toHaveLength(1);
  });

  it("records Instagram-origin email replies in CRM without changing Instagram identity", () => {
    const state = emptyState({
      tickets: [
        ticketRow({
          sourceChannel: "instagram",
          externalContactId: "12334",
          externalConversationId: "178414:12334",
          recipientAccountId: "178414",
          identityStatus: "unambiguous",
        }),
      ],
    });
    expect(ingest(state).outcome).toBe("appended");
    expect(state.tickets[0]?.sourceChannel).toBe("instagram");
    expect(state.tickets[0]?.externalContactId).toBe("12334");
    expect(isInstagramTicket(dbTicket({ source_channel: state.tickets[0]?.sourceChannel }))).toBe(
      true,
    );
    expect(isWhatsAppTicket(dbTicket({ source_channel: state.tickets[0]?.sourceChannel }))).toBe(
      false,
    );
  });

  it("records WATI-origin email replies in CRM without changing WhatsApp identity", () => {
    const state = emptyState({
      tickets: [
        ticketRow({
          sourceChannel: "whatsapp",
          externalContactId: "16315551181",
          externalConversationId: "123456:16315551181",
          recipientAccountId: "123456",
          identityStatus: "unambiguous",
        }),
      ],
    });
    expect(ingest(state).outcome).toBe("appended");
    expect(state.tickets[0]?.sourceChannel).toBe("whatsapp");
    expect(isWhatsAppTicket(dbTicket({ source_channel: "whatsapp" }))).toBe(true);
    expect(isInstagramTicket(dbTicket({ source_channel: "whatsapp" }))).toBe(false);
  });

  it("cannot cross-correlate two tickets for the same creator", () => {
    const state = emptyState({
      tickets: [
        ticketRow({ id: "ticket-a" }),
        ticketRow({ id: "ticket-b", sourceChannel: "instagram" }),
      ],
      aliases: [
        { ticketId: "ticket-a", localPart: ALIAS_A, revokedAt: null },
        { ticketId: "ticket-b", localPart: ALIAS_B, revokedAt: null },
      ],
    });
    expect(ingest(state, { aliasLocalPart: ALIAS_B, messageId: "mid-b" }).outcome).toBe(
      "appended",
    );
    expect(state.comments[0]?.ticketId).toBe("ticket-b");
    expect(state.comments.some((row) => row.ticketId === "ticket-a")).toBe(false);
  });

  it("cannot cross-correlate similar creator emails", () => {
    const state = emptyState({
      tickets: [ticketRow({ creatorEmail: "riya@example.com" })],
    });
    expect(
      ingest(state, {
        messageId: "mid-plus",
        senderNormalized: "riya+tag@example.com",
      }).outcome,
    ).toBe("rejected");
    expect(
      ingest(state, {
        messageId: "mid-dot",
        senderNormalized: "riya@example.com.evil",
      }).errorCode,
    ).toBe("sender_mismatch");
    expect(state.comments).toHaveLength(0);
  });

  it("fails closed for sender mismatch and forwarded From addresses", () => {
    const state = emptyState();
    expect(ingest(state, { senderNormalized: "forwarder@agency.test" }).errorCode).toBe(
      "sender_mismatch",
    );
    expect(state.comments).toHaveLength(0);
    expect(state.eventsAudit).toHaveLength(0);
  });

  it("ignores duplicate MessageId and does not append a second comment", () => {
    const state = emptyState();
    expect(ingest(state).outcome).toBe("appended");
    expect(ingest(state).outcome).toBe("duplicate");
    expect(state.comments).toHaveLength(1);
  });

  it("keeps an active ticket active and reopens a resolved ticket once", () => {
    const active = emptyState();
    ingest(active);
    expect(active.tickets[0]?.status).toBe("open");
    expect(active.eventsAudit).toHaveLength(0);

    const resolved = emptyState({
      tickets: [ticketRow({ status: "resolved", resolvedAt: "2026-09-01T00:00:00Z" })],
    });
    expect(ingest(resolved, { messageId: "mid-reopen-1" }).reopened).toBe(true);
    expect(resolved.tickets[0]?.status).toBe("open");
    expect(ingest(resolved, { messageId: "mid-reopen-2" }).reopened).toBe(false);
    expect(resolved.eventsAudit.filter((row) => row.eventType === "status_changed")).toHaveLength(
      1,
    );
    expect(resolved.tickets).toHaveLength(1);
  });

  it("never creates another ticket from an inbound reply", () => {
    const state = emptyState();
    ingest(state);
    ingest(state, { messageId: "mid-2" });
    expect(state.tickets).toHaveLength(1);
  });
});

describe("inbound webhook HTTP behaviour", () => {
  it("rejects missing and invalid secrets before payload handling", async () => {
    const handlePayload = vi.fn();
    const missing = await handleBrevoInboundEmailPost(
      new NextRequest("http://localhost/api/webhooks/brevo/inbound-email", {
        method: "POST",
        body: JSON.stringify({ items: [brevoItem()] }),
      }),
      {
        env: { [BREVO_INBOUND_WEBHOOK_SECRET_ENV]: SECRET },
        handlePayload,
      },
    );
    expect(missing.status).toBe(401);
    expect(handlePayload).not.toHaveBeenCalled();

    const invalid = await handleBrevoInboundEmailPost(
      new NextRequest("http://localhost/api/webhooks/brevo/inbound-email", {
        method: "POST",
        headers: { [BREVO_INBOUND_WEBHOOK_HEADER]: "wrong" },
        body: JSON.stringify({ items: [brevoItem()] }),
      }),
      {
        env: { [BREVO_INBOUND_WEBHOOK_SECRET_ENV]: SECRET },
        handlePayload,
      },
    );
    expect(invalid.status).toBe(401);
    expect(handlePayload).not.toHaveBeenCalled();
    expectNoSensitiveLeak(await invalid.json());

    const unparsed = await handleBrevoInboundEmailPost(
      new NextRequest("http://localhost/api/webhooks/brevo/inbound-email", {
        method: "POST",
        body: "{not-json",
      }),
      {
        env: { [BREVO_INBOUND_WEBHOOK_SECRET_ENV]: SECRET },
        handlePayload,
      },
    );
    expect(unparsed.status).toBe(401);
    expect(handlePayload).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON after authentication", async () => {
    const response = await handleBrevoInboundEmailPost(
      new NextRequest("http://localhost/api/webhooks/brevo/inbound-email", {
        method: "POST",
        headers: { [BREVO_INBOUND_WEBHOOK_HEADER]: SECRET },
        body: "{not-json",
      }),
      { env: { [BREVO_INBOUND_WEBHOOK_SECRET_ENV]: SECRET } },
    );
    expect(response.status).toBe(400);
  });

  it("returns 200 for processed, duplicate, and terminal rejection", async () => {
    const ingestFn = vi
      .fn()
      .mockResolvedValueOnce({
        outcome: "appended",
        errorCode: null,
        reopened: false,
        commentId: "c1",
      })
      .mockResolvedValueOnce({
        outcome: "duplicate",
        errorCode: null,
        reopened: false,
        commentId: "c1",
      })
      .mockResolvedValueOnce({
        outcome: "rejected",
        errorCode: "sender_mismatch",
        reopened: false,
        commentId: null,
      });

    const processed = await handleBrevoInboundEmailPayload(
      { items: [brevoItem()] },
      { BREVO_FROM_EMAIL: "noreply@cloutflow.com" },
      ingestFn,
    );
    expect(processed.status).toBe(200);
    expect(processed.body.outcome).toBe("appended");

    const duplicate = await handleBrevoInboundEmailPayload(
      { items: [brevoItem({ MessageId: "mid-dup" })] },
      {},
      ingestFn,
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.outcome).toBe("duplicate");

    const rejected = await handleBrevoInboundEmailPayload(
      { items: [brevoItem({ MessageId: "mid-rej" })] },
      {},
      ingestFn,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.outcome).toBe("rejected");
    expectNoSensitiveLeak(rejected.body);
  });

  it("returns 200 and does not ingest bounce or auto-reply noise", async () => {
    const ingestFn = vi.fn(async (input) => ({
      outcome: "ignored" as const,
      errorCode: input.ignoreReason,
      reopened: false,
      commentId: null,
    }));
    const bounce = await handleBrevoInboundEmailPayload(
      {
        items: [
          brevoItem({
            From: { Address: "mailer-daemon@example.net" },
            Headers: { "Auto-Submitted": "auto-replied" },
          }),
        ],
      },
      {},
      ingestFn,
    );
    expect(bounce.status).toBe(200);
    expect(ingestFn.mock.calls[0]?.[0].ignoreReason).toBeTruthy();
  });

  it("returns 500 so Brevo can retry a database failure", async () => {
    const ingestFn = vi.fn(async () => {
      throw new Error("inbound_email_persist_failed");
    });
    const result = await handleBrevoInboundEmailPayload(
      { items: [brevoItem()] },
      {},
      ingestFn,
    );
    expect(result.status).toBe(500);
    expect(result.body.errorCode).toBe("persist_failed");
    expectNoSensitiveLeak(result.body, ["inbound_email_persist_failed"]);
  });

  it("does not leak PII from parsed inbound items into HTTP bodies", async () => {
    const ingestFn = vi.fn(async () => ({
      outcome: "rejected" as const,
      errorCode: "sender_mismatch",
      reopened: false,
      commentId: null,
    }));
    const result = await handleBrevoInboundEmailPayload(
      {
        items: [
          brevoItem({
            From: { Address: "alice@example.com" },
            ExtractedMarkdownMessage: "Need an update with secret token",
            Attachments: [
              { Name: "a.pdf", DownloadToken: "download-token-secret" },
            ],
          }),
        ],
      },
      {},
      ingestFn,
    );
    expectNoSensitiveLeak(result.body, [
      "alice@example.com",
      "secret token",
      "download-token-secret",
    ]);
  });
});

describe("creator-facing Reply-To and timeline", () => {
  it("sets the opaque alias as Reply-To on acknowledgement mail", async () => {
    vi.spyOn(envCheck, "isBrevoConfigured").mockReturnValue(true);
    const sendEmail = vi.fn(async () => ({
      messageId: "smtp-1",
      accepted: ["riya@example.com"],
      rejected: [],
      status: "accepted_by_brevo" as const,
    }));
    const result = await sendAcknowledgementForTicket(dbTicket(), {
      sendEmail,
      ensureReplyTo: async () => `${ALIAS_A}@reply.cloutflow.com`,
    });
    expect(result.outcome).toBe("sent");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: `${ALIAS_A}@reply.cloutflow.com`,
      }),
    );
    vi.restoreAllMocks();
  });

  it("labels verified inbound comments as inbound email, not retryable outbound", () => {
    const comment: TicketComment = {
      id: "c1",
      ticketId: "ticket-a",
      authorUserId: null,
      authorName: "Creator",
      visibility: "creator",
      commentText: "Need an update",
      sendToCreator: false,
      deliveryStatus: null,
      createdAt: new Date().toISOString(),
    };
    const items = buildTimeline([], [comment]);
    expect(items[0]?.title).toBe("Inbound email from creator");
    expect(items[0]?.visibilityLabel).toBe("Inbound Email");
    expect(items[0]?.canRetryEmail).toBe(false);
  });
});

describe("staff reply channel is unchanged by inbound email", () => {
  it("keeps website and email tickets on email, Instagram on Instagram, WATI on WATI", () => {
    expect(isInstagramTicket(dbTicket({ source_channel: "website" }))).toBe(false);
    expect(isWhatsAppTicket(dbTicket({ source_channel: "email" }))).toBe(false);
    expect(isInstagramTicket(dbTicket({ source_channel: "instagram" }))).toBe(true);
    expect(isWhatsAppTicket(dbTicket({ source_channel: "whatsapp" }))).toBe(true);

    const workflow = readFileSync(
      new URL("../../../lib/tickets/workflow-actions.ts", import.meta.url),
      "utf8",
    );
    const start = workflow.indexOf("export async function queueCreatorReplyAction");
    const composer = workflow.slice(start);
    expect(composer.indexOf("isInstagramTicket(ticket)")).toBeGreaterThan(-1);
    expect(composer.indexOf("isWhatsAppTicket(ticket)")).toBeGreaterThan(
      composer.indexOf("isInstagramTicket(ticket)"),
    );
    expect(composer.indexOf("sendCreatorReplyEmail")).toBeGreaterThan(
      composer.indexOf("isWhatsAppTicket(ticket)"),
    );
    expect(composer).toContain("sendStaffInstagramReply");
    expect(composer).toContain("sendStaffWhatsAppReply");
  });

  it("does not echo inbound email to Instagram or WATI from ingest", () => {
    const ingestSource = readFileSync(
      new URL("../inbound-ingest.ts", import.meta.url),
      "utf8",
    );
    expect(ingestSource).not.toContain("sendStaffInstagramReply");
    expect(ingestSource).not.toContain("sendStaffWhatsAppReply");
    expect(ingestSource).not.toContain("sendTransactionalEmail");
  });
});

describe("webhook auth helper", () => {
  it("uses constant-time compare and rejects missing configuration", () => {
    expect(
      verifyBrevoInboundWebhookAuth(
        { [BREVO_INBOUND_WEBHOOK_HEADER]: SECRET },
        { [BREVO_INBOUND_WEBHOOK_SECRET_ENV]: SECRET },
      ),
    ).toBe(true);
    expect(
      verifyBrevoInboundWebhookAuth(
        { [BREVO_INBOUND_WEBHOOK_HEADER]: SECRET },
        {},
      ),
    ).toBe(false);
  });
});

describe("parseInboundEmailItem", () => {
  it("collects the alias from To/Cc and prefers extracted reply markdown", () => {
    const parsed = parseInboundEmailItem({
      MessageId: "mid-parse",
      From: { Address: "riya@example.com" },
      To: [{ Address: `${ALIAS_A}@reply.cloutflow.com` }],
      Subject: "Re: CF-2026-00001 Payment",
      ExtractedMarkdownMessage: "Short reply",
      RawHtmlBody: "<p>Quoted history</p>",
    });
    expect(parsed?.aliasLocalParts).toEqual([ALIAS_A]);
    expect(parsed?.markdown).toBe("Short reply");
    expect(parsed?.subject).toBe("Re: CF-2026-00001 Payment");
  });

  it("parses Recipients and display-name mailboxes without using From.Name or ReplyTo", () => {
    const parsed = parseInboundEmailItem({
      MessageId: "mid-mailbox",
      From: {
        Name: `${ALIAS_B}@reply.cloutflow.com`,
        Address: "riya@example.com",
      },
      To: [{ Name: "Support", Address: "inbox@cloutflow.com" }],
      Recipients: [`Alias Desk <${ALIAS_A}@REPLY.CLOUTFLOW.COM>`],
      ReplyTo: { Address: "forwarder@agency.test" },
      Subject: `${ALIAS_B}@reply.cloutflow.com CF-2026-00001`,
      ExtractedMarkdownMessage: `Reply to ${ALIAS_B}@reply.cloutflow.com`,
    });
    expect(parsed?.fromAddress).toBe("riya@example.com");
    expect(parsed?.aliasLocalParts).toEqual([ALIAS_A]);
  });

  it("fails closed when two Cloutflow aliases appear on To/Cc", () => {
    const planned = planInboundEmailItem({
      MessageId: "mid-multi-alias",
      From: { Address: "riya@example.com" },
      To: [{ Address: `${ALIAS_A}@reply.cloutflow.com` }],
      Cc: [{ Address: `${ALIAS_B}@reply.cloutflow.com` }],
      ExtractedMarkdownMessage: "Hello",
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) expect(planned.aliasLocalPart).toBeNull();
  });

  it("rejects plus-tags and ticket codes as alias local parts", () => {
    expect(
      parseReplyAliasLocalPart(`${ALIAS_A}+tag@reply.cloutflow.com`),
    ).toBeNull();
    expect(parseReplyAliasLocalPart(`t-${ALIAS_A.slice(2)}@reply.cloutflow.com`)).toBe(
      ALIAS_A,
    );
  });
});

describe("inbound batches and non-inbound events", () => {
  it("processes every items[] entry independently and keeps valid items when another is malformed", async () => {
    const ingestFn = vi.fn(async (input) => ({
      outcome: "appended" as const,
      errorCode: null,
      reopened: false,
      commentId: input.messageId,
    }));
    const result = await handleBrevoInboundEmailPayload(
      {
        items: [
          { Subject: "no message id" },
          brevoItem({ MessageId: "mid-keep" }),
          null,
        ],
      },
      {},
      ingestFn,
    );
    expect(result.status).toBe(200);
    expect(ingestFn).toHaveBeenCalledTimes(1);
    expect(ingestFn.mock.calls[0]?.[0].messageId).toBe("mid-keep");
  });

  it("returns 500 after a later persist failure so Brevo retries, after persisting earlier items", async () => {
    const ingestFn = vi
      .fn()
      .mockResolvedValueOnce({
        outcome: "appended",
        errorCode: null,
        reopened: false,
        commentId: "c1",
      })
      .mockRejectedValueOnce(new Error("inbound_email_persist_failed"));
    const result = await handleBrevoInboundEmailPayload(
      {
        items: [
          brevoItem({ MessageId: "mid-ok" }),
          brevoItem({ MessageId: "mid-fail" }),
        ],
      },
      {},
      ingestFn,
    );
    expect(ingestFn).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(500);
  });

  it("ignores transactional delivery webhooks that are not inboundEmailProcessed", async () => {
    const ingestFn = vi.fn();
    const result = await handleBrevoInboundEmailPayload(
      { event: "delivered", "message-id": "<smtp@brevo>" },
      {},
      ingestFn,
    );
    expect(result.status).toBe(200);
    expect(result.body.errorCode).toBe("not_inbound_email");
    expect(ingestFn).not.toHaveBeenCalled();
  });

  it("ignores empty creator replies", async () => {
    const ingestFn = vi.fn(async (input) => ({
      outcome: "ignored" as const,
      errorCode: input.ignoreReason,
      reopened: false,
      commentId: null,
    }));
    const result = await handleBrevoInboundEmailPayload(
      {
        items: [
          brevoItem({
            ExtractedMarkdownMessage: "   ",
            RawTextBody: "",
            RawHtmlBody: "<html></html>",
          }),
        ],
      },
      {},
      ingestFn,
    );
    expect(result.status).toBe(200);
    expect(ingestFn.mock.calls[0]?.[0].ignoreReason).toBe("empty_reply");
  });

  it("does not put attachment download tokens or fake file links in the planned body", () => {
    const planned = planInboundEmailItem(
      brevoItem({
        ExtractedMarkdownMessage: "See attached",
        Attachments: [
          {
            Name: "invoice.pdf",
            ContentType: "application/pdf",
            ContentLength: 12,
            DownloadToken: "download-token-secret",
          },
        ],
      }),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.bodyText).toBe("See attached");
    expect(JSON.stringify(planned.attachments)).not.toContain("download-token");
    expect(planned.attachments[0]?.status).toBe("accepted_metadata");
  });
});
