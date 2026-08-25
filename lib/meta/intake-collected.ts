import type { IntakeCollectedData, IntakeField } from "@/lib/meta/intake-validate";
import { emptyIntakeCollected, INTAKE_FIELDS } from "@/lib/meta/intake-validate";
import type { RoutingIntent } from "@/lib/meta/conversation-machine";
import { ROUTING_INTENTS } from "@/lib/meta/conversation-machine";

const INTAKE_FIELD_SET = new Set<string>(INTAKE_FIELDS);
const INTENT_SET = new Set<string>(ROUTING_INTENTS);

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
  if (typeof value === "string" && INTAKE_FIELD_SET.has(value)) {
    return value as IntakeField;
  }
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
    socialHandle: asString(record.socialHandle),
    issueType:
      issueType === "payment_delayed" ||
      issueType === "tds_query" ||
      issueType === "gst_query" ||
      issueType === "campaign_execution" ||
      issueType === "poc_conduct" ||
      issueType === "other"
        ? issueType
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
    socialHandle: collected.socialHandle,
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
  };
}
