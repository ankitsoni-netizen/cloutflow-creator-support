/**
 * Privacy-safe Meta webhook shape diagnostics.
 * Never inspect or return message text, IDs, usernames, tokens, or payloads.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type MetaWebhookIgnoredReason =
  | "payload_not_object"
  | "payload_wrapped_array"
  | "unsupported_object"
  | "no_entries"
  | "no_messaging_events"
  | "instagram_field_value_shape"
  | "instagram_changes_shape"
  | "missing_message"
  | "echo"
  | "deleted"
  | "unsupported"
  | "missing_text"
  | "missing_sender"
  | "missing_message_id";

export type MetaWebhookNormalizeDiagnostic = {
  objectType: string | null;
  entryCount: number;
  messagingEventCount: number;
  hasMessage: boolean;
  hasSender: boolean;
  hasRecipient: boolean;
  hasMessageId: boolean;
  ignoredReason: MetaWebhookIgnoredReason | null;
};

const EMPTY_DIAGNOSTIC: MetaWebhookNormalizeDiagnostic = {
  objectType: null,
  entryCount: 0,
  messagingEventCount: 0,
  hasMessage: false,
  hasSender: false,
  hasRecipient: false,
  hasMessageId: false,
  ignoredReason: "payload_not_object",
};

type MessagingCandidate = {
  item: Record<string, unknown>;
  source: "messaging" | "changes" | "field_value";
};

function objectTypeOf(payload: unknown): string | null {
  if (payload === null) return "null";
  if (Array.isArray(payload)) return "array";
  if (!isRecord(payload)) return typeof payload;
  if (typeof payload.object === "string") return payload.object;
  if (payload.object === undefined) return "missing";
  return "non_string";
}

function messagingItemShape(item: Record<string, unknown>): {
  hasMessage: boolean;
  hasSender: boolean;
  hasRecipient: boolean;
  hasMessageId: boolean;
} {
  const message = isRecord(item.message) ? item.message : null;
  return {
    hasMessage: message !== null,
    hasSender: isRecord(item.sender),
    hasRecipient: isRecord(item.recipient),
    hasMessageId: message !== null && typeof message.mid === "string",
  };
}

function ignoredReasonForMessagingItem(
  item: Record<string, unknown>,
): MetaWebhookIgnoredReason | null {
  const message = isRecord(item.message) ? item.message : null;
  if (!message) return "missing_message";
  if (message.is_echo === true) return "echo";
  if (message.is_deleted === true) return "deleted";
  if (message.is_unsupported === true) return "unsupported";
  if (typeof message.text !== "string" || message.text.trim().length === 0) {
    return "missing_text";
  }
  if (!isRecord(item.sender) || typeof item.sender.id !== "string") {
    return "missing_sender";
  }
  if (typeof message.mid !== "string" || message.mid.trim().length === 0) {
    return "missing_message_id";
  }
  return null;
}

function collectCandidates(payload: Record<string, unknown>): {
  entries: unknown[];
  candidates: MessagingCandidate[];
} {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const candidates: MessagingCandidate[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;

    if (Array.isArray(entry.messaging)) {
      for (const item of entry.messaging) {
        if (isRecord(item)) {
          candidates.push({ item, source: "messaging" });
        }
      }
    }

    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (!isRecord(change)) continue;
        if (change.field !== "messages") continue;
        const value = isRecord(change.value) ? change.value : null;
        if (value) candidates.push({ item: value, source: "changes" });
      }
    }

    if (entry.field === "messages" && isRecord(entry.value)) {
      candidates.push({ item: entry.value, source: "field_value" });
    }
  }

  return { entries, candidates };
}

function diagnoseRecord(
  payload: Record<string, unknown>,
): MetaWebhookNormalizeDiagnostic {
  const objectType = objectTypeOf(payload);
  const { entries, candidates } = collectCandidates(payload);
  const first = candidates[0]?.item;
  const shape = first
    ? messagingItemShape(first)
    : {
        hasMessage: false,
        hasSender: false,
        hasRecipient: false,
        hasMessageId: false,
      };

  const base = {
    objectType,
    entryCount: entries.length,
    messagingEventCount: candidates.length,
    ...shape,
  };

  if (objectType !== "instagram" && objectType !== "whatsapp_business_account") {
    return { ...base, ignoredReason: "unsupported_object" };
  }

  if (objectType !== "instagram") {
    return { ...base, ignoredReason: null };
  }

  if (entries.length === 0) {
    return { ...base, ignoredReason: "no_entries" };
  }

  if (candidates.length === 0) {
    return { ...base, ignoredReason: "no_messaging_events" };
  }

  const messagingCount = candidates.filter((c) => c.source === "messaging").length;
  if (messagingCount === 0) {
    const source = candidates[0]?.source;
    return {
      ...base,
      ignoredReason:
        source === "field_value"
          ? "instagram_field_value_shape"
          : "instagram_changes_shape",
    };
  }

  return {
    ...base,
    ignoredReason: ignoredReasonForMessagingItem(candidates[0]!.item),
  };
}

/**
 * Describes why a Meta webhook body produced zero or ignored Instagram events.
 * Returns only counts, booleans, and sanitized reason codes.
 */
export function diagnoseMetaWebhookPayload(
  payload: unknown,
): MetaWebhookNormalizeDiagnostic {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (isRecord(first)) {
      return {
        ...diagnoseRecord(first),
        objectType: "array",
        ignoredReason: "payload_wrapped_array",
      };
    }
    return { ...EMPTY_DIAGNOSTIC, objectType: "array" };
  }

  if (!isRecord(payload)) {
    return {
      ...EMPTY_DIAGNOSTIC,
      objectType: objectTypeOf(payload),
    };
  }

  return diagnoseRecord(payload);
}
