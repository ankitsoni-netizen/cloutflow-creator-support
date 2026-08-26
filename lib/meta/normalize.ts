import { webhookProviderForChannel } from "@/lib/meta/types";
import { META_WHATSAPP_PROVIDER } from "@/lib/meta/constants";
import type {
  NormalizedInstagramEcho,
  NormalizedMetaInboundText,
  NormalizedWhatsAppStatus,
} from "@/lib/meta/types";
import { whatsappExternalConversationId } from "@/lib/meta/whatsapp-ids";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseUnixTimestamp(value: unknown, unit: "s" | "ms"): string {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Date().toISOString();
  }
  const ms = unit === "s" ? numeric * 1000 : numeric;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

const WHATSAPP_UNSUPPORTED_TYPES = new Set([
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "reaction",
  "order",
  "system",
  "unknown",
]);

function whatsappInteractiveReply(message: Record<string, unknown>): {
  payload: string | null;
  title: string | null;
} {
  const interactive = isRecord(message.interactive) ? message.interactive : null;
  if (interactive) {
    const button = isRecord(interactive.button_reply)
      ? interactive.button_reply
      : null;
    if (button) {
      return {
        payload: asNonEmptyString(button.id),
        title: asNonEmptyString(button.title),
      };
    }
    const list = isRecord(interactive.list_reply) ? interactive.list_reply : null;
    if (list) {
      return {
        payload: asNonEmptyString(list.id),
        title: asNonEmptyString(list.title),
      };
    }
  }
  const button = isRecord(message.button) ? message.button : null;
  if (button) {
    return {
      payload: asNonEmptyString(button.payload),
      title: asNonEmptyString(button.text),
    };
  }
  return { payload: null, title: null };
}

function sanitizeWhatsAppFragment(
  message: Record<string, unknown>,
  messageType: string,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    type: messageType,
    hasId: Boolean(asNonEmptyString(message.id)),
  };
}

function normalizeWhatsAppValue(
  value: unknown,
): NormalizedMetaInboundText[] {
  if (!isRecord(value)) return [];
  if (value.messaging_product !== "whatsapp") return [];

  const messages = Array.isArray(value.messages) ? value.messages : [];
  if (messages.length === 0) return [];

  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const phoneNumberId = metadata
    ? asNonEmptyString(metadata.phone_number_id)
    : null;

  const namesByWaId = new Map<string, string>();
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  for (const contact of contacts) {
    if (!isRecord(contact)) continue;
    const waId = asNonEmptyString(contact.wa_id);
    const profile = isRecord(contact.profile) ? contact.profile : null;
    const name = profile ? asNonEmptyString(profile.name) : null;
    if (waId && name) namesByWaId.set(waId, name);
  }

  const events: NormalizedMetaInboundText[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;

    const externalMessageId = asNonEmptyString(message.id);
    const from = asNonEmptyString(message.from);
    if (!externalMessageId || !from) continue;

    const type = asNonEmptyString(message.type) ?? "text";
    const interactive = whatsappInteractiveReply(message);
    const textRecord = isRecord(message.text) ? message.text : null;
    const textBody = textRecord ? asNonEmptyString(textRecord.body) : null;

    let messageType: NormalizedMetaInboundText["messageType"] = "text";
    let messageBody = textBody;
    let quickReplyPayload: string | null = interactive.payload;
    let unsupportedKind: string | null = null;

    if (type === "interactive" || type === "button") {
      messageType = "interactive";
      messageBody = textBody ?? interactive.title ?? interactive.payload;
    } else if (type !== "text") {
      if (!WHATSAPP_UNSUPPORTED_TYPES.has(type) && type !== "text") {
        unsupportedKind = type;
      } else {
        unsupportedKind = type;
      }
      messageType = "unsupported";
      messageBody = `[${type}]`;
      quickReplyPayload = null;
    }

    if (!messageBody && !quickReplyPayload) continue;
    if (messageType === "text" && !messageBody) continue;

    const displayName = namesByWaId.get(from) ?? null;
    const conversationId = phoneNumberId
      ? whatsappExternalConversationId(phoneNumberId, from)
      : from;
    events.push({
      channel: "whatsapp",
      provider: webhookProviderForChannel("whatsapp"),
      externalEventId: externalMessageId,
      externalMessageId,
      externalConversationId: conversationId,
      externalContactId: from,
      displayName,
      senderName: displayName,
      senderAddress: from,
      messageType,
      messageBody: messageBody ?? quickReplyPayload ?? "",
      timestamp: parseUnixTimestamp(message.timestamp, "s"),
      phoneNumberId,
      recipientAccountId: null,
      quickReplyPayload,
      unsupportedKind,
      eventFragment: sanitizeWhatsAppFragment(message, type),
    });
  }

  return events;
}

const WHATSAPP_STATUS_VALUES = new Set([
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
]);

function normalizeWhatsAppStatuses(value: unknown): NormalizedWhatsAppStatus[] {
  if (!isRecord(value)) return [];
  if (value.messaging_product !== "whatsapp") return [];
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  if (statuses.length === 0) return [];

  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const phoneNumberId = metadata
    ? asNonEmptyString(metadata.phone_number_id)
    : null;

  const events: NormalizedWhatsAppStatus[] = [];
  for (const row of statuses) {
    if (!isRecord(row)) continue;
    const metaMessageId = asNonEmptyString(row.id);
    const statusRaw = asNonEmptyString(row.status)?.toLowerCase() ?? "";
    if (!metaMessageId || !WHATSAPP_STATUS_VALUES.has(statusRaw)) continue;
    const errors = Array.isArray(row.errors) ? row.errors : [];
    const firstError = errors.find((item) => isRecord(item));
    const errorCode =
      firstError && isRecord(firstError)
        ? asNonEmptyString(firstError.code) ??
          (typeof firstError.code === "number" ? `graph_${firstError.code}` : null)
        : null;
    events.push({
      channel: "whatsapp",
      provider: META_WHATSAPP_PROVIDER,
      externalEventId: `status:${metaMessageId}:${statusRaw}`,
      metaMessageId,
      status: statusRaw as NormalizedWhatsAppStatus["status"],
      timestamp: parseUnixTimestamp(row.timestamp, "s"),
      phoneNumberId,
      errorCode,
    });
  }
  return events;
}

const INSTAGRAM_ATTACHMENT_KIND: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  sticker: "sticker",
  share: "share",
  story_mention: "share",
  ig_reel: "video",
  file: "attachment",
  template: "attachment",
  location: "attachment",
  fallback: "attachment",
};

function instagramAttachmentKind(message: Record<string, unknown>): string | null {
  if (message.is_unsupported === true) return "unsupported";
  if (message.sticker != null || asNonEmptyString(message.sticker_id)) {
    return "sticker";
  }
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    if (!isRecord(attachment)) continue;
    const type = asNonEmptyString(attachment.type)?.toLowerCase();
    if (type && INSTAGRAM_ATTACHMENT_KIND[type]) {
      return INSTAGRAM_ATTACHMENT_KIND[type];
    }
    return "attachment";
  }
  if (isRecord(message.audio) || isRecord(message.voice)) return "audio";
  if (isRecord(message.video)) return "video";
  if (isRecord(message.image)) return "image";
  if (isRecord(message.share)) return "share";
  return null;
}

function sanitizeInstagramFragment(
  hasId: boolean,
  kind: string,
): Record<string, unknown> {
  return {
    messaging_product: "instagram",
    type: kind,
    hasId,
    hasAttachments: kind !== "text" && kind !== "interactive",
  };
}

function normalizeInstagramMessagingItem(
  item: unknown,
): NormalizedMetaInboundText | null {
  if (!isRecord(item)) return null;
  if (isRecord(item.reaction)) return null;

  const message = isRecord(item.message) ? item.message : null;
  if (!message) return null;
  if (message.is_echo === true) return null;
  if (message.is_self === true) return null;
  if (message.is_deleted === true) return null;

  const quickReply = isRecord(message.quick_reply) ? message.quick_reply : null;
  const quickReplyPayload = quickReply
    ? asNonEmptyString(quickReply.payload)
    : null;
  const messageBody = asNonEmptyString(message.text);
  const attachmentKind = instagramAttachmentKind(message);
  if (!messageBody && !quickReplyPayload && !attachmentKind) return null;

  const sender = isRecord(item.sender) ? item.sender : null;
  const externalContactId = sender ? asNonEmptyString(sender.id) : null;
  const externalMessageId = asNonEmptyString(message.mid);
  if (!externalContactId || !externalMessageId) return null;

  const recipient = isRecord(item.recipient) ? item.recipient : null;
  const recipientAccountId = recipient ? asNonEmptyString(recipient.id) : null;
  const senderName = sender ? asNonEmptyString(sender.name) : null;
  const unsupportedKind =
    !messageBody && !quickReplyPayload && attachmentKind ? attachmentKind : null;
  const kind = unsupportedKind ?? (quickReplyPayload ? "interactive" : "text");

  return {
    channel: "instagram",
    provider: webhookProviderForChannel("instagram"),
    externalEventId: externalMessageId,
    externalMessageId,
    externalConversationId: externalContactId,
    externalContactId,
    displayName: senderName,
    senderName,
    senderAddress: externalContactId,
    messageType: unsupportedKind ? "unsupported" : "text",
    messageBody: messageBody ?? quickReplyPayload ?? `[${unsupportedKind}]`,
    timestamp: parseUnixTimestamp(item.timestamp, "ms"),
    phoneNumberId: null,
    recipientAccountId,
    quickReplyPayload,
    unsupportedKind,
    eventFragment: sanitizeInstagramFragment(true, kind),
  };
}

function normalizeInstagramEchoItem(
  item: unknown,
): NormalizedInstagramEcho | null {
  if (!isRecord(item)) return null;
  const message = isRecord(item.message) ? item.message : null;
  if (!message) return null;
  const isEcho = message.is_echo === true;
  const isSelf = message.is_self === true;
  if (!isEcho && !isSelf) return null;
  if (message.is_deleted === true) return null;

  const externalMessageId = asNonEmptyString(message.mid);
  const messageBody = asNonEmptyString(message.text);
  if (!externalMessageId || !messageBody) return null;

  const sender = isRecord(item.sender) ? item.sender : null;
  const recipient = isRecord(item.recipient) ? item.recipient : null;
  const senderId = sender ? asNonEmptyString(sender.id) : null;
  const recipientId = recipient ? asNonEmptyString(recipient.id) : null;
  if (!senderId || !recipientId) return null;

  return {
    channel: "instagram",
    provider: webhookProviderForChannel("instagram"),
    externalEventId: `echo:${externalMessageId}`,
    externalMessageId,
    externalConversationId: recipientId,
    recipientId,
    senderId,
    messageBody,
    timestamp: parseUnixTimestamp(item.timestamp, "ms"),
    isEcho,
    isSelf,
    eventFragment: sanitizeInstagramFragment(true, "echo"),
  };
}

/**
 * Echo / is_self Instagram messages. Never passed into chatbot routing.
 */
export function extractInstagramEchoes(
  payload: unknown,
): NormalizedInstagramEcho[] {
  if (!isRecord(payload) || payload.object !== "instagram") return [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const echoes: NormalizedInstagramEcho[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      const echo = normalizeInstagramEchoItem(item);
      if (echo) echoes.push(echo);
    }
  }
  return echoes;
}

/**
 * WhatsApp delivery status callbacks. Never routed into chatbot intake.
 */
export function extractWhatsAppStatuses(
  payload: unknown,
): NormalizedWhatsAppStatus[] {
  if (!isRecord(payload) || payload.object !== "whatsapp_business_account") {
    return [];
  }
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events: NormalizedWhatsAppStatus[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!isRecord(change)) continue;
      if (change.field && change.field !== "messages") continue;
      events.push(...normalizeWhatsAppStatuses(change.value));
    }
  }
  return events;
}

/**
 * Extracts supported inbound text messages from a Meta webhook JSON body.
 * Status callbacks, echoes, empty text, and unsupported types are omitted.
 */
export function normalizeMetaWebhookPayload(
  payload: unknown,
): NormalizedMetaInboundText[] {
  if (!isRecord(payload)) return [];

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events: NormalizedMetaInboundText[] = [];

  if (payload.object === "whatsapp_business_account") {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        if (!isRecord(change)) continue;
        if (change.field && change.field !== "messages") continue;
        events.push(...normalizeWhatsAppValue(change.value));
      }
    }
    return events;
  }

  if (payload.object === "instagram") {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
      for (const item of messaging) {
        const event = normalizeInstagramMessagingItem(item);
        if (event) events.push(event);
      }
    }
    return events;
  }

  return [];
}
