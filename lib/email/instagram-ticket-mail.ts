import "server-only";

import { isBrevoConfigured } from "@/lib/email/env-check";
import {
  isValidEmailAddress,
  sanitizeEmailHeaderValue,
} from "@/lib/email/html";
import { sendTransactionalEmail } from "@/lib/email/send";
import { ensureTicketReplyToAddress } from "@/lib/email/ensure-reply-alias";
import { buildTicketAcknowledgementEmail } from "@/lib/email/templates/ticket-acknowledgement";
import { buildTicketReplyEmail } from "@/lib/email/templates/ticket-reply";
import {
  buildInstagramTicketAcknowledgementContent,
  formatTicketEmailLabels,
  safeEmailErrorMessage,
} from "@/lib/email/ticket-mail";
import { escapeHtml } from "@/lib/email/html";
import { renderEmailLayout } from "@/lib/email/templates/layout";
import type { SendTransactionalEmailResult } from "@/lib/email/types";
import type { DbTicket } from "@/lib/tickets/types";

export const INSTAGRAM_TICKET_EMAIL_SUBJECT_SUFFIX =
  "Cloutflow Creator Support";

export function instagramTicketEmailSubject(ticketCode: string): string {
  const code = sanitizeEmailHeaderValue(ticketCode.trim() || "TICKET");
  return `[${code}] ${INSTAGRAM_TICKET_EMAIL_SUBJECT_SUFFIX}`;
}

function readSupportInboxEmail(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.SUPPORT_INBOX_EMAIL;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function getSupportInboxEmail(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const inbox = readSupportInboxEmail(env)?.trim() ?? "";
  if (!inbox || !isValidEmailAddress(inbox)) return null;
  return inbox;
}

export type InstagramMailResult =
  | { outcome: "sent"; messageId: string | null }
  | { outcome: "skipped"; errorCode: string }
  | { outcome: "failed"; errorCode: string };

function toMailResult(
  sent: SendTransactionalEmailResult,
): InstagramMailResult {
  return { outcome: "sent", messageId: sent.messageId };
}

function helpBcc(): string[] {
  const inbox = getSupportInboxEmail();
  return inbox ? [inbox] : [];
}

export async function sendInstagramTicketConfirmationEmail(input: {
  ticket: DbTicket;
  transcriptText: string;
}): Promise<InstagramMailResult> {
  const recipient = input.ticket.creator_email?.trim() ?? "";
  if (!isValidEmailAddress(recipient)) {
    return { outcome: "skipped", errorCode: "creator_email_invalid" };
  }
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }

  try {
    const content = buildTicketAcknowledgementEmail(
      buildInstagramTicketAcknowledgementContent(input.ticket),
    );
    const replyTo = await ensureTicketReplyToAddress(input.ticket.id);
    const sent = await sendTransactionalEmail({
      toEmail: recipient,
      toName: sanitizeEmailHeaderValue(input.ticket.creator_name ?? ""),
      replyTo: replyTo ?? undefined,
      subject: sanitizeEmailHeaderValue(content.subject),
      html: content.html,
      text: content.text,
      bccEmails: helpBcc(),
      metadata: {
        purpose:
          input.ticket.source_channel?.trim().toLowerCase() === "whatsapp"
            ? "whatsapp-ticket-confirmation"
            : "instagram-ticket-confirmation",
        "ticket-code": input.ticket.ticket_code,
      },
    });
    return toMailResult(sent);
  } catch (error) {
    void error;
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}

export async function sendInstagramIntakeInternalEmail(input: {
  ticket: DbTicket;
  transcriptText: string;
}): Promise<InstagramMailResult> {
  const inbox = getSupportInboxEmail();
  if (!inbox) return { outcome: "skipped", errorCode: "support_inbox_missing" };
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }

  const ticketCode = input.ticket.ticket_code;
  const labels = formatTicketEmailLabels(input.ticket);
  const transcript = input.transcriptText.trim() || "—";
  const rows = [
    `Ticket: ${ticketCode}`,
    `Name: ${input.ticket.creator_name ?? "—"}`,
    `Email: ${input.ticket.creator_email ?? "—"}`,
    `Phone: ${input.ticket.creator_phone ?? "—"}`,
    `Handle: ${input.ticket.social_handle ?? "—"}`,
    `Issue type: ${labels.issueType || "—"}`,
    `Campaign: ${input.ticket.campaign_name ?? "—"}`,
    `Brand: ${input.ticket.brand_name ?? "—"}`,
    `Campaign month: ${labels.campaignMonth || "—"}`,
    `POC: ${input.ticket.cloutflow_poc_name ?? "—"}`,
    `POC contact: ${input.ticket.cloutflow_poc_contact_number ?? "—"}`,
    "",
    "Intake transcript:",
    transcript,
  ].join("\n");

  const html = renderEmailLayout({
    preheader: `Instagram Creator Support ${ticketCode}`,
    title: "Instagram Creator Support intake",
    bodyHtml: `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0;">${escapeHtml(rows)}</pre>`,
  });

  try {
    const sent = await sendTransactionalEmail({
      toEmail: inbox,
      toName: "Cloutflow Support",
      subject: instagramTicketEmailSubject(ticketCode),
      html,
      text: rows,
      metadata: {
        purpose: "instagram-intake-internal",
        "ticket-code": ticketCode,
      },
    });
    return toMailResult(sent);
  } catch (error) {
    void safeEmailErrorMessage(error);
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}

export async function sendInstagramCreatorReplyEmail(input: {
  ticket: DbTicket;
  commentText: string;
}): Promise<InstagramMailResult> {
  const recipient = input.ticket.creator_email?.trim() ?? "";
  if (!isValidEmailAddress(recipient)) {
    return { outcome: "skipped", errorCode: "creator_email_invalid" };
  }
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }
  const reply = input.commentText.trim();
  if (!reply) return { outcome: "skipped", errorCode: "empty_reply" };

  try {
    const labels = formatTicketEmailLabels(input.ticket);
    const content = buildTicketReplyEmail({
      creatorName: input.ticket.creator_name ?? "",
      ticketCode: input.ticket.ticket_code,
      staffReply: reply,
      ticketStatus: labels.ticketStatus,
      brand: input.ticket.brand_name ?? "",
      campaignName: input.ticket.campaign_name ?? "",
      campaignMonth: labels.campaignMonth,
    });
    const replyTo = await ensureTicketReplyToAddress(input.ticket.id);
    const sent = await sendTransactionalEmail({
      toEmail: recipient,
      toName: sanitizeEmailHeaderValue(input.ticket.creator_name ?? ""),
      replyTo: replyTo ?? undefined,
      subject: instagramTicketEmailSubject(input.ticket.ticket_code),
      html: content.html,
      text: content.text,
      bccEmails: helpBcc(),
      metadata: {
        purpose:
          input.ticket.source_channel?.trim().toLowerCase() === "whatsapp"
            ? "whatsapp-ticket-reply"
            : "instagram-ticket-reply",
        "ticket-code": input.ticket.ticket_code,
      },
    });
    return toMailResult(sent);
  } catch {
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}

export async function sendInstagramInboundHelpNotification(input: {
  ticket: DbTicket;
  messagePreview: string;
  channelLabel?: "Instagram" | "WhatsApp";
}): Promise<InstagramMailResult> {
  const inbox = getSupportInboxEmail();
  if (!inbox) return { outcome: "skipped", errorCode: "support_inbox_missing" };
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }

  const ticketCode = input.ticket.ticket_code;
  const preview = input.messagePreview.trim() || "—";
  const channelLabel = input.channelLabel ?? "Instagram";
  const text = [
    `A creator sent a new ${channelLabel} reply on ${ticketCode}.`,
    "",
    preview,
  ].join("\n");
  const html = renderEmailLayout({
    preheader: `${channelLabel} reply ${ticketCode}`,
    title: `New ${channelLabel} creator reply`,
    bodyHtml: `<p style="margin:0 0 12px;">A creator sent a new ${escapeHtml(channelLabel)} reply on ${escapeHtml(ticketCode)}.</p><pre style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0;">${escapeHtml(preview)}</pre>`,
  });

  try {
    const sent = await sendTransactionalEmail({
      toEmail: inbox,
      toName: "Cloutflow Support",
      subject: instagramTicketEmailSubject(ticketCode),
      html,
      text,
      metadata: {
        purpose:
          channelLabel === "WhatsApp"
            ? "whatsapp-inbound-notify"
            : "instagram-inbound-notify",
        "ticket-code": ticketCode,
      },
    });
    return toMailResult(sent);
  } catch {
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}

export async function sendInstagramAgencyDetailsEmail(input: {
  agencyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  rosterUrl: string | null;
  instagramConversationRef: string;
}): Promise<InstagramMailResult> {
  const inbox = getSupportInboxEmail();
  if (!inbox) return { outcome: "skipped", errorCode: "support_inbox_missing" };
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }

  const conversationRef = sanitizeEmailHeaderValue(
    input.instagramConversationRef,
  );
  const rows = [
    "New agency details received from Instagram.",
    "",
    `Agency: ${input.agencyName?.trim() || "—"}`,
    `Name: ${input.contactName?.trim() || "—"}`,
    `Email: ${input.contactEmail?.trim() || "—"}`,
    `Roster: ${input.rosterUrl?.trim() || "—"}`,
    `Instagram conversation: ${conversationRef || "—"}`,
  ].join("\n");
  const html = renderEmailLayout({
    preheader: "New agency details received",
    title: "New agency details received",
    bodyHtml: `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0;">${escapeHtml(rows)}</pre>`,
  });

  try {
    const sent = await sendTransactionalEmail({
      toEmail: inbox,
      toName: "Cloutflow Support",
      subject: "New agency details received",
      html,
      text: rows,
      metadata: {
        purpose: "instagram-agency-details",
      },
    });
    return toMailResult(sent);
  } catch (error) {
    void safeEmailErrorMessage(error);
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}

export async function sendInstagramGeneralInquiryEmail(input: {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  inquiryDetails: string | null;
  instagramConversationRef: string;
}): Promise<InstagramMailResult> {
  const inbox = getSupportInboxEmail();
  if (!inbox) return { outcome: "skipped", errorCode: "support_inbox_missing" };
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }

  const conversationRef = sanitizeEmailHeaderValue(
    input.instagramConversationRef,
  );
  const rows = [
    "New general inquiry received from Instagram.",
    "",
    `Name: ${input.contactName?.trim() || "—"}`,
    `Email: ${input.contactEmail?.trim() || "—"}`,
    `Phone: ${input.contactPhone?.trim() || "—"}`,
    `Instagram conversation: ${conversationRef || "—"}`,
    "",
    "Inquiry:",
    input.inquiryDetails?.trim() || "—",
  ].join("\n");
  const html = renderEmailLayout({
    preheader: "New general inquiry received",
    title: "New general inquiry received",
    bodyHtml: `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0;">${escapeHtml(rows)}</pre>`,
  });

  try {
    const sent = await sendTransactionalEmail({
      toEmail: inbox,
      toName: "Cloutflow Support",
      subject: "New general inquiry received",
      html,
      text: rows,
      metadata: {
        purpose: "instagram-general-inquiry",
      },
    });
    return toMailResult(sent);
  } catch (error) {
    void safeEmailErrorMessage(error);
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}

export async function sendInstagramResolutionTranscriptEmail(input: {
  ticket: DbTicket;
  transcriptText: string;
  resolutionSummary: string;
}): Promise<InstagramMailResult> {
  if (!isBrevoConfigured()) {
    return { outcome: "failed", errorCode: "email_not_configured" };
  }

  const ticketCode = input.ticket.ticket_code;
  const transcript = [
    `Ticket ${ticketCode} was resolved.`,
    "",
    `Resolution: ${input.resolutionSummary.trim()}`,
    "",
    "Conversation transcript:",
    input.transcriptText.trim() || "—",
  ].join("\n");
  const html = renderEmailLayout({
    preheader: `Resolved ${ticketCode}`,
    title: "Creator Support ticket resolved",
    bodyHtml: `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0;">${escapeHtml(transcript)}</pre>`,
  });

  const creator = input.ticket.creator_email?.trim() ?? "";
  const inbox = getSupportInboxEmail();
  const toEmail = isValidEmailAddress(creator) ? creator : inbox;
  if (!toEmail) return { outcome: "skipped", errorCode: "no_email_recipient" };

  const bcc: string[] = [];
  if (isValidEmailAddress(creator) && inbox && inbox !== creator) {
    bcc.push(inbox);
  }

  try {
    const replyTo = isValidEmailAddress(creator)
      ? (await ensureTicketReplyToAddress(input.ticket.id)) ?? undefined
      : undefined;
    const sent = await sendTransactionalEmail({
      toEmail,
      toName: isValidEmailAddress(creator)
        ? sanitizeEmailHeaderValue(input.ticket.creator_name ?? "")
        : "Cloutflow Support",
      replyTo,
      subject: instagramTicketEmailSubject(ticketCode),
      html,
      text: transcript,
      bccEmails: bcc,
      metadata: {
        purpose: "instagram-resolution-transcript",
        "ticket-code": ticketCode,
      },
    });
    return toMailResult(sent);
  } catch {
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
}
