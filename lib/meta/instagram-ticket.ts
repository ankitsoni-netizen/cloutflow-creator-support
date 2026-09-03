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
import { toPlainTicketDescription, toUntrustedPlainText } from "@/lib/meta/plain-text";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import type { DbPlatform, DbTicket } from "@/lib/tickets/types";
import { isIdentitySchemaPhaseC } from "@/lib/meta/identity-schema-phase";

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
  source_channel: "instagram" | "whatsapp";
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
  identity_status?: "unambiguous";
  recipient_account_id?: string;
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
  if (collected.igIssueCategory) return "instagram";
  return collected.platform === "youtube" ? "youtube" : "instagram";
}

function ticketDescription(collected: IntakeCollectedData): string | null {
  if (collected.igIssueCategory && collected.issueDescription) {
    const plain = toUntrustedPlainText(collected.issueDescription);
    return plain.length > 0 ? plain : null;
  }
  return originalInboundForTicket(collected);
}

function ticketIssueType(collected: IntakeCollectedData): string | null {
  if (collected.igIssueCategory === "payment") return "payment_delayed";
  if (collected.igIssueCategory === "campaign") return "other";
  return collected.issueType;
}

function selectedRoute(collected: IntakeCollectedData): string | null {
  if (collected.igIssueCategory === "payment") return "creator_payment_issue";
  if (collected.igIssueCategory === "campaign") return "creator_campaign_issue";
  return null;
}

export function mapIntakeToInstagramTicketInsert(input: {
  collected: IntakeCollectedData;
  externalContactId: string;
  externalConversationId: string;
  sourceChannel?: "instagram" | "whatsapp";
  recipientAccountId?: string | null;
}): InstagramTicketInsert {
  const collected = input.collected;
  const description = ticketDescription(collected);
  const platform = ticketPlatform(collected);
  const sourceChannel = input.sourceChannel ?? "instagram";
  const origin =
    sourceChannel === "whatsapp" ? "whatsapp_cloud_intake" : "instagram_dm_intake";
  const route = selectedRoute(collected);
  const personaTicket = Boolean(collected.igIssueCategory);
  const channelCollected = emptyCollectedData({
    creatorName: collected.creatorName,
    phone: collected.phoneNormalized,
    email: collected.email,
    socialHandle: collected.cachedUsername ?? collected.socialHandle,
    platform,
    campaignName: collected.campaignName,
    brand: collected.brandName,
    campaignMonth: collected.campaignMonth,
    issueDescription: description,
  });
  const incompleteFields = personaTicket
    ? []
    : incompleteCollectedFields(channelCollected).filter(
        (field) =>
        field !== "issueType" &&
        field !== "campaignName" &&
        field !== "cloutflowPocName" &&
        field !== "cloutflowPocContactNumber",
      );
  const issueType = ticketIssueType(collected);

  return {
    creator_name: collected.creatorName,
    creator_phone: collected.phoneNormalized,
    creator_email: collected.email,
    social_handle: collected.cachedUsername ?? collected.socialHandle,
    platform,
    issue_type: issueType,
    campaign_name: collected.campaignName,
    brand_name: collected.brandName,
    campaign_month: collected.campaignMonth,
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: "creator_support",
    source_channel: sourceChannel,
    status: "open",
    priority: "normal",
    assigned_team: INSTAGRAM_TICKET_ASSIGNED_TEAM,
    // Executive assignment is applied by the tickets INSERT trigger.
    assigned_executive_id: null,
    assigned_executive_name: null,
    issue_description: description,
    internal_notes: null,
    acknowledgement_email_requested: true,
    external_contact_id: input.externalContactId,
    external_conversation_id: input.externalConversationId,
    intake_details: {
      origin,
      incomplete: incompleteFields.length > 0,
      incompleteFields,
      phoneDisplay: collected.phoneDisplay,
      socialHandleDisplay: collected.socialHandleDisplay,
      originalInboundMessageId: collected.originalInboundMessageId,
      igPersona: collected.igPersona,
      igCreatorReason: collected.igCreatorReason,
      igIssueCategory: collected.igIssueCategory,
      route,
    },
    metadata: {
      origin,
      intakeIncomplete: incompleteFields.length > 0,
      incompleteFields,
      externalContactId: input.externalContactId,
      externalConversationId: input.externalConversationId,
      recipientAccountId: input.recipientAccountId ?? null,
      igPersona: collected.igPersona,
      igIssueCategory: collected.igIssueCategory,
      route,
    },
  };
}

export function stampWatiTicketIdentity(
  insert: InstagramTicketInsert,
  identity: {
    provider: string;
    recipientAccountId: string;
  },
): InstagramTicketInsert {
  const stamped: InstagramTicketInsert = {
    ...insert,
    metadata: {
      ...insert.metadata,
      provider: identity.provider,
      recipientAccountId: identity.recipientAccountId,
    },
  };
  if (isIdentitySchemaPhaseC()) {
    stamped.identity_status = "unambiguous";
    stamped.recipient_account_id = identity.recipientAccountId;
  }
  return stamped;
}

export function dbTicketFromIntakeInsert(input: {
  id: string;
  ticketCode: string;
  insert: InstagramTicketInsert;
}): DbTicket {
  return {
    id: input.id,
    ticket_code: input.ticketCode,
    creator_name: input.insert.creator_name,
    creator_phone: input.insert.creator_phone,
    creator_email: input.insert.creator_email,
    social_handle: input.insert.social_handle,
    platform: input.insert.platform,
    issue_type: input.insert.issue_type,
    campaign_name: input.insert.campaign_name,
    brand_name: input.insert.brand_name,
    campaign_month: input.insert.campaign_month,
    cloutflow_poc_name: input.insert.cloutflow_poc_name,
    cloutflow_poc_contact_number: input.insert.cloutflow_poc_contact_number,
    request_category: input.insert.request_category,
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: input.insert.intake_details,
    source_channel: input.insert.source_channel,
    status: input.insert.status,
    priority: input.insert.priority,
    assigned_team: input.insert.assigned_team,
    assigned_executive_id: input.insert.assigned_executive_id,
    assigned_executive_name: input.insert.assigned_executive_name,
    issue_description: input.insert.issue_description,
    internal_notes: input.insert.internal_notes,
    acknowledgement_email_requested: input.insert.acknowledgement_email_requested,
    acknowledgement_email_sent_at: null,
    resolution_summary: null,
    first_response_at: null,
    resolved_at: null,
    customer_last_notified_at: null,
    metadata: input.insert.metadata,
    external_contact_id: input.insert.external_contact_id,
    external_conversation_id: input.insert.external_conversation_id,
    identity_status: input.insert.identity_status ?? null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
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
