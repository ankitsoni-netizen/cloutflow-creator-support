import { webhookProviderForChannel } from "@/lib/meta/types";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";

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
    if (message.type !== "text") continue;

    const externalMessageId = asNonEmptyString(message.id);
    const from = asNonEmptyString(message.from);
    const textRecord = isRecord(message.text) ? message.text : null;
    const messageBody = textRecord
      ? asNonEmptyString(textRecord.body)
      : null;
    if (!externalMessageId || !from || !messageBody) continue;

    const displayName = namesByWaId.get(from) ?? null;
    events.push({
      channel: "whatsapp",
      provider: webhookProviderForChannel("whatsapp"),
      externalEventId: externalMessageId,
      externalMessageId,
      externalConversationId: from,
      externalContactId: from,
      displayName,
      senderName: displayName,
      senderAddress: from,
      messageType: "text",
      messageBody,
      timestamp: parseUnixTimestamp(message.timestamp, "s"),
      phoneNumberId,
      recipientAccountId: null,
      eventFragment: value,
    });
  }

  return events;
}

function normalizeInstagramMessagingItem(
  item: unknown,
): NormalizedMetaInboundText | null {
  if (!isRecord(item)) return null;

  const message = isRecord(item.message) ? item.message : null;
  if (!message) return null;
  if (message.is_echo === true) return null;
  if (message.is_deleted === true) return null;
  if (message.is_unsupported === true) return null;

  const messageBody = asNonEmptyString(message.text);
  if (!messageBody) return null;

  const sender = isRecord(item.sender) ? item.sender : null;
  const externalContactId = sender ? asNonEmptyString(sender.id) : null;
  const externalMessageId = asNonEmptyString(message.mid);
  if (!externalContactId || !externalMessageId) return null;

  const recipient = isRecord(item.recipient) ? item.recipient : null;
  const recipientAccountId = recipient ? asNonEmptyString(recipient.id) : null;
  const senderName = sender ? asNonEmptyString(sender.name) : null;

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
    messageType: "text",
    messageBody,
    timestamp: parseUnixTimestamp(item.timestamp, "ms"),
    phoneNumberId: null,
    recipientAccountId,
    eventFragment: item,
  };
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
