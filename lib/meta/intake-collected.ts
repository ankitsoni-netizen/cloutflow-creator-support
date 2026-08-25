import type {
  IgCreatorReason,
  IgIssueCategory,
  IgPersona,
  IntakeCollectedData,
  IntakeField,
  IntakeIssueType,
  IntakePlatform,
} from "@/lib/meta/intake-validate";
import {
  emptyIntakeCollected,
  IG_CREATOR_REASONS,
  IG_ISSUE_CATEGORIES,
  IG_PERSONAS,
  INTAKE_FIELDS,
  resolveIntakeStep,
} from "@/lib/meta/intake-validate";
import type { RoutingIntent } from "@/lib/meta/conversation-machine";
import { ROUTING_INTENTS } from "@/lib/meta/conversation-machine";

const INTAKE_FIELD_SET = new Set<string>(INTAKE_FIELDS);
const INTENT_SET = new Set<string>(ROUTING_INTENTS);
const ISSUE_TYPES = new Set<string>([
  "payment_delayed",
  "tds_query",
  "gst_query",
  "campaign_execution",
  "poc_conduct",
  "other",
]);
const PERSONA_SET = new Set<string>(IG_PERSONAS);
const CREATOR_REASON_SET = new Set<string>(IG_CREATOR_REASONS);
const ISSUE_CATEGORY_SET = new Set<string>(IG_ISSUE_CATEGORIES);

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseRoutingIntent(value: unknown): RoutingIntent {
  if (typeof value === "string" && INTENT_SET.has(value)) {
    return value as RoutingIntent;
  }
  return "unclassified";
}

export function parseIntakeField(value: unknown): IntakeField | null {
  if (typeof value !== "string") return null;
  const resolved = resolveIntakeStep(value);
  if (resolved) return resolved;
  if (INTAKE_FIELD_SET.has(value)) return value as IntakeField;
  return null;
}

function parsePlatform(value: unknown): IntakePlatform | null {
  if (value === "instagram" || value === "youtube") return value;
  return null;
}

export function collectedFromRecord(value: unknown): IntakeCollectedData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyIntakeCollected();
  }
  const record = value as Record<string, unknown>;
  const issueType = asString(record.issueType);
  return emptyIntakeCollected({
    creatorName: asString(record.creatorName),
    email: asString(record.email),
    phoneDisplay: asString(record.phoneDisplay),
    phoneNormalized: asString(record.phoneNormalized),
    platform: parsePlatform(record.platform),
    socialHandle: asString(record.socialHandle),
    socialHandleDisplay: asString(record.socialHandleDisplay),
    issueType: ISSUE_TYPES.has(issueType ?? "")
      ? (issueType as IntakeIssueType)
      : null,
    campaignName: asString(record.campaignName),
    brandName: asString(record.brandName),
    campaignMonth: asString(record.campaignMonth),
    cloutflowPocName: asString(record.cloutflowPocName),
    cloutflowPocContact: asString(record.cloutflowPocContact),
    issueDescription: asString(record.issueDescription),
    originalInboundText: asString(record.originalInboundText),
    originalInboundMessageId: asString(record.originalInboundMessageId),
    routingSessionId: asString(record.routingSessionId),
    phonePrefill: record.phonePrefill === true,
    cachedUsername: asString(record.cachedUsername),
    usernameLookupAttempted: record.usernameLookupAttempted === true,
    igPersona:
      typeof record.igPersona === "string" && PERSONA_SET.has(record.igPersona)
        ? (record.igPersona as IgPersona)
        : null,
    igCreatorReason:
      typeof record.igCreatorReason === "string" &&
      CREATOR_REASON_SET.has(record.igCreatorReason)
        ? (record.igCreatorReason as IgCreatorReason)
        : null,
    igIssueCategory:
      typeof record.igIssueCategory === "string" &&
      ISSUE_CATEGORY_SET.has(record.igIssueCategory)
        ? (record.igIssueCategory as IgIssueCategory)
        : null,
    agencyName: asString(record.agencyName),
    rosterUrl: asString(record.rosterUrl),
    inquiryDetails: asString(record.inquiryDetails),
  });
}

export function collectedToRecord(
  collected: IntakeCollectedData,
): Record<string, unknown> {
  return {
    creatorName: collected.creatorName,
    email: collected.email,
    phoneDisplay: collected.phoneDisplay,
    phoneNormalized: collected.phoneNormalized,
    platform: collected.platform,
    socialHandle: collected.socialHandle,
    socialHandleDisplay: collected.socialHandleDisplay,
    issueType: collected.issueType,
    campaignName: collected.campaignName,
    brandName: collected.brandName,
    campaignMonth: collected.campaignMonth,
    cloutflowPocName: collected.cloutflowPocName,
    cloutflowPocContact: collected.cloutflowPocContact,
    issueDescription: collected.issueDescription,
    originalInboundText: collected.originalInboundText,
    originalInboundMessageId: collected.originalInboundMessageId,
    routingSessionId: collected.routingSessionId,
    phonePrefill: collected.phonePrefill,
    cachedUsername: collected.cachedUsername,
    usernameLookupAttempted: collected.usernameLookupAttempted,
    igPersona: collected.igPersona,
    igCreatorReason: collected.igCreatorReason,
    igIssueCategory: collected.igIssueCategory,
    agencyName: collected.agencyName,
    rosterUrl: collected.rosterUrl,
    inquiryDetails: collected.inquiryDetails,
  };
}
