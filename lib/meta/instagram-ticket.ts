import {
  emptyCollectedData,
  incompleteCollectedFields,
  type ChannelCollectedData,
} from "@/lib/meta/collected-data";
import { toPlainTicketDescription } from "@/lib/meta/plain-text";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";

export const INSTAGRAM_TICKET_ASSIGNED_TEAM = "Creator Support";

export const ACTIVE_TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting",
] as const;

export type InstagramTicketInsert = {
  creator_name: string | null;
  creator_phone: null;
  creator_email: null;
  social_handle: null;
  platform: null;
  issue_type: null;
  campaign_name: null;
  brand_name: null;
  campaign_month: null;
  cloutflow_poc_name: null;
  cloutflow_poc_contact_number: null;
  request_category: "creator_support";
  source_channel: "instagram";
  status: "open";
  priority: "normal";
  assigned_team: typeof INSTAGRAM_TICKET_ASSIGNED_TEAM;
  assigned_executive_id: null;
  assigned_executive_name: null;
  issue_description: string | null;
  internal_notes: null;
  acknowledgement_email_requested: false;
  external_contact_id: string;
  external_conversation_id: string;
  intake_details: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export function buildInstagramCollectedData(
  event: NormalizedMetaInboundText,
): ChannelCollectedData {
  const description = toPlainTicketDescription(event.messageBody);
  return emptyCollectedData({
    creatorName: event.displayName,
    issueDescription: description.length > 0 ? description : null,
  });
}

export function mapInstagramEventToTicketInsert(
  event: NormalizedMetaInboundText,
): InstagramTicketInsert {
  const collected = buildInstagramCollectedData(event);
  const incompleteFields = incompleteCollectedFields(collected);
  const description = collected.issueDescription;

  return {
    creator_name: collected.creatorName,
    creator_phone: null,
    creator_email: null,
    social_handle: null,
    platform: null,
    issue_type: null,
    campaign_name: null,
    brand_name: null,
    campaign_month: null,
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: "creator_support",
    source_channel: "instagram",
    status: "open",
    priority: "normal",
    assigned_team: INSTAGRAM_TICKET_ASSIGNED_TEAM,
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: description,
    internal_notes: null,
    acknowledgement_email_requested: false,
    external_contact_id: event.externalContactId,
    external_conversation_id: event.externalConversationId,
    intake_details: {
      origin: "instagram_dm",
      incomplete: incompleteFields.length > 0,
      incompleteFields,
    },
    metadata: {
      origin: "instagram_dm",
      intakeIncomplete: incompleteFields.length > 0,
      incompleteFields,
      externalContactId: event.externalContactId,
      externalConversationId: event.externalConversationId,
    },
  };
}

export function isActiveTicketStatus(status: string | null | undefined): boolean {
  const normalized = status?.trim().toLowerCase() ?? "";
  return (ACTIVE_TICKET_STATUSES as readonly string[]).includes(normalized);
}
