import {
  META_INSTAGRAM_PROVIDER,
  META_WHATSAPP_PROVIDER,
  type MetaWebhookProvider,
} from "@/lib/meta/constants";

export const META_CHANNELS = ["whatsapp", "instagram"] as const;
export type MetaChannel = (typeof META_CHANNELS)[number];

export const META_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MetaMessageDirection = (typeof META_MESSAGE_DIRECTIONS)[number];

export type NormalizedMetaInboundText = {
  channel: MetaChannel;
  provider: MetaWebhookProvider;
  externalEventId: string;
  externalMessageId: string;
  externalConversationId: string;
  externalContactId: string;
  displayName: string | null;
  senderName: string | null;
  senderAddress: string;
  messageType: "text";
  messageBody: string;
  timestamp: string;
  phoneNumberId: string | null;
  recipientAccountId: string | null;
  eventFragment: Record<string, unknown>;
};

export function webhookProviderForChannel(
  channel: MetaChannel,
): MetaWebhookProvider {
  return channel === "instagram"
    ? META_INSTAGRAM_PROVIDER
    : META_WHATSAPP_PROVIDER;
}

export const CONVERSATION_STATES = [
  "new",
  "collecting_name",
  "collecting_email",
  "collecting_phone",
  "collecting_social_handle",
  "collecting_platform",
  "collecting_issue_type",
  "collecting_campaign",
  "collecting_brand",
  "collecting_campaign_month",
  "collecting_poc",
  "collecting_description",
  "confirming",
  "ticket_created",
  "human_handoff",
  "closed",
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const WEBHOOK_PROCESSING_STATUSES = [
  "received",
  "processing",
  "completed",
  "failed",
] as const;

export type WebhookProcessingStatus =
  (typeof WEBHOOK_PROCESSING_STATUSES)[number];
