import {
  emptyCollectedData,
  incompleteCollectedFields,
  type ChannelCollectedData,
} from "@/lib/meta/collected-data";
import {
  emptyIntakeCollected,
  originalInboundForTicket,
  type IntakeCollectedData,
} from "@/lib/meta/intake-validate";
import { toPlainTicketDescription } from "@/lib/meta/plain-text";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import type { DbPlatform } from "@/lib/tickets/types";

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
  platform: DbPlatform;
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

function ticketPlatform(collected: IntakeCollectedData): DbPlatform {
  return collected.platform === "youtube" ? "youtube" : "instagram";
}

export function mapIntakeToInstagramTicketInsert(input: {
  collected: IntakeCollectedData;
  externalContactId: string;
  externalConversationId: string;
}): InstagramTicketInsert {
  const collected = input.collected;
  const description = originalInboundForTicket(collected);
  const platform = ticketPlatform(collected);
  const channelCollected = emptyCollectedData({
    creatorName: collected.creatorName,
    phone: collected.phoneNormalized,
    email: collected.email,
    socialHandle: collected.socialHandle,
    platform,
    campaignName: collected.campaignName,
    brand: collected.brandName,
    campaignMonth: collected.campaignMonth,
    issueDescription: description,
  });
  const incompleteFields = incompleteCollectedFields(channelCollected).filter(
    (field) =>
      field !== "issueType" &&
      field !== "cloutflowPocName" &&
      field !== "cloutflowPocContactNumber",
  );

  return {
    creator_name: collected.creatorName,
    creator_phone: collected.phoneNormalized,
    creator_email: collected.email,
    social_handle: collected.socialHandle,
    platform,
    issue_type: null,
    campaign_name: collected.campaignName,
    brand_name: collected.brandName,
    campaign_month: collected.campaignMonth,
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
    acknowledgement_email_requested: true,
    external_contact_id: input.externalContactId,
    external_conversation_id: input.externalConversationId,
    intake_details: {
      origin: "instagram_dm_intake",
      incomplete: incompleteFields.length > 0,
      incompleteFields,
      phoneDisplay: collected.phoneDisplay,
      socialHandleDisplay: collected.socialHandleDisplay,
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
  return mapIntakeToInstagramTicketInsert({
    collected: emptyIntakeCollected({
      creatorName: event.displayName,
      platform: "instagram",
      originalInboundText: event.messageBody,
      originalInboundMessageId: event.externalMessageId,
    }),
    externalContactId: event.externalContactId,
    externalConversationId: event.externalConversationId,
  });
}

export function isActiveTicketStatus(status: string | null | undefined): boolean {
  const normalized = status?.trim().toLowerCase() ?? "";
  return (ACTIVE_TICKET_STATUSES as readonly string[]).includes(normalized);
}
