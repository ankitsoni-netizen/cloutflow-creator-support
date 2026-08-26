import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import type {
  NormalizedMetaInboundText,
  NormalizedWhatsAppStatus,
} from "@/lib/meta/types";

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

function interactiveReply(record: Record<string, unknown>): {
  payload: string | null;
  title: string | null;
} {
  const candidates = [
    record.listReply,
    record.interactiveButtonReply,
    record.buttonReply,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const payload =
      asNonEmptyString(candidate.id) ??
      asNonEmptyString(candidate.payload) ??
      asNonEmptyString(candidate.postbackText);
    const title =
      asNonEmptyString(candidate.title) ??
      asNonEmptyString(candidate.text) ??
      asNonEmptyString(candidate.description);
    if (payload || title) {
      return { payload, title };
    }
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
  const eventType = asNonEmptyString(value.eventType)?.toLowerCase() ?? "";
  if (
    eventType === "message" ||
    eventType === "message_bsuid" ||
    eventType.includes("messagereceived") ||
    eventType.includes("message_received")
  ) {
    return true;
  }
  return (
    asNonEmptyString(value.type) !== null &&
    (asNonEmptyString(value.text) !== null ||
      isRecord(value.listReply) ||
      isRecord(value.interactiveButtonReply) ||
      isRecord(value.buttonReply) ||
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

function mapStatusString(
  statusString: string | null,
  eventType: string | null,
): NormalizedWhatsAppStatus["status"] | null {
  const status = (statusString ?? "").toLowerCase();
  const event = (eventType ?? "").toLowerCase();

  if (
    status === "failed" ||
    status === "deleted" ||
    event.includes("failed") ||
    event.includes("deleted")
  ) {
    if (status === "deleted" || event.includes("deleted")) return "deleted";
    return "failed";
  }
  if (status === "read" || event.includes("read")) return "read";
  if (status === "delivered" || event.includes("delivered")) return "delivered";
  if (
    status === "sent" ||
    event.includes("sent") ||
    event.includes("sessionmessagesent") ||
    event.includes("templatemessagesent")
  ) {
    return "sent";
  }
  return null;
}

function isDeliveryCallback(record: Record<string, unknown>): boolean {
  const eventType = asNonEmptyString(record.eventType)?.toLowerCase() ?? "";
  if (
    eventType.includes("delivered") ||
    eventType.includes("read") ||
    eventType.includes("failed") ||
    eventType.includes("sessionmessagesent") ||
    eventType.includes("templatemessagesent") ||
    eventType.includes("sentmessage")
  ) {
    return true;
  }
  if (record.owner === true && asNonEmptyString(record.statusString)) {
    return true;
  }
  return false;
}

function isInboundMessageCandidate(record: Record<string, unknown>): boolean {
  if (record.owner === true) return false;
  if (isDeliveryCallback(record) && !asNonEmptyString(record.text) && !interactiveReply(record).payload) {
    // Pure status callbacks without inbound content.
    if (
      (asNonEmptyString(record.eventType)?.toLowerCase() ?? "").includes("sent") ||
      (asNonEmptyString(record.eventType)?.toLowerCase() ?? "").includes("delivered") ||
      (asNonEmptyString(record.eventType)?.toLowerCase() ?? "").includes("read")
    ) {
      return false;
    }
  }
  const eventType = asNonEmptyString(record.eventType)?.toLowerCase() ?? "";
  if (
    eventType.includes("sessionmessagesent") ||
    eventType.includes("templatemessagesent") ||
    eventType.includes("delivered") ||
    eventType.includes("read") ||
    eventType === "sentmessagedelivered_v2" ||
    eventType === "sentmessageread" ||
    eventType === "sentmessageread_v2"
  ) {
    return false;
  }
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

  const waId = normalizeWaId(record.waId);
  if (!waId) {
    return { ok: false, reason: "missing_wa_id" };
  }

  const whatsappMessageId = asNonEmptyString(record.whatsappMessageId);
  const watiId = asNonEmptyString(record.id);
  const externalMessageId = whatsappMessageId ?? watiId;
  if (!externalMessageId) {
    return { ok: false, reason: "missing_message_id" };
  }

  const conversationId =
    asNonEmptyString(record.conversationId) ?? waId;

  const typeRaw = (asNonEmptyString(record.type) ?? "text").toLowerCase();
  const interactive = interactiveReply(record);
  const textBody = asNonEmptyString(record.text);

  let messageType: NormalizedMetaInboundText["messageType"] = "text";
  let messageBody: string | null = textBody;
  let quickReplyPayload: string | null = interactive.payload;
  let unsupportedKind: string | null = null;

  if (
    typeRaw === "button" ||
    typeRaw === "interactive" ||
    interactive.payload ||
    interactive.title
  ) {
    messageType = "interactive";
    messageBody = textBody ?? interactive.title ?? interactive.payload;
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
      externalEventId: externalMessageId,
      externalMessageId,
      externalConversationId: conversationId,
      externalContactId: waId,
      displayName: senderName,
      senderName,
      senderAddress: waId,
      messageType,
      messageBody: messageBody ?? quickReplyPayload ?? "",
      timestamp: parseWatiTimestamp(record.timestamp, record.created),
      phoneNumberId: channelPhone ? normalizeWaId(channelPhone) : null,
      recipientAccountId: options.expectedChannelPhoneNumber
        ? normalizeWaId(options.expectedChannelPhoneNumber)
        : channelPhone
          ? normalizeWaId(channelPhone)
          : null,
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

  const statusString = asNonEmptyString(record.statusString);
  const eventType = asNonEmptyString(record.eventType);
  const mapped = mapStatusString(statusString, eventType);
  if (!mapped) {
    return { ok: false, reason: "unknown_status" };
  }

  const whatsappMessageId = asNonEmptyString(record.whatsappMessageId);
  const localMessageId = asNonEmptyString(record.localMessageId);
  const watiEventId = asNonEmptyString(record.id);
  // Primary correlation is WhatsApp message id; localMessageId is legacy-only.
  const correlationId = whatsappMessageId ?? localMessageId ?? watiEventId;
  if (!correlationId) {
    return { ok: false, reason: "missing_status_id" };
  }

  const externalEventId = `status:${correlationId}:${mapped}:${eventType ?? statusString ?? "status"}`;

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
      metaMessageId: whatsappMessageId ?? correlationId,
      status: mapped,
      timestamp: parseWatiTimestamp(record.timestamp, record.created),
      phoneNumberId: channelPhone ? normalizeWaId(channelPhone) : null,
      errorCode,
      localMessageId: localMessageId ?? null,
      watiEventId: watiEventId ?? null,
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

  // Also scan top-level delivery-only records that may not look like inbound messages.
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
      // Owner outbound: treat as delivery/status if possible, else ignore for chatbot.
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
