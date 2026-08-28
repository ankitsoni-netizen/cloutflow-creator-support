import {
  WATI_WHATSAPP_PROVIDER,
  type WatiNormalizedEventType,
} from "@/lib/wati/constants";
import type {
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

/** Digits-only WhatsApp id; strips leading + and non-digits. */
export function normalizeWaId(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(digits)) return null;
  return digits;
}

/**
 * Strict allowlist mapping from raw WATI eventType → canonical external_event_id prefix.
 * Unknown types return null (callback is ignored).
 */
const WATI_EVENT_TYPE_ALLOWLIST: Record<string, WatiNormalizedEventType> = {
  message: "messageReceived",
  message_bsuid: "messageReceived",
  messagereceived: "messageReceived",
  message_received: "messageReceived",
  messageReceived: "messageReceived",
  sessionmessagesent_v2: "sessionMessageSent_v2",
  sessionmessagesent: "sessionMessageSent_v2",
  sessionMessageSent_v2: "sessionMessageSent_v2",
  templatemessagesent_v2: "templateMessageSent_v2",
  templatemessagesent: "templateMessageSent_v2",
  templateMessageSent_v2: "templateMessageSent_v2",
  sentmessagedelivered_v2: "sentMessageDELIVERED_v2",
  sentmessagedelivered: "sentMessageDELIVERED_v2",
  sentMessageDELIVERED_v2: "sentMessageDELIVERED_v2",
  sentMessageDELIVERED: "sentMessageDELIVERED_v2",
  sentmessageread_v2: "sentMessageREAD_v2",
  sentmessageread: "sentMessageREAD_v2",
  sentMessageREAD_v2: "sentMessageREAD_v2",
  sentMessageREAD: "sentMessageREAD_v2",
  sessionmessagefailed_v2: "sessionMessageFailed_v2",
  sessionmessagefailed: "sessionMessageFailed_v2",
  sessionMessageFailed_v2: "sessionMessageFailed_v2",
};

const STATUS_EVENT_TYPES = new Set<WatiNormalizedEventType>([
  "sessionMessageSent_v2",
  "templateMessageSent_v2",
  "sentMessageDELIVERED_v2",
  "sentMessageREAD_v2",
  "sessionMessageFailed_v2",
]);

/**
 * Normalize a raw WATI eventType through the strict allowlist.
 * For inbound message payloads without eventType, defaults to messageReceived
 * only when `fallbackInbound` is true.
 */
export function normalizeWatiEventType(
  raw: string | null | undefined,
  options: { fallbackInbound?: boolean } = {},
): WatiNormalizedEventType | null {
  if (raw && raw.trim()) {
    const trimmed = raw.trim();
    const direct = WATI_EVENT_TYPE_ALLOWLIST[trimmed];
    if (direct) return direct;
    const lower = WATI_EVENT_TYPE_ALLOWLIST[trimmed.toLowerCase()];
    if (lower) return lower;
    return null;
  }
  if (options.fallbackInbound) return "messageReceived";
  return null;
}

/**
 * Deterministic webhook_events.external_event_id:
 * `{normalizedEventType}:{whatsappMessageId|watiCallbackId}`
 */
export function buildWatiExternalEventId(
  eventType: WatiNormalizedEventType,
  whatsappMessageId: string | null,
  watiCallbackId: string | null,
): string | null {
  const idPart = whatsappMessageId ?? watiCallbackId;
  if (!idPart) return null;
  return `${eventType}:${idPart}`;
}

function parseWatiTimestamp(value: unknown, created?: unknown): string {
  const createdIso = asNonEmptyString(created);
  if (createdIso) {
    const parsed = Date.parse(createdIso);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Date().toISOString();
  }
  const ms = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

const MEDIA_PLACEHOLDERS: Record<string, string> = {
  image: "[image]",
  video: "[video]",
  audio: "[audio]",
  voice: "[audio]",
  document: "[document]",
  sticker: "[sticker]",
};

function replyField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function interactiveCandidateFromRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = [
    "listReply",
    "list_reply",
    "interactiveButtonReply",
    "interactive_button_reply",
    "buttonReply",
    "button_reply",
  ];
  for (const key of keys) {
    const candidate = replyField(record, key);
    if (isRecord(candidate)) return candidate;
  }
  return null;
}

/**
 * Known conversation-machine payloads look like ROUTE_CREATOR_SUPPORT.
 * Button labels such as "Creator Support" are not payloads.
 */
function isSemanticQuickReplyPayload(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{1,255}$/.test(value);
}

function interactiveReply(record: Record<string, unknown>): {
  payload: string | null;
  title: string | null;
} {
  const direct = interactiveCandidateFromRecord(record);
  const nested = isRecord(record.interactive)
    ? interactiveCandidateFromRecord(record.interactive)
    : null;
  const candidate = direct ?? nested;
  if (!candidate) return { payload: null, title: null };

  const title =
    asNonEmptyString(candidate.title) ??
    asNonEmptyString(candidate.text) ??
    asNonEmptyString(candidate.description);
  const rawPayload =
    asNonEmptyString(candidate.id) ??
    asNonEmptyString(candidate.payload) ??
    asNonEmptyString(candidate.postbackText) ??
    asNonEmptyString(candidate.postback_text);
  const payload =
    rawPayload && isSemanticQuickReplyPayload(rawPayload) ? rawPayload : null;
  if (payload || title) {
    return { payload, title: title ?? rawPayload };
  }
  return { payload: null, title: null };
}

/**
 * Minimal fragment for channel_messages.raw_payload — no URLs, tokens, or PII.
 */
export function sanitizeWatiEventFragment(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const type = asNonEmptyString(record.type) ?? "text";
  return {
    provider: WATI_WHATSAPP_PROVIDER,
    type,
    hasWhatsappMessageId: Boolean(asNonEmptyString(record.whatsappMessageId)),
    hasConversationId: Boolean(asNonEmptyString(record.conversationId)),
    owner: record.owner === true,
    eventType: asNonEmptyString(record.eventType),
  };
}

/**
 * Minimal payload stored on webhook_events — never sourceUrl/avatarUrl/media/text.
 */
export function sanitizeWatiWebhookStoragePayload(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return {
    provider: WATI_WHATSAPP_PROVIDER,
    eventType: asNonEmptyString(record.eventType),
    type: asNonEmptyString(record.type),
    statusString: asNonEmptyString(record.statusString),
    hasWhatsappMessageId: Boolean(asNonEmptyString(record.whatsappMessageId)),
    hasLocalMessageId: Boolean(asNonEmptyString(record.localMessageId)),
    hasWaId: Boolean(normalizeWaId(record.waId)),
    hasConversationId: Boolean(asNonEmptyString(record.conversationId)),
    owner: record.owner === true,
  };
}

function looksLikeWatiMessageRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (asNonEmptyString(value.whatsappMessageId) || asNonEmptyString(value.waId)) {
    return true;
  }
  const normalized = normalizeWatiEventType(asNonEmptyString(value.eventType));
  if (normalized === "messageReceived" || (normalized && STATUS_EVENT_TYPES.has(normalized))) {
    return true;
  }
  return (
    asNonEmptyString(value.type) !== null &&
    (asNonEmptyString(value.text) !== null ||
      isRecord(value.listReply) ||
      isRecord(value.list_reply) ||
      isRecord(value.interactiveButtonReply) ||
      isRecord(value.interactive_button_reply) ||
      isRecord(value.buttonReply) ||
      isRecord(value.button_reply) ||
      isRecord(value.interactive) ||
      asNonEmptyString(value.id) !== null)
  );
}

/**
 * Unwrap direct object, `{ messages: [...] }`, `{ data: ... }`, or top-level arrays
 * when the records are safely identifiable as WATI payloads.
 */
export function extractWatiMessageRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(looksLikeWatiMessageRecord);
  }
  if (!isRecord(payload)) return [];

  if (looksLikeWatiMessageRecord(payload)) {
    return [payload];
  }

  const nestedKeys = ["messages", "data", "result", "payload"] as const;
  for (const key of nestedKeys) {
    const nested: unknown = payload[key];
    if (Array.isArray(nested)) {
      const found = nested.filter(looksLikeWatiMessageRecord);
      if (found.length > 0) return found;
    }
    if (looksLikeWatiMessageRecord(nested)) {
      return [nested];
    }
  }

  return [];
}

export type WatiNormalizeOptions = {
  expectedChannelPhoneNumber?: string | null;
};

export type WatiNormalizeResult = {
  events: NormalizedMetaInboundText[];
  statuses: NormalizedWhatsAppStatus[];
  ignored: Array<{ reason: string }>;
  rejected: Array<{ reason: string }>;
};

function statusFromNormalizedEventType(
  eventType: WatiNormalizedEventType,
): NormalizedWhatsAppStatus["status"] | null {
  switch (eventType) {
    case "sessionMessageSent_v2":
    case "templateMessageSent_v2":
      return "sent";
    case "sentMessageDELIVERED_v2":
      return "delivered";
    case "sentMessageREAD_v2":
      return "read";
    case "sessionMessageFailed_v2":
      return "failed";
    default:
      return null;
  }
}

function mapStatusString(
  statusString: string | null,
  eventType: WatiNormalizedEventType | null,
): NormalizedWhatsAppStatus["status"] | null {
  if (eventType) {
    const fromType = statusFromNormalizedEventType(eventType);
    if (fromType) return fromType;
  }
  const status = (statusString ?? "").toLowerCase();
  if (status === "failed" || status === "deleted") {
    return status === "deleted" ? "deleted" : "failed";
  }
  if (status === "read") return "read";
  if (status === "delivered") return "delivered";
  if (status === "sent") return "sent";
  return null;
}

function isDeliveryCallback(record: Record<string, unknown>): boolean {
  const normalized = normalizeWatiEventType(asNonEmptyString(record.eventType));
  if (normalized && STATUS_EVENT_TYPES.has(normalized)) return true;
  if (record.owner === true && asNonEmptyString(record.statusString)) {
    return true;
  }
  return false;
}

function isInboundMessageCandidate(record: Record<string, unknown>): boolean {
  if (record.owner === true) return false;
  const hasEventType = Boolean(asNonEmptyString(record.eventType));
  const normalized = normalizeWatiEventType(asNonEmptyString(record.eventType), {
    fallbackInbound: !hasEventType,
  });
  if (normalized && STATUS_EVENT_TYPES.has(normalized)) return false;
  if (normalized === "messageReceived") return looksLikeWatiMessageRecord(record);
  // Unknown event type — do not treat as inbound.
  if (hasEventType) return false;
  return looksLikeWatiMessageRecord(record);
}

function channelPhoneAllowed(
  incoming: string | null,
  expected: string | null | undefined,
): boolean {
  if (!expected) return true;
  if (!incoming) return true;
  return normalizeWaId(incoming) === normalizeWaId(expected);
}

function normalizeInboundRecord(
  record: Record<string, unknown>,
  options: WatiNormalizeOptions,
):
  | { ok: true; event: NormalizedMetaInboundText }
  | { ok: false; reason: string; rejected?: boolean } {
  if (record.owner === true) {
    return { ok: false, reason: "owner_outbound_ignored" };
  }

  const channelPhone = asNonEmptyString(record.channelPhoneNumber);
  if (!channelPhoneAllowed(channelPhone, options.expectedChannelPhoneNumber)) {
    return { ok: false, reason: "wrong_channel", rejected: true };
  }

  const eventType = normalizeWatiEventType(asNonEmptyString(record.eventType), {
    fallbackInbound: true,
  });
  if (!eventType || eventType !== "messageReceived") {
    return { ok: false, reason: "unknown_event_type" };
  }

  const waId = normalizeWaId(record.waId);
  if (!waId) {
    return { ok: false, reason: "missing_wa_id" };
  }

  const whatsappMessageId = asNonEmptyString(record.whatsappMessageId);
  const watiCallbackId = asNonEmptyString(record.id);
  if (!whatsappMessageId && !watiCallbackId) {
    return { ok: false, reason: "missing_message_id" };
  }

  const externalEventId = buildWatiExternalEventId(
    eventType,
    whatsappMessageId,
    watiCallbackId,
  );
  if (!externalEventId) {
    return { ok: false, reason: "missing_message_id" };
  }

  // channel_messages.external_message_id prefers WhatsApp message id.
  const externalMessageId = whatsappMessageId ?? watiCallbackId!;

  const receivingAccountId =
    normalizeWaId(channelPhone) ??
    normalizeWaId(options.expectedChannelPhoneNumber);
  if (!receivingAccountId) {
    return { ok: false, reason: "missing_channel" };
  }

  const conversationId = whatsappExternalConversationId(
    receivingAccountId,
    waId,
  );

  const typeRaw = (asNonEmptyString(record.type) ?? "text").toLowerCase();
  const interactive = interactiveReply(record);
  const textBody = asNonEmptyString(record.text);

  let messageType: NormalizedMetaInboundText["messageType"] = "text";
  let messageBody: string | null = textBody;
  let quickReplyPayload: string | null = null;
  let unsupportedKind: string | null = null;

  if (
    typeRaw === "button" ||
    typeRaw === "interactive" ||
    interactive.payload ||
    interactive.title
  ) {
    messageType = "interactive";
    // Prefer the tapped option over generic payload text.
    messageBody = interactive.title ?? interactive.payload ?? textBody;
    quickReplyPayload = interactive.payload;
  } else if (typeRaw !== "text") {
    const placeholder = MEDIA_PLACEHOLDERS[typeRaw];
    messageType = "unsupported";
    unsupportedKind = typeRaw;
    messageBody = placeholder ?? `[${typeRaw}]`;
    quickReplyPayload = null;
  }

  if (!messageBody && !quickReplyPayload) {
    return { ok: false, reason: "empty_message" };
  }
  if (messageType === "text" && !messageBody) {
    return { ok: false, reason: "empty_text" };
  }

  const senderName = asNonEmptyString(record.senderName);

  return {
    ok: true,
    event: {
      channel: "whatsapp",
      provider: WATI_WHATSAPP_PROVIDER,
      externalEventId,
      externalMessageId,
      externalConversationId: conversationId,
      externalContactId: waId,
      displayName: senderName,
      senderName,
      senderAddress: waId,
      messageType,
      messageBody: messageBody ?? quickReplyPayload ?? "",
      timestamp: parseWatiTimestamp(record.timestamp, record.created),
      phoneNumberId: receivingAccountId,
      recipientAccountId: receivingAccountId,
      quickReplyPayload,
      unsupportedKind,
      eventFragment: sanitizeWatiEventFragment(record),
    },
  };
}

function normalizeStatusRecord(
  record: Record<string, unknown>,
  options: WatiNormalizeOptions,
):
  | { ok: true; status: NormalizedWhatsAppStatus }
  | { ok: false; reason: string; rejected?: boolean } {
  const channelPhone = asNonEmptyString(record.channelPhoneNumber);
  if (!channelPhoneAllowed(channelPhone, options.expectedChannelPhoneNumber)) {
    return { ok: false, reason: "wrong_channel", rejected: true };
  }

  const eventType = normalizeWatiEventType(asNonEmptyString(record.eventType));
  if (!eventType || !STATUS_EVENT_TYPES.has(eventType)) {
    return { ok: false, reason: eventType ? "not_status_event" : "unknown_event_type" };
  }

  const statusString = asNonEmptyString(record.statusString);
  const mapped = mapStatusString(statusString, eventType);
  if (!mapped) {
    return { ok: false, reason: "unknown_status" };
  }

  const whatsappMessageId = asNonEmptyString(record.whatsappMessageId);
  const localMessageId = asNonEmptyString(record.localMessageId);
  const watiCallbackId = asNonEmptyString(record.id);
  if (!whatsappMessageId && !watiCallbackId) {
    return { ok: false, reason: "missing_status_id" };
  }

  const externalEventId = buildWatiExternalEventId(
    eventType,
    whatsappMessageId,
    watiCallbackId,
  );
  if (!externalEventId) {
    return { ok: false, reason: "missing_status_id" };
  }

  // Outbound correlation uses WhatsApp message id when present.
  const metaMessageId = whatsappMessageId ?? watiCallbackId!;

  let errorCode: string | null = null;
  if (mapped === "failed" || mapped === "deleted") {
    const code =
      asNonEmptyString(record.errorCode) ??
      (typeof record.errorCode === "number" ? `wati_${record.errorCode}` : null) ??
      asNonEmptyString(record.failedCode);
    errorCode = code ?? mapped;
  }

  return {
    ok: true,
    status: {
      channel: "whatsapp",
      provider: WATI_WHATSAPP_PROVIDER,
      externalEventId,
      metaMessageId,
      status: mapped,
      timestamp: parseWatiTimestamp(record.timestamp, record.created),
      phoneNumberId: channelPhone ? normalizeWaId(channelPhone) : null,
      errorCode,
      localMessageId: localMessageId ?? null,
      watiEventId: watiCallbackId ?? null,
    },
  };
}

/**
 * Normalize WATI webhook payloads into the shared WhatsApp ingest shapes.
 * Owner/outbound echoes are ignored for chatbot progression.
 */
export function normalizeWatiWebhookPayload(
  payload: unknown,
  options: WatiNormalizeOptions = {},
): WatiNormalizeResult {
  const records = extractWatiMessageRecords(payload);
  const events: NormalizedMetaInboundText[] = [];
  const statuses: NormalizedWhatsAppStatus[] = [];
  const ignored: Array<{ reason: string }> = [];
  const rejected: Array<{ reason: string }> = [];

  const candidates: Record<string, unknown>[] = [...records];
  if (isRecord(payload) && !records.includes(payload) && isDeliveryCallback(payload)) {
    candidates.push(payload);
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (isRecord(item) && isDeliveryCallback(item) && !candidates.includes(item)) {
        candidates.push(item);
      }
    }
  }

  const seen = new Set<Record<string, unknown>>();
  for (const record of candidates) {
    if (seen.has(record)) continue;
    seen.add(record);

    if (isDeliveryCallback(record) && !isInboundMessageCandidate(record)) {
      const status = normalizeStatusRecord(record, options);
      if (status.ok) {
        statuses.push(status.status);
      } else if (status.rejected) {
        rejected.push({ reason: status.reason });
      } else {
        ignored.push({ reason: status.reason });
      }
      continue;
    }

    if (record.owner === true) {
      const status = normalizeStatusRecord(record, options);
      if (status.ok) {
        statuses.push(status.status);
      } else {
        ignored.push({ reason: "owner_outbound_ignored" });
      }
      continue;
    }

    if (!isInboundMessageCandidate(record)) {
      ignored.push({ reason: "not_inbound" });
      continue;
    }

    const inbound = normalizeInboundRecord(record, options);
    if (inbound.ok) {
      events.push(inbound.event);
    } else if (inbound.rejected) {
      rejected.push({ reason: inbound.reason });
    } else {
      ignored.push({ reason: inbound.reason });
    }
  }

  return { events, statuses, ignored, rejected };
}
