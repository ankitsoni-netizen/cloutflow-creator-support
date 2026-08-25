import { isValidEmailAddress } from "@/lib/email/html";
import { UNKNOWN_OPTIONAL_HINT } from "@/lib/meta/routing-copy";
import { toPlainTicketDescription } from "@/lib/meta/plain-text";
import { normalizePhoneNumber } from "@/lib/phone";
import { parseCampaignMonthForDb } from "@/lib/tickets/map";

export const INTAKE_FIELDS = [
  "creator_name",
  "creator_email",
  "creator_phone",
  "social_handle",
  "issue_type",
  "campaign_name",
  "brand_name",
  "campaign_month",
  "cloutflow_poc_name",
  "cloutflow_poc_contact",
  "issue_description",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

export const INTAKE_ISSUE_TYPES = [
  "payment_delayed",
  "tds_query",
  "gst_query",
  "campaign_execution",
  "poc_conduct",
  "other",
] as const;

export type IntakeIssueType = (typeof INTAKE_ISSUE_TYPES)[number];

export const INTAKE_ISSUE_TYPE_LABELS: Record<IntakeIssueType, string> = {
  payment_delayed: "Payment delayed",
  tds_query: "TDS query",
  gst_query: "GST query",
  campaign_execution: "Campaign execution",
  poc_conduct: "POC / Conduct",
  other: "Other",
};

const ISSUE_TYPE_ALIASES: Record<string, IntakeIssueType> = {
  payment_delayed: "payment_delayed",
  "payment delayed": "payment_delayed",
  "payment delayed / not received": "payment_delayed",
  tds_query: "tds_query",
  "tds query": "tds_query",
  gst_query: "gst_query",
  "gst query": "gst_query",
  campaign_execution: "campaign_execution",
  "campaign execution": "campaign_execution",
  poc_conduct: "poc_conduct",
  poc_conduct_concern: "poc_conduct",
  "poc / conduct": "poc_conduct",
  "poc / conduct concern": "poc_conduct",
  other: "other",
};

const UNKNOWN_PATTERN =
  /^(i\s*don'?t\s*know|idk|don'?t\s*know|unknown|n\/?a|not\s*sure|no\s*idea|none|skip)$/i;

const PLACEHOLDER_PATTERN =
  /^(n\/?a|not applicable|unknown creator|placeholder|test|asdf|xxx+)$/i;

const OPTIONAL_FIELDS = new Set<IntakeField>([
  "campaign_name",
  "brand_name",
  "cloutflow_poc_name",
  "cloutflow_poc_contact",
]);

export type IntakePhoneValue = {
  display: string;
  normalized: string;
};

export type IntakeFieldSuccess = {
  ok: true;
  value: string | null;
  phone?: IntakePhoneValue;
  campaignMonth?: string;
};

export type IntakeFieldFailure = {
  ok: false;
  errorText: string;
};

export type IntakeFieldResult = IntakeFieldSuccess | IntakeFieldFailure;

export type IntakeCollectedData = {
  creatorName: string | null;
  email: string | null;
  phoneDisplay: string | null;
  phoneNormalized: string | null;
  socialHandle: string | null;
  issueType: IntakeIssueType | null;
  campaignName: string | null;
  brandName: string | null;
  campaignMonth: string | null;
  cloutflowPocName: string | null;
  cloutflowPocContact: string | null;
  issueDescription: string | null;
  originalInboundText: string | null;
  originalInboundMessageId: string | null;
  routingSessionId: string | null;
};

export function emptyIntakeCollected(
  overrides: Partial<IntakeCollectedData> = {},
): IntakeCollectedData {
  return {
    creatorName: null,
    email: null,
    phoneDisplay: null,
    phoneNormalized: null,
    socialHandle: null,
    issueType: null,
    campaignName: null,
    brandName: null,
    campaignMonth: null,
    cloutflowPocName: null,
    cloutflowPocContact: null,
    issueDescription: null,
    originalInboundText: null,
    originalInboundMessageId: null,
    routingSessionId: null,
    ...overrides,
  };
}

export function nextIntakeField(
  current: IntakeField | null,
): IntakeField | null {
  if (!current) return INTAKE_FIELDS[0];
  const index = INTAKE_FIELDS.indexOf(current);
  if (index < 0 || index >= INTAKE_FIELDS.length - 1) return null;
  return INTAKE_FIELDS[index + 1] ?? null;
}

export function isUnknownOptionalAnswer(value: string): boolean {
  return UNKNOWN_PATTERN.test(value.trim());
}

export function isFakePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

export function normalizeIntakeIssueType(
  value: string | null | undefined,
): IntakeIssueType | null {
  if (!value) return null;
  return ISSUE_TYPE_ALIASES[value.trim().toLowerCase()] ?? null;
}

function compactPhone(value: string): string {
  return value.trim().replace(/[\s\-().]/g, "");
}

/**
 * Accept Indian and international contact numbers for Instagram intake.
 * Stores a display string separately from a normalized E.164-like value.
 */
export function parseIntakePhone(value: string): IntakePhoneValue | null {
  const display = value.trim();
  if (!display) return null;

  const strict = normalizePhoneNumber(display);
  if (strict) return { display, normalized: strict };

  const compact = compactPhone(display);
  const digits = compact.replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return null;

  if (/^\d{10}$/.test(digits)) {
    return { display, normalized: `+91${digits}` };
  }
  if (/^0\d{10}$/.test(digits)) {
    return { display, normalized: `+91${digits.slice(1)}` };
  }
  if (/^91\d{10}$/.test(digits)) {
    return { display, normalized: `+${digits}` };
  }

  const plusForm = compact.startsWith("+") ? compact : `+${digits}`;
  if (/^\+\d{8,15}$/.test(plusForm)) {
    return { display, normalized: plusForm };
  }

  return null;
}

export function validateIntakeField(
  field: IntakeField,
  raw: string,
  collected: IntakeCollectedData,
): IntakeFieldResult {
  const trimmed = toPlainTicketDescription(raw);
  if (!trimmed) {
    return { ok: false, errorText: fieldEmptyError(field) };
  }

  if (OPTIONAL_FIELDS.has(field) && isUnknownOptionalAnswer(trimmed)) {
    return { ok: true, value: null };
  }

  if (isFakePlaceholder(trimmed) && field !== "issue_description") {
    return {
      ok: false,
      errorText:
        "Please enter a real value. Placeholders like N/A cannot be stored.",
    };
  }

  switch (field) {
    case "creator_name":
      if (trimmed.length < 2) {
        return { ok: false, errorText: "Please send your full name." };
      }
      return { ok: true, value: trimmed };
    case "creator_email":
      if (!isValidEmailAddress(trimmed)) {
        return {
          ok: false,
          errorText: "Please send a valid email address, for example name@domain.com.",
        };
      }
      return { ok: true, value: trimmed.toLowerCase() };
    case "creator_phone": {
      const phone = parseIntakePhone(trimmed);
      if (!phone) {
        return {
          ok: false,
          errorText:
            "Please send a valid phone number with country code, for example +91 98765 43210.",
        };
      }
      return { ok: true, value: phone.display, phone };
    }
    case "social_handle":
      if (/^(yes|y|confirm)$/i.test(trimmed)) {
        if (collected.socialHandle) {
          return { ok: true, value: collected.socialHandle };
        }
        return {
          ok: false,
          errorText: "Please send your Instagram or YouTube handle.",
        };
      }
      return { ok: true, value: trimmed.replace(/^@/, "") };
    case "issue_type": {
      const issueType = normalizeIntakeIssueType(trimmed);
      if (!issueType) {
        return {
          ok: false,
          errorText: "Please choose one of the issue types below.",
        };
      }
      return { ok: true, value: issueType };
    }
    case "campaign_name":
    case "brand_name":
    case "cloutflow_poc_name":
      return { ok: true, value: trimmed };
    case "campaign_month": {
      const month = parseCampaignMonthForDb(trimmed);
      if (!month) {
        return {
          ok: false,
          errorText:
            "Please send the campaign month and year, for example August 2026.",
        };
      }
      return { ok: true, value: month, campaignMonth: month };
    }
    case "cloutflow_poc_contact": {
      const phone = parseIntakePhone(trimmed);
      if (!phone) {
        return {
          ok: false,
          errorText:
            "Please send a valid POC contact number, or reply \"I don't know\".",
        };
      }
      return { ok: true, value: phone.normalized, phone };
    }
    case "issue_description":
      if (
        /^(yes|y|use original|original)$/i.test(trimmed) &&
        collected.originalInboundText
      ) {
        return { ok: true, value: collected.originalInboundText };
      }
      if (trimmed.length < 4) {
        return {
          ok: false,
          errorText: "Please describe the issue in a bit more detail.",
        };
      }
      return { ok: true, value: trimmed };
    default: {
      const _exhaustive: never = field;
      return { ok: false, errorText: `Unsupported field: ${_exhaustive}` };
    }
  }
}

export function applyIntakeValue(
  collected: IntakeCollectedData,
  field: IntakeField,
  result: IntakeFieldSuccess,
): IntakeCollectedData {
  const next = { ...collected };
  switch (field) {
    case "creator_name":
      next.creatorName = result.value;
      break;
    case "creator_email":
      next.email = result.value;
      break;
    case "creator_phone":
      next.phoneDisplay = result.phone?.display ?? result.value;
      next.phoneNormalized = result.phone?.normalized ?? result.value;
      break;
    case "social_handle":
      next.socialHandle = result.value;
      break;
    case "issue_type":
      next.issueType = (result.value as IntakeIssueType | null) ?? null;
      break;
    case "campaign_name":
      next.campaignName = result.value;
      break;
    case "brand_name":
      next.brandName = result.value;
      break;
    case "campaign_month":
      next.campaignMonth = result.campaignMonth ?? result.value;
      break;
    case "cloutflow_poc_name":
      next.cloutflowPocName = result.value;
      break;
    case "cloutflow_poc_contact":
      next.cloutflowPocContact = result.phone?.normalized ?? result.value;
      break;
    case "issue_description":
      next.issueDescription = result.value;
      break;
    default: {
      const _exhaustive: never = field;
      void _exhaustive;
    }
  }
  return next;
}

export function formatIntakeSummary(collected: IntakeCollectedData): string {
  const rows: Array<[string, string | null]> = [
    ["Name", collected.creatorName],
    ["Email", collected.email],
    ["Phone", collected.phoneDisplay ?? collected.phoneNormalized],
    ["Social handle", collected.socialHandle],
    [
      "Issue type",
      collected.issueType
        ? INTAKE_ISSUE_TYPE_LABELS[collected.issueType]
        : null,
    ],
    ["Campaign", collected.campaignName],
    ["Brand", collected.brandName],
    ["Campaign month", collected.campaignMonth],
    ["Cloutflow POC", collected.cloutflowPocName],
    ["POC contact", collected.cloutflowPocContact],
    ["Description", collected.issueDescription],
  ];
  const lines = ["Here’s a summary of your Creator Support request:", ""];
  for (const [label, value] of rows) {
    lines.push(`${label}: ${value?.trim() || "—"}`);
  }
  return lines.join("\n");
}

function fieldEmptyError(field: IntakeField): string {
  switch (field) {
    case "creator_name":
      return "Please send your name.";
    case "creator_email":
      return "Please send your email address.";
    case "creator_phone":
      return "Please send your phone number.";
    case "social_handle":
      return "Please send your social handle.";
    case "issue_type":
      return "Please choose an issue type.";
    case "campaign_month":
      return "Please send the campaign month and year.";
    case "issue_description":
      return "Please describe the issue.";
    default:
      return `Please send a value, or reply "I don't know".`;
  }
}

export function intakePromptForField(
  field: IntakeField,
  collected: IntakeCollectedData,
): string {
  switch (field) {
    case "creator_name":
      return "What name should we use on the ticket?";
    case "creator_email":
      return "What email address should we use for ticket updates?";
    case "creator_phone":
      return "What phone number can we reach you on? Include the country code if you have one.";
    case "social_handle":
      return collected.socialHandle
        ? `Is your social handle ${collected.socialHandle}? Reply YES to confirm, or send the correct handle.`
        : "What is your Instagram or YouTube handle?";
    case "issue_type":
      return "What is this about? Choose one of the options below.";
    case "campaign_name":
      return `What is the campaign name? ${UNKNOWN_OPTIONAL_HINT}`;
    case "brand_name":
      return `What is the brand name? ${UNKNOWN_OPTIONAL_HINT}`;
    case "campaign_month":
      return "Which month and year is this campaign from? For example August 2026.";
    case "cloutflow_poc_name":
      return `Who is your Cloutflow point of contact? ${UNKNOWN_OPTIONAL_HINT}`;
    case "cloutflow_poc_contact":
      return `What is your Cloutflow POC’s contact number? ${UNKNOWN_OPTIONAL_HINT}`;
    case "issue_description":
      return collected.originalInboundText
        ? "Please describe the issue. Reply YES to use your original message, or type a new description."
        : "Please describe the issue.";
    default: {
      const _exhaustive: never = field;
      return `Unsupported field: ${_exhaustive}`;
    }
  }
}
