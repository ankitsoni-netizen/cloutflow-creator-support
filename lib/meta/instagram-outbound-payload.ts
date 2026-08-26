import type { InstagramQuickReply } from "@/lib/meta/conversation-machine";

const TITLE_MAX = 20;
const PAYLOAD_MAX = 1000;
const TEXT_MAX = 1000;

export type SanitizedInstagramOutboundPayload = {
  text: string;
  quick_replies?: InstagramQuickReply[];
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function looksLikeSecret(value: string): boolean {
  const lowered = value.toLowerCase();
  if (lowered.includes("bearer ")) return true;
  if (lowered.includes("access_token")) return true;
  if (lowered.includes("authorization")) return true;
  return false;
}

export function sanitizeInstagramQuickReplies(
  replies: unknown,
): InstagramQuickReply[] | null {
  if (!Array.isArray(replies) || replies.length === 0) return null;
  const parsed: InstagramQuickReply[] = [];
  for (const reply of replies.slice(0, 13)) {
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) continue;
    const record = reply as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.payload !== "string") {
      continue;
    }
    const title = record.title.trim().slice(0, TITLE_MAX);
    const payload = record.payload.trim().slice(0, PAYLOAD_MAX);
    if (!title || !payload) continue;
    if (isHttpUrl(payload) || looksLikeSecret(payload)) continue;
    parsed.push({
      content_type: "text",
      title,
      payload,
    });
  }
  return parsed.length > 0 ? parsed : null;
}

export function sanitizeInstagramOutboundPayload(
  input: {
    text?: string | null;
    quickReplies?: unknown;
    rawPayload?: unknown;
  },
): SanitizedInstagramOutboundPayload | null {
  const fromRaw =
    input.rawPayload &&
    typeof input.rawPayload === "object" &&
    !Array.isArray(input.rawPayload)
      ? (input.rawPayload as Record<string, unknown>)
      : null;

  const textSource =
    (typeof input.text === "string" && input.text.trim()) ||
    (typeof fromRaw?.text === "string" && fromRaw.text.trim()) ||
    "";
  const text = textSource.slice(0, TEXT_MAX);
  const quickReplies =
    sanitizeInstagramQuickReplies(input.quickReplies) ??
    sanitizeInstagramQuickReplies(fromRaw?.quick_replies);

  if (!text && !quickReplies) return null;
  if (quickReplies) {
    return { text, quick_replies: quickReplies };
  }
  return text ? { text } : null;
}

/**
 * Durable Meta send snapshot: text + quick-reply titles/payload codes.
 * Plain-text outbounds keep raw_payload null so legacy rows stay compatible.
 */
export function durableInstagramOutboundPayload(
  input: {
    text?: string | null;
    quickReplies?: unknown;
    rawPayload?: unknown;
  },
): SanitizedInstagramOutboundPayload | null {
  const sanitized = sanitizeInstagramOutboundPayload(input);
  if (!sanitized?.quick_replies?.length) return null;
  return sanitized;
}

export function canonicalInstagramOutboundPayloadJson(
  payload: SanitizedInstagramOutboundPayload | null | undefined,
): string | null {
  if (!payload) return null;
  const quickReplies = payload.quick_replies?.map((reply) => ({
    content_type: "text" as const,
    title: reply.title,
    payload: reply.payload,
  }));
  return JSON.stringify({
    text: payload.text,
    ...(quickReplies && quickReplies.length > 0
      ? { quick_replies: quickReplies }
      : {}),
  });
}

/**
 * Legacy rows with no stored payload remain compatible with a later
 * reservation that adds a sanitized payload (or the reverse).
 * When both sides have a payload, they must match exactly.
 */
export function instagramOutboundPayloadsCompatible(
  existing: unknown,
  candidate: unknown,
): boolean {
  if (existing == null || candidate == null) return true;
  const left = sanitizeInstagramOutboundPayload({ rawPayload: existing });
  const right = sanitizeInstagramOutboundPayload({ rawPayload: candidate });
  return (
    canonicalInstagramOutboundPayloadJson(left) ===
    canonicalInstagramOutboundPayloadJson(right)
  );
}

export function outboundPayloadLooksUnsafe(value: unknown): boolean {
  if (value == null) return false;
  const encoded = JSON.stringify(value).toLowerCase();
  if (encoded.includes("bearer ")) return true;
  if (encoded.includes("access_token")) return true;
  if (encoded.includes("authorization")) return true;
  if (encoded.includes("graph.instagram.com")) return true;
  if (encoded.includes("lookaside.fbsbx.com")) return true;
  return false;
}
