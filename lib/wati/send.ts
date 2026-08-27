import "server-only";

import {
  getWatiSendConfig,
  type WatiSendConfig,
} from "@/lib/wati/config";
import {
  WATI_SEND_MAX_RESPONSE_BYTES,
  WATI_SEND_TIMEOUT_MS,
} from "@/lib/wati/constants";
import { normalizeWaId } from "@/lib/wati/normalize";
import type {
  WhatsAppSendDeps,
  WhatsAppSendFailure,
  WhatsAppSendResult,
} from "@/lib/meta/whatsapp-send";

const WA_ID_PATTERN = /^\d{6,20}$/;

/** Official WATI API v3 path for session text (stable; no recipient/query data). */
export const WATI_V3_TEXT_PATH = "/api/ext/v3/conversations/messages/text";

export type WatiSendDeps = WhatsAppSendDeps & {
  allowHttpInTests?: boolean;
};

/**
 * Normalize and validate WATI_API_ENDPOINT.
 * Rejects non-https (except http://localhost in tests), credentials-in-URL,
 * and path traversal into unexpected hosts.
 */
export function normalizeWatiApiEndpoint(
  endpoint: string,
  options: { allowHttpInTests?: boolean } = {},
): URL | null {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") {
    // ok
  } else if (
    options.allowHttpInTests &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    // test-only
  } else {
    return null;
  }
  if (!url.hostname) return null;
  return url;
}

/**
 * Build the official v3 text URL from the configured endpoint origin only.
 * Discards any legacy tenant pathname (e.g. /101197) — live WATI v3 is
 * hosted at `{origin}/api/ext/v3/conversations/messages/text`.
 * Never puts message text, recipient, token, tenant id, or localMessageId
 * in the URL or query string.
 */
export function watiV3TextMessageUrl(
  config: WatiSendConfig,
  options: { allowHttpInTests?: boolean } = {},
): string | null {
  const base = normalizeWatiApiEndpoint(config.apiEndpoint, {
    allowHttpInTests: options.allowHttpInTests,
  });
  if (!base) return null;

  const url = new URL(WATI_V3_TEXT_PATH, `${base.origin}/`);
  url.search = "";
  url.hash = "";
  // Ensure the stable path appears exactly once (no accidental doubling).
  if (url.pathname !== WATI_V3_TEXT_PATH) {
    url.pathname = WATI_V3_TEXT_PATH;
  }
  return url.toString();
}

/**
 * Channel-scoped target: `{channelPhoneNumber}:{recipientWaId}`.
 * Both parts must be digits-only.
 */
export function buildWatiChannelScopedTarget(
  channelPhoneNumber: string,
  recipientWaId: string,
): string | null {
  const channel = normalizeWaId(channelPhoneNumber);
  const recipient = normalizeWaId(recipientWaId);
  if (!channel || !recipient) return null;
  if (!WA_ID_PATTERN.test(channel) || !WA_ID_PATTERN.test(recipient)) return null;
  return `${channel}:${recipient}`;
}

function classifyWatiHttpError(status: number): WhatsAppSendFailure {
  let errorCode = "wati_send_failed";
  if (status === 401) errorCode = "http_401";
  else if (status === 403) errorCode = "http_403";
  else if (status === 429) errorCode = "http_429";
  else if (status >= 500) errorCode = "http_5xx";
  else if (status >= 400) errorCode = `http_${status}`;

  return {
    ok: false,
    errorCode,
    retryable: status === 429 || status >= 500,
    messagingWindowExpired: false,
    httpStatus: status,
  };
}

async function readLimitedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false; errorCode: string }> {
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.byteLength > WATI_SEND_MAX_RESPONSE_BYTES) {
    return { ok: false, errorCode: "response_too_large" };
  }
  if (raw.byteLength === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw.toString("utf8")) };
  } catch {
    return { ok: false, errorCode: "invalid_wati_json" };
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse documented identifiers from WATI v3 SendTextResponse.
 * Prefer WhatsApp message id when present; otherwise ConversationEventDto.id.
 * Does not invent request-side localMessageId.
 */
export function messageIdFromWatiV3Body(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const message =
    record.message && typeof record.message === "object" && !Array.isArray(record.message)
      ? (record.message as Record<string, unknown>)
      : null;
  if (!message) return null;

  return (
    asNonEmptyString(message.whatsappMessageId) ??
    asNonEmptyString(message.whatsapp_message_id) ??
    asNonEmptyString(message.id)
  );
}

/**
 * Send a conversation text message via official WATI API v3.
 * HTTP 200 means accepted by WATI, not delivered to the device.
 * Never logs message content, phone numbers, endpoint, or token.
 * Does not submit localMessageId (unsupported on v3 SendTextRequest).
 */
export async function sendWatiSessionText(options: {
  recipientId: string;
  text: string;
  /** Ignored: v3 SendTextRequest has no localMessageId field. */
  localMessageId?: string | null;
  deps?: WatiSendDeps;
  config?: WatiSendConfig | null;
}): Promise<WhatsAppSendResult> {
  const env = options.deps?.env ?? process.env;
  const config = options.config ?? getWatiSendConfig(env);
  if (!config) {
    return {
      ok: false,
      errorCode: "wati_send_not_configured",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const recipientId = normalizeWaId(options.recipientId);
  if (!recipientId) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const text = options.text.trim();
  if (!text) {
    return {
      ok: false,
      errorCode: "empty_message",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const target = buildWatiChannelScopedTarget(
    config.channelPhoneNumber,
    recipientId,
  );
  if (!target) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const allowHttpInTests = options.deps?.allowHttpInTests === true;
  const url = watiV3TextMessageUrl(config, { allowHttpInTests });
  if (!url) {
    return {
      ok: false,
      errorCode: "invalid_wati_endpoint",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const requestBody = JSON.stringify({ target, text });

  // Token must never appear in the URL or body — only Authorization header.
  if (
    url.toLowerCase().includes(config.apiToken.toLowerCase()) ||
    requestBody.toLowerCase().includes(config.apiToken.toLowerCase())
  ) {
    return {
      ok: false,
      errorCode: "token_url_leak_prevented",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const fetchImpl = options.deps?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATI_SEND_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    const parsed = await readLimitedJson(response);
    if (!parsed.ok) {
      return {
        ok: false,
        errorCode: parsed.errorCode,
        retryable: response.status >= 500 || response.status === 429,
        messagingWindowExpired: false,
        httpStatus: response.status,
      };
    }
    if (!response.ok) {
      return classifyWatiHttpError(response.status);
    }
    // HTTP 200 = accepted by WATI, not device delivery confirmation.
    return {
      ok: true,
      metaMessageId: messageIdFromWatiV3Body(parsed.value),
      recipientId,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      errorCode: aborted ? "send_timeout" : "network_error",
      retryable: true,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
