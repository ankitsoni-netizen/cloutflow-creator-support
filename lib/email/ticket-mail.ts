import "server-only";

import { isBrevoConfigured } from "@/lib/email/env-check";
import {
  isValidEmailAddress,
  sanitizeEmailHeaderValue,
} from "@/lib/email/html";
import { sendTransactionalEmail } from "@/lib/email/send";
import {
  buildTicketAcknowledgementEmail,
  type TicketAcknowledgementContent,
  type TicketAcknowledgementDetailRow,
} from "@/lib/email/templates/ticket-acknowledgement";
import { buildTicketReplyEmail } from "@/lib/email/templates/ticket-reply";
import { buildTicketResolutionEmail } from "@/lib/email/templates/ticket-resolution";
import {
  buildWebsiteInternalNotificationEmail,
  type WebsiteInternalNotificationContent,
  type WebsiteInternalNotificationDetailRow,
} from "@/lib/email/templates/website-internal-notification";
import {
  EmailServiceError,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
} from "@/lib/email/types";
import {
  WEBSITE_REQUESTER_TYPE_LABELS,
  websiteCategoryLabel,
  type WebsiteRequesterType,
} from "@/lib/public-intake/constants";
import {
  formatCampaignMonthForDisplay,
  mapIssueTypeFromDb,
} from "@/lib/tickets/map";
import type { DbTicket } from "@/lib/tickets/types";
import { dbStatusToUiLabel } from "@/lib/tickets/workflow-map";
import { formatDateTime } from "@/lib/utils";

export type AcknowledgementOutcome = "sent" | "skipped" | "failed";
export type InternalNotificationOutcome = "sent" | "skipped" | "failed";

export type InternalNotificationSendDeps = {
  sendEmail?: (
    input: SendTransactionalEmailInput,
  ) => Promise<SendTransactionalEmailResult>;
  getSupportInboxEmail?: () => string | undefined;
  isEmailConfigured?: () => boolean;
};

export function safeEmailErrorMessage(error: unknown): string {
  if (error instanceof EmailServiceError) return error.message;
  if (error instanceof Error) {
    const lowered = error.message.toLowerCase();
    if (lowered.includes("not configured")) {
      return "Email is not configured on the server.";
    }
  }
  return "The email could not be accepted by Brevo. Please try again.";
}

/** Human-readable labels for ticket emails (reuses ticket map helpers). */
export function formatTicketEmailLabels(ticket: DbTicket) {
  return {
    issueType: mapIssueTypeFromDb(ticket.issue_type),
    // Parse YYYY-MM(-DD) as calendar parts — no Date timezone shift.
    campaignMonth: formatCampaignMonthForDisplay(ticket.campaign_month),
    ticketStatus: dbStatusToUiLabel(ticket.status),
    enquiryCategory:
      websiteCategoryLabel(ticket.request_category) ||
      mapIssueTypeFromDb(ticket.issue_type) ||
      "Support request",
  };
}

function pushDetail(
  rows: TicketAcknowledgementDetailRow[],
  label: string,
  value: string | null | undefined,
) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  rows.push({ label, value: trimmed });
}

/** Relevant submitted details for acknowledgement emails. */
export function buildAcknowledgementDetailRows(
  ticket: DbTicket,
): TicketAcknowledgementDetailRow[] {
  const labels = formatTicketEmailLabels(ticket);
  const rows: TicketAcknowledgementDetailRow[] = [];
  const category = ticket.request_category?.trim() ?? "";

  if (category === "creator_support" || (!category && ticket.issue_type)) {
    pushDetail(rows, "Issue type", labels.issueType);
    pushDetail(rows, "Platform", ticket.platform);
    pushDetail(rows, "Social handle", ticket.social_handle);
    pushDetail(rows, "Brand", ticket.brand_name);
    pushDetail(rows, "Campaign", ticket.campaign_name);
    pushDetail(rows, "Campaign month", labels.campaignMonth);
    pushDetail(rows, "Cloutflow POC", ticket.cloutflow_poc_name);
  } else if (category === "track_campaign") {
    pushDetail(rows, "Company", ticket.company_name);
    pushDetail(rows, "Campaign name or ID", ticket.campaign_name);
  } else if (category === "product_demo") {
    pushDetail(rows, "Company", ticket.company_name);
    pushDetail(rows, "Phone", ticket.creator_phone);
  } else if (
    category === "brand_support" ||
    category === "reporting_analytics"
  ) {
    pushDetail(rows, "Company", ticket.company_name);
  } else if (category === "payments_commercials") {
    const requesterKey = ticket.requester_type?.toLowerCase() as
      | WebsiteRequesterType
      | undefined;
    pushDetail(
      rows,
      "Requester type",
      requesterKey
        ? WEBSITE_REQUESTER_TYPE_LABELS[requesterKey] ?? ticket.requester_type
        : ticket.requester_type,
    );
    pushDetail(rows, "Company", ticket.company_name);
    pushDetail(rows, "Social handle", ticket.social_handle);
    pushDetail(rows, "Campaign name or ID", ticket.campaign_name);
  } else if (category === "product_documentation") {
    pushDetail(rows, "Topic or module", ticket.topic_or_module);
  } else {
    pushDetail(rows, "Company", ticket.company_name);
    pushDetail(rows, "Campaign", ticket.campaign_name);
    pushDetail(rows, "Brand", ticket.brand_name);
    pushDetail(rows, "Topic or module", ticket.topic_or_module);
  }

  return rows;
}

export function buildAcknowledgementEmailContent(
  ticket: DbTicket,
): TicketAcknowledgementContent {
  const labels = formatTicketEmailLabels(ticket);
  return {
    creatorName: ticket.creator_name,
    ticketCode: ticket.ticket_code,
    enquiryCategory: labels.enquiryCategory,
    detailRows: buildAcknowledgementDetailRows(ticket),
  };
}

function formatPlatformLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const key = value.trim().toLowerCase();
  if (key === "instagram") return "Instagram";
  if (key === "youtube") return "YouTube";
  return value.trim();
}

function formatRequesterTypeLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const key = value.trim().toLowerCase() as WebsiteRequesterType;
  return WEBSITE_REQUESTER_TYPE_LABELS[key] ?? value.trim();
}

/** Optional + always-on detail rows for the internal support inbox email. */
export function buildInternalNotificationDetailRows(
  ticket: DbTicket,
): WebsiteInternalNotificationDetailRow[] {
  const labels = formatTicketEmailLabels(ticket);
  const rows: WebsiteInternalNotificationDetailRow[] = [];

  pushDetail(rows, "Email", ticket.creator_email);
  pushDetail(rows, "Phone", ticket.creator_phone);
  pushDetail(rows, "Social handle", ticket.social_handle);
  pushDetail(rows, "Platform", formatPlatformLabel(ticket.platform));
  pushDetail(rows, "Issue type", labels.issueType);
  pushDetail(rows, "Company", ticket.company_name);
  pushDetail(rows, "Brand", ticket.brand_name);
  pushDetail(rows, "Campaign name / ID", ticket.campaign_name);
  pushDetail(rows, "Campaign month", labels.campaignMonth);
  pushDetail(rows, "Cloutflow POC", ticket.cloutflow_poc_name);
  pushDetail(
    rows,
    "Cloutflow POC contact",
    ticket.cloutflow_poc_contact_number,
  );
  pushDetail(rows, "Requester type", formatRequesterTypeLabel(ticket.requester_type));
  pushDetail(rows, "Topic / module", ticket.topic_or_module);
  pushDetail(rows, "Source channel", "Website");
  pushDetail(rows, "Created", formatDateTime(ticket.created_at));

  return rows;
}

export function buildInternalNotificationEmailContent(
  ticket: DbTicket,
): WebsiteInternalNotificationContent {
  const labels = formatTicketEmailLabels(ticket);
  return {
    ticketCode: ticket.ticket_code,
    deskLabel: ticket.assigned_team?.trim() || "Creator Support",
    requesterName: ticket.creator_name,
    enquiryCategory: labels.enquiryCategory,
    detailRows: buildInternalNotificationDetailRows(ticket),
    enquiryMessage: ticket.issue_description ?? "",
  };
}

function readSupportInboxEmail(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.SUPPORT_INBOX_EMAIL;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Notifies the internal support inbox about a new website ticket.
 * Failures are soft — callers must not roll back the ticket or change
 * acknowledgement_email_sent_at based on this outcome.
 */
export async function sendInternalSupportNotificationForTicket(
  ticket: DbTicket,
  deps: InternalNotificationSendDeps = {},
): Promise<{ outcome: InternalNotificationOutcome; error?: string }> {
  const getSupportInboxEmail =
    deps.getSupportInboxEmail ?? (() => readSupportInboxEmail());
  const isEmailConfigured = deps.isEmailConfigured ?? isBrevoConfigured;
  const sendEmail = deps.sendEmail ?? sendTransactionalEmail;

  const inbox = getSupportInboxEmail()?.trim() ?? "";
  if (!inbox) {
    return {
      outcome: "failed",
      error: "Support inbox email is not configured.",
    };
  }
  if (!isValidEmailAddress(inbox)) {
    return {
      outcome: "failed",
      error: "Support inbox email is invalid.",
    };
  }

  const replyTo = ticket.creator_email?.trim() ?? "";
  if (!isValidEmailAddress(replyTo)) {
    return {
      outcome: "failed",
      error: "Requester email is missing or invalid.",
    };
  }

  if (!isEmailConfigured()) {
    return {
      outcome: "failed",
      error: "Email is not configured on the server.",
    };
  }

  try {
    const content = buildWebsiteInternalNotificationEmail(
      buildInternalNotificationEmailContent(ticket),
    );
    await sendEmail({
      toEmail: inbox,
      toName: "Cloutflow Support",
      replyTo,
      subject: sanitizeEmailHeaderValue(content.subject),
      html: content.html,
      text: content.text,
      metadata: {
        purpose: "website-internal-notification",
        "ticket-code": ticket.ticket_code,
      },
    });
    return { outcome: "sent" };
  } catch (error) {
    return { outcome: "failed", error: safeEmailErrorMessage(error) };
  }
}

export async function sendAcknowledgementForTicket(
  ticket: DbTicket,
): Promise<{ outcome: AcknowledgementOutcome; error?: string }> {
  if (!ticket.acknowledgement_email_requested) {
    return { outcome: "skipped" };
  }
  if (ticket.acknowledgement_email_sent_at) {
    return { outcome: "sent" };
  }

  const recipient = ticket.creator_email?.trim() ?? "";
  if (!isValidEmailAddress(recipient)) {
    return {
      outcome: "failed",
      error: "Creator email is missing or invalid.",
    };
  }
  if (!isBrevoConfigured()) {
    return {
      outcome: "failed",
      error: "Email is not configured on the server.",
    };
  }

  try {
    const content = buildTicketAcknowledgementEmail(
      buildAcknowledgementEmailContent(ticket),
    );
    await sendTransactionalEmail({
      toEmail: recipient,
      toName: sanitizeEmailHeaderValue(ticket.creator_name),
      subject: sanitizeEmailHeaderValue(content.subject),
      html: content.html,
      text: content.text,
      metadata: {
        purpose: "ticket-acknowledgement",
        "ticket-code": ticket.ticket_code,
      },
    });
    return { outcome: "sent" };
  } catch (error) {
    return { outcome: "failed", error: safeEmailErrorMessage(error) };
  }
}

export async function sendCreatorReplyEmail(options: {
  ticket: DbTicket;
  commentText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const recipient = options.ticket.creator_email?.trim() ?? "";
  if (!isValidEmailAddress(recipient)) {
    return { ok: false, error: "Creator email is missing or invalid." };
  }
  if (!isBrevoConfigured()) {
    return { ok: false, error: "Email is not configured on the server." };
  }

  const reply = options.commentText.trim();
  if (!reply) {
    return { ok: false, error: "Creator reply cannot be empty." };
  }

  try {
    const labels = formatTicketEmailLabels(options.ticket);
    const content = buildTicketReplyEmail({
      creatorName: options.ticket.creator_name,
      ticketCode: options.ticket.ticket_code,
      staffReply: reply,
      ticketStatus: labels.ticketStatus,
      brand: options.ticket.brand_name ?? "",
      campaignName: options.ticket.campaign_name ?? "",
      campaignMonth: labels.campaignMonth,
    });

    await sendTransactionalEmail({
      toEmail: recipient,
      toName: sanitizeEmailHeaderValue(options.ticket.creator_name),
      subject: sanitizeEmailHeaderValue(content.subject),
      html: content.html,
      text: content.text,
      metadata: {
        purpose: "ticket-reply",
        "ticket-code": options.ticket.ticket_code,
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: safeEmailErrorMessage(error) };
  }
}

export async function sendResolutionEmail(options: {
  ticket: DbTicket;
  resolutionSummary: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const recipient = options.ticket.creator_email?.trim() ?? "";
  if (!isValidEmailAddress(recipient)) {
    return { ok: false, error: "Creator email is missing or invalid." };
  }
  if (!isBrevoConfigured()) {
    return { ok: false, error: "Email is not configured on the server." };
  }

  const summary = options.resolutionSummary.trim();
  if (!summary) {
    return { ok: false, error: "Resolution summary is required." };
  }

  try {
    const labels = formatTicketEmailLabels(options.ticket);
    const content = buildTicketResolutionEmail({
      creatorName: options.ticket.creator_name,
      ticketCode: options.ticket.ticket_code,
      issueType: labels.issueType || labels.enquiryCategory,
      resolutionSummary: summary,
      brand: options.ticket.brand_name ?? "",
      campaignName: options.ticket.campaign_name ?? "",
      campaignMonth: labels.campaignMonth,
    });

    await sendTransactionalEmail({
      toEmail: recipient,
      toName: sanitizeEmailHeaderValue(options.ticket.creator_name),
      subject: sanitizeEmailHeaderValue(content.subject),
      html: content.html,
      text: content.text,
      metadata: {
        purpose: "ticket-resolution",
        "ticket-code": options.ticket.ticket_code,
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: safeEmailErrorMessage(error) };
  }
}
