import "server-only";

import type { InstagramQuickReply } from "@/lib/meta/conversation-machine";
import type {
  WhatsAppSendDeps,
  WhatsAppSendFailure,
  WhatsAppSendResult,
} from "@/lib/meta/whatsapp-send";
import {
  getWatiSendConfig,
  type WatiSendConfig,
} from "@/lib/wati/config";
import {
  WATI_SEND_MAX_RESPONSE_BYTES,
  WATI_SEND_TIMEOUT_MS,
} from "@/lib/wati/constants";
import {
  planWatiInteractiveMessage,
  watiInteractiveRequestBody,
  WATI_V3_INTERACTIVE_PATH,
} from "@/lib/wati/interactive";
import { normalizeWaId } from "@/lib/wati/normalize";

export { WATI_V3_INTERACTIVE_PATH };

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
 * Build an official v3 URL from the configured endpoint origin only.
 * Discards any legacy tenant pathname (e.g. /101197).
 * Never puts message text, recipient, token, tenant id, or localMessageId
 * in the URL or query string.
 */
function watiV3PathUrl(
  config: WatiSendConfig,
  pathname: string,
  options: { allowHttpInTests?: boolean } = {},
): string | null {
  const base = normalizeWatiApiEndpoint(config.apiEndpoint, {
    allowHttpInTests: options.allowHttpInTests,
  });
  if (!base) return null;

  const url = new URL(pathname, `${base.origin}/`);
  url.search = "";
  url.hash = "";
  if (url.pathname !== pathname) {
    url.pathname = pathname;
  }
  return url.toString();
}

export function watiV3TextMessageUrl(
  config: WatiSendConfig,
  options: { allowHttpInTests?: boolean } = {},
): string | null {
  return watiV3PathUrl(config, WATI_V3_TEXT_PATH, options);
}

export function watiV3InteractiveMessageUrl(
  config: WatiSendConfig,
  options: { allowHttpInTests?: boolean } = {},
): string | null {
  return watiV3PathUrl(config, WATI_V3_INTERACTIVE_PATH, options);
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

function notConfiguredResult(): WhatsAppSendFailure {
  return {
    ok: false,
    errorCode: "wati_send_not_configured",
    retryable: false,
    messagingWindowExpired: false,
    httpStatus: null,
  };
}

function invalidRecipientResult(): WhatsAppSendFailure {
  return {
    ok: false,
    errorCode: "invalid_recipient",
    retryable: false,
    messagingWindowExpired: false,
    httpStatus: null,
  };
}

function prepareWatiSend(options: {
  recipientId: string;
  deps?: WatiSendDeps;
  config?: WatiSendConfig | null;
}):
  | {
      ok: true;
      config: WatiSendConfig;
      recipientId: string;
      target: string;
      allowHttpInTests: boolean;
    }
  | WhatsAppSendFailure {
  const env = options.deps?.env ?? process.env;
  const config = options.config ?? getWatiSendConfig(env);
  if (!config) return notConfiguredResult();

  const recipientId = normalizeWaId(options.recipientId);
  if (!recipientId) return invalidRecipientResult();

  const target = buildWatiChannelScopedTarget(
    config.channelPhoneNumber,
    recipientId,
  );
  if (!target) return invalidRecipientResult();

  return {
    ok: true,
    config,
    recipientId,
    target,
    allowHttpInTests: options.deps?.allowHttpInTests === true,
  };
}

/**
 * POST JSON to a WATI v3 path. HTTP 200 means accepted, not delivered.
 * Never logs message content, options, phone numbers, endpoint, target, or token.
 */
async function postWatiJson(options: {
  url: string;
  body: Record<string, unknown>;
  config: WatiSendConfig;
  recipientId: string;
  deps?: WatiSendDeps;
}): Promise<WhatsAppSendResult> {
  const requestBody = JSON.stringify(options.body);
  if (
    options.url.toLowerCase().includes(options.config.apiToken.toLowerCase()) ||
    requestBody.toLowerCase().includes(options.config.apiToken.toLowerCase())
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
    const response = await fetchImpl(options.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.config.apiToken}`,
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
    return {
      ok: true,
      metaMessageId: messageIdFromWatiV3Body(parsed.value),
      recipientId: options.recipientId,
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
  const prepared = prepareWatiSend(options);
  if (!prepared.ok) return prepared;

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

  const url = watiV3TextMessageUrl(prepared.config, {
    allowHttpInTests: prepared.allowHttpInTests,
  });
  if (!url) {
    return {
      ok: false,
      errorCode: "invalid_wati_endpoint",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  return postWatiJson({
    url,
    body: { target: prepared.target, text },
    config: prepared.config,
    recipientId: prepared.recipientId,
    deps: options.deps,
  });
}

/**
 * Send conversation-machine quick replies as one native WATI interactive
 * message (buttons or list). Does not also send a duplicate text prompt.
 * HTTP 200 means accepted by WATI, not delivered to the device.
 */
export async function sendWatiInteractiveMessage(options: {
  recipientId: string;
  text: string;
  quickReplies: InstagramQuickReply[];
  /** Ignored: v3 interactive request has no localMessageId field. */
  localMessageId?: string | null;
  deps?: WatiSendDeps;
  config?: WatiSendConfig | null;
}): Promise<WhatsAppSendResult> {
  const prepared = prepareWatiSend(options);
  if (!prepared.ok) return prepared;

  const plan = planWatiInteractiveMessage(options.text, options.quickReplies);
  if (!plan.ok) {
    return {
      ok: false,
      errorCode: plan.errorCode,
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  const url = watiV3InteractiveMessageUrl(prepared.config, {
    allowHttpInTests: prepared.allowHttpInTests,
  });
  if (!url) {
    return {
      ok: false,
      errorCode: "invalid_wati_endpoint",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  return postWatiJson({
    url,
    body: watiInteractiveRequestBody(prepared.target, plan),
    config: prepared.config,
    recipientId: prepared.recipientId,
    deps: options.deps,
  });
}
