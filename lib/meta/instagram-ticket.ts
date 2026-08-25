import {
  emptyCollectedData,
  incompleteCollectedFields,
  type ChannelCollectedData,
} from "@/lib/meta/collected-data";
import type { IntakeCollectedData } from "@/lib/meta/intake-validate";
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
  creator_phone: string | null;
  creator_email: string | null;
  social_handle: string | null;
  platform: "instagram";
  issue_type: string | null;
  campaign_name: string | null;
  brand_name: string | null;
  campaign_month: string | null;
  cloutflow_poc_name: string | null;
  cloutflow_poc_contact_number: string | null;
  request_category: "creator_support";
  source_channel: "instagram";
  status: "open";
  priority: "normal";
  assigned_team: typeof INSTAGRAM_TICKET_ASSIGNED_TEAM;
  assigned_executive_id: null;
  assigned_executive_name: null;
  issue_description: string | null;
  internal_notes: null;
  acknowledgement_email_requested: true;
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

export function mapIntakeToInstagramTicketInsert(input: {
  collected: IntakeCollectedData;
  externalContactId: string;
  externalConversationId: string;
}): InstagramTicketInsert {
  const collected = input.collected;
  const description =
    collected.issueDescription ?? collected.originalInboundText;
  const channelCollected = emptyCollectedData({
    creatorName: collected.creatorName,
    phone: collected.phoneNormalized,
    email: collected.email,
    socialHandle: collected.socialHandle,
    platform: "instagram",
    issueType: collected.issueType,
    campaignName: collected.campaignName,
    brand: collected.brandName,
    campaignMonth: collected.campaignMonth,
    cloutflowPocName: collected.cloutflowPocName,
    cloutflowPocContactNumber: collected.cloutflowPocContact,
    issueDescription: description,
  });
  const incompleteFields = incompleteCollectedFields(channelCollected);

  return {
    creator_name: collected.creatorName,
    creator_phone: collected.phoneNormalized,
    creator_email: collected.email,
    social_handle: collected.socialHandle,
    platform: "instagram",
    issue_type: collected.issueType,
    campaign_name: collected.campaignName,
    brand_name: collected.brandName,
    campaign_month: collected.campaignMonth,
    cloutflow_poc_name: collected.cloutflowPocName,
    cloutflow_poc_contact_number: collected.cloutflowPocContact,
    request_category: "creator_support",
    source_channel: "instagram",
    status: "open",
    priority: "normal",
    assigned_team: INSTAGRAM_TICKET_ASSIGNED_TEAM,
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: description,
    internal_notes: null,
    acknowledgement_email_requested: true,
    external_contact_id: input.externalContactId,
    external_conversation_id: input.externalConversationId,
    intake_details: {
      origin: "instagram_dm_intake",
      incomplete: incompleteFields.length > 0,
      incompleteFields,
      phoneDisplay: collected.phoneDisplay,
      originalInboundMessageId: collected.originalInboundMessageId,
    },
    metadata: {
      origin: "instagram_dm_intake",
      intakeIncomplete: incompleteFields.length > 0,
      incompleteFields,
      externalContactId: input.externalContactId,
      externalConversationId: input.externalConversationId,
    },
  };
}

/** @deprecated Immediate first-DM tickets are no longer created. Kept for mapping tests. */
export function mapInstagramEventToTicketInsert(
  event: NormalizedMetaInboundText,
): InstagramTicketInsert {
  const description = toPlainTicketDescription(event.messageBody);
  return mapIntakeToInstagramTicketInsert({
    collected: {
      creatorName: event.displayName,
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
      issueDescription: description.length > 0 ? description : null,
      originalInboundText: description.length > 0 ? description : null,
      originalInboundMessageId: event.externalMessageId,
      routingSessionId: null,
    },
    externalContactId: event.externalContactId,
    externalConversationId: event.externalConversationId,
  });
}

export function isActiveTicketStatus(status: string | null | undefined): boolean {
  const normalized = status?.trim().toLowerCase() ?? "";
  return (ACTIVE_TICKET_STATUSES as readonly string[]).includes(normalized);
}
