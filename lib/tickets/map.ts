import {
  WEBSITE_REQUESTER_TYPE_LABELS,
  websiteCategoryLabel,
  type WebsiteRequesterType,
} from "@/lib/public-intake/constants";
import {
  ISSUE_TYPE_FROM_DB,
  ISSUE_TYPE_TO_DB,
  type IssueTypeLabel,
} from "@/lib/ticket-constants";
import {
  PHONE_VALIDATION_MESSAGE,
  normalizePhoneNumber,
} from "@/lib/phone";
import type {
  NewTicketFormData,
  Platform,
  SourceChannel,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";
import type { DbTicket, DbTicketInsert, DbPlatform } from "@/lib/tickets/types";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_LOOKUP: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatCampaignMonthForDisplay(
  value: string | null | undefined,
): string {
  if (!value) return "";

  const isoMatch = value.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const monthIndex = Number(isoMatch[2]) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${MONTH_NAMES[monthIndex]} ${year}`;
    }
  }

  return value;
}

export function parseCampaignMonthForDb(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-01`;
    }
  }

  const namedMatch = value.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (namedMatch) {
    const monthIndex = MONTH_LOOKUP[namedMatch[1].toLowerCase()];
    const year = Number(namedMatch[2]);
    if (monthIndex !== undefined) {
      return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
    }
  }

  const slashMatch = value.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const year = Number(slashMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-01`;
    }
  }

  return null;
}

function mapStatus(value: string): TicketStatus {
  switch (value.toLowerCase()) {
    case "in_progress":
    case "in progress":
      return "In Progress";
    case "waiting":
      return "Waiting";
    case "resolved":
      return "Resolved";
    case "open":
    default:
      return "Open";
  }
}

function mapPriority(value: string): TicketPriority {
  switch (value.toLowerCase()) {
    case "urgent":
      return "Urgent";
    case "high":
      return "High";
    case "low":
      return "Low";
    case "normal":
    default:
      return "Normal";
  }
}

function mapSourceChannel(value: string): SourceChannel {
  switch (value.toLowerCase()) {
    case "whatsapp":
      return "WhatsApp";
    case "instagram":
      return "Instagram";
    case "website":
      return "Website";
    case "email":
      return "Email";
    case "phone_call":
    case "phone call":
    default:
      return "Phone Call";
  }
}

function mapPlatform(value: string | null): Platform | "" {
  if (!value?.trim()) return "";
  if (value.toLowerCase() === "youtube") return "YouTube";
  if (value.toLowerCase() === "instagram") return "Instagram";
  return "";
}

function mapRequesterTypeLabel(value: string | null): string {
  if (!value) return "";
  const key = value.toLowerCase() as WebsiteRequesterType;
  return WEBSITE_REQUESTER_TYPE_LABELS[key] ?? value;
}

function primaryIssueLabel(row: DbTicket): string {
  if (row.issue_type) return mapIssueTypeFromDb(row.issue_type);
  const categoryLabel = websiteCategoryLabel(row.request_category);
  if (categoryLabel) return categoryLabel;
  return "Website enquiry";
}

function mapPlatformToDb(value: Platform): DbPlatform {
  return value === "YouTube" ? "youtube" : "instagram";
}

function mapIssueTypeToDb(value: string): string {
  if (value in ISSUE_TYPE_TO_DB) {
    return ISSUE_TYPE_TO_DB[value as IssueTypeLabel];
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[/]+/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function mapIssueTypeFromDb(value: string | null | undefined): string {
  if (!value) return "";
  return ISSUE_TYPE_FROM_DB[value] ?? ISSUE_TYPE_FROM_DB[value.toLowerCase()] ?? value;
}

export function mapDbTicketToTicket(row: DbTicket): Ticket {
  const issueLabel = primaryIssueLabel(row);
  return {
    id: row.id,
    ticketNumber: row.ticket_code,
    creatorName: row.creator_name ?? "",
    phone: row.creator_phone ?? "",
    email: row.creator_email ?? "",
    socialHandle: row.social_handle ?? "",
    platform: mapPlatform(row.platform),
    issueType: issueLabel,
    issueCategory: issueLabel,
    requestCategory: websiteCategoryLabel(row.request_category),
    requestCategoryKey: row.request_category?.trim() ?? "",
    companyName: row.company_name ?? "",
    requesterType: mapRequesterTypeLabel(row.requester_type),
    topicOrModule: row.topic_or_module ?? "",
    intakeDetails:
      row.intake_details && typeof row.intake_details === "object"
        ? row.intake_details
        : {},
    campaignName: row.campaign_name ?? "",
    brand: row.brand_name ?? "",
    campaignMonth: formatCampaignMonthForDisplay(row.campaign_month),
    cloutflowPoc: row.cloutflow_poc_name ?? "",
    cloutflowPocContactNumber: row.cloutflow_poc_contact_number ?? "",
    issueDescription: row.issue_description ?? "",
    internalCallNotes: row.internal_notes ?? undefined,
    sourceChannel: mapSourceChannel(row.source_channel),
    status: mapStatus(row.status),
    priority: mapPriority(row.priority),
    assignedTeam: row.assigned_team ?? "",
    assignedExecutive: row.assigned_executive_name ?? "",
    assignedExecutiveId: row.assigned_executive_id,
    resolutionSummary: row.resolution_summary,
    resolvedAt: row.resolved_at,
    acknowledgementEmailSentAt: row.acknowledgement_email_sent_at,
    firstResponseAt: row.first_response_at,
    customerLastNotifiedAt: row.customer_last_notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activity: [],
    sendAcknowledgementEmail:
      row.acknowledgement_email_requested ?? undefined,
    externalContactId: row.external_contact_id ?? null,
    externalConversationId: row.external_conversation_id ?? null,
  };
}

export function mapFormToDbInsert(
  form: NewTicketFormData,
  options: {
    assignedTeam: string | null;
    assignedExecutiveId: string | null;
  },
): { insert: DbTicketInsert } | { error: string } {
  const campaignMonth = parseCampaignMonthForDb(form.campaignMonth);
  if (!campaignMonth) {
    return {
      error:
        "Enter campaign month as a month and year, for example August 2026.",
    };
  }

  const creatorPhone = normalizePhoneNumber(form.phone);
  if (!creatorPhone) {
    return { error: `Creator phone: ${PHONE_VALIDATION_MESSAGE}` };
  }

  const pocContact = normalizePhoneNumber(form.cloutflowPocContactNumber);
  if (!pocContact) {
    return {
      error: `Cloutflow POC contact number: ${PHONE_VALIDATION_MESSAGE}`,
    };
  }

  return {
    insert: {
      creator_name: form.creatorName.trim(),
      creator_phone: creatorPhone,
      creator_email: emptyToNull(form.email),
      social_handle: emptyToNull(form.socialHandle),
      platform: mapPlatformToDb(form.platform),
      issue_type: mapIssueTypeToDb(form.issueType),
      campaign_name: emptyToNull(form.campaignName),
      brand_name: emptyToNull(form.brand),
      campaign_month: campaignMonth,
      cloutflow_poc_name: emptyToNull(form.cloutflowPoc),
      cloutflow_poc_contact_number: pocContact,
      source_channel: "phone_call",
      status: "open",
      priority: "normal",
      assigned_team: options.assignedTeam?.trim() || "Creator Support",
      // Null assignedExecutiveId is filled by the tickets INSERT trigger.
      assigned_executive_id: options.assignedExecutiveId,
      assigned_executive_name: emptyToNull(form.assignedExecutive),
      issue_description: emptyToNull(form.issueDescription),
      internal_notes: emptyToNull(form.internalCallNotes),
      acknowledgement_email_requested: form.sendAcknowledgementEmail,
    },
  };
}
