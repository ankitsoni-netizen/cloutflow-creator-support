import "server-only";

import {
  getMetaGraphApiVersion,
  getMetaInstagramSendConfig,
} from "@/lib/meta/config";
import type { InstagramQuickReply } from "@/lib/meta/conversation-machine";

export const INSTAGRAM_TERMINAL_SEND_CODES = new Set([
  "messaging_window_expired",
  "instagram_send_not_configured",
  "invalid_recipient",
  "empty_message",
  "graph_190",
  "http_401",
  "http_403",
  "outbound_attempts_exhausted",
]);

export function isInstagramTerminalSendError(errorCode: string | null | undefined): boolean {
  const code = errorCode?.trim() ?? "";
  if (!code) return false;
  if (INSTAGRAM_TERMINAL_SEND_CODES.has(code)) return true;
  if (code.startsWith("graph_")) {
    const numeric = Number(code.slice("graph_".length));
    if (Number.isFinite(numeric) && numeric !== 1 && numeric !== 2 && numeric < 500) {
      return numeric !== 4;
    }
  }
  return false;
}

export const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";
export const INSTAGRAM_SEND_TIMEOUT_MS = 10_000;
export const INSTAGRAM_SEND_MAX_RESPONSE_BYTES = 64 * 1024;
export const INSTAGRAM_SEND_MAX_ATTEMPTS = 1;

const GRAPH_VERSION_PATTERN = /^v\d+(?:\.\d+)?$/;
const NUMERIC_ID_PATTERN = /^\d+$/;

export type InstagramSendConfig = {
  accessToken: string;
  accountId: string;
  graphVersion: string;
};

export type InstagramSendSuccess = {
  ok: true;
  metaMessageId: string | null;
  recipientId: string;
};

export type InstagramSendFailure = {
  ok: false;
  errorCode: string;
  retryable: boolean;
  messagingWindowExpired: boolean;
  deliveryUnknown: boolean;
  httpStatus: number | null;
};

export type InstagramSendResult = InstagramSendSuccess | InstagramSendFailure;

export type InstagramSendDeps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  graphConfig?: InstagramSendConfig | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getInstagramGraphSendConfig(
  env: Record<string, string | undefined> = process.env,
): InstagramSendConfig | null {
  const send = getMetaInstagramSendConfig(env);
  const graphVersion = getMetaGraphApiVersion(env);
  if (!send || !graphVersion) return null;
  if (!GRAPH_VERSION_PATTERN.test(graphVersion)) return null;
  if (!NUMERIC_ID_PATTERN.test(send.accountId)) return null;
  return {
    accessToken: send.accessToken,
    accountId: send.accountId,
    graphVersion,
  };
}

export function resolveInstagramGraphSendConfig(
  deps: InstagramSendDeps = {},
): InstagramSendConfig | null {
  if (deps.graphConfig !== undefined) return deps.graphConfig;
  return getInstagramGraphSendConfig(deps.env ?? process.env);
}

export function instagramMessagesUrl(config: InstagramSendConfig): string {
  return `${INSTAGRAM_GRAPH_BASE}/${config.graphVersion}/${config.accountId}/messages`;
}

function isNumericRecipient(recipientId: string): boolean {
  return NUMERIC_ID_PATTERN.test(recipientId.trim());
}

function classifyGraphError(status: number, body: unknown): InstagramSendFailure {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const error = record && typeof record.error === "object" && record.error
    ? (record.error as Record<string, unknown>)
    : null;
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode =
    typeof error?.error_subcode === "number" ? error.error_subcode : null;

  const messagingWindowExpired =
    code === 10 ||
    code === 551 ||
    subcode === 2018278 ||
    subcode === 1545041;

  let errorCode = "instagram_send_failed";
  if (messagingWindowExpired) errorCode = "messaging_window_expired";
  else if (status === 401 || status === 403 || code === 190) {
    errorCode = status === 401 || status === 403 ? `http_${status}` : "graph_190";
  } else if (status === 429) errorCode = "http_429";
  else if (status >= 500) errorCode = "http_5xx";
  else if (code !== null) errorCode = `graph_${code}`;

  const retryable = status === 429 || status >= 500;
  return {
    ok: false,
    errorCode,
    retryable,
    messagingWindowExpired,
    deliveryUnknown: false,
    httpStatus: status,
  };
}

async function readLimitedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false; errorCode: string }> {
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.byteLength > INSTAGRAM_SEND_MAX_RESPONSE_BYTES) {
    return { ok: false, errorCode: "response_too_large" };
  }
  if (raw.byteLength === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw.toString("utf8")) };
  } catch {
    return { ok: false, errorCode: "invalid_graph_json" };
  }
}

function metaMessageIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.message_id === "string" && record.message_id.trim()) {
    return record.message_id.trim();
  }
  if (typeof record.mid === "string" && record.mid.trim()) {
    return record.mid.trim();
  }
  return null;
}

async function postInstagramMessage(
  config: InstagramSendConfig,
  body: Record<string, unknown>,
  deps: InstagramSendDeps,
): Promise<InstagramSendResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const wait = deps.sleep ?? sleep;
  const url = instagramMessagesUrl(config);
  const recipient = body.recipient as { id?: string } | undefined;
  const recipientId = recipient?.id?.trim() ?? "";
  if (!isNumericRecipient(recipientId)) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      retryable: false,
      messagingWindowExpired: false,
      deliveryUnknown: false,
      httpStatus: null,
    };
  }

  let lastFailure: InstagramSendFailure = {
    ok: false,
    errorCode: "instagram_send_failed",
    retryable: true,
    messagingWindowExpired: false,
    deliveryUnknown: false,
    httpStatus: null,
  };

  for (let attempt = 1; attempt <= INSTAGRAM_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INSTAGRAM_SEND_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const parsed = await readLimitedJson(response);
      if (!parsed.ok) {
        lastFailure = {
          ok: false,
          errorCode: parsed.errorCode,
          retryable: response.status >= 500 || response.status === 429,
          messagingWindowExpired: false,
          deliveryUnknown: false,
          httpStatus: response.status,
        };
      } else if (!response.ok) {
        lastFailure = classifyGraphError(response.status, parsed.value);
      } else {
        return {
          ok: true,
          metaMessageId: metaMessageIdFromBody(parsed.value),
          recipientId,
        };
      }
      if (!lastFailure.retryable || attempt === INSTAGRAM_SEND_MAX_ATTEMPTS) {
        return lastFailure;
      }
    } catch (error) {
      const aborted =
        error instanceof Error && error.name === "AbortError";
      lastFailure = {
        ok: false,
        errorCode: aborted ? "timeout_unknown" : "network_error",
        retryable: !aborted,
        messagingWindowExpired: false,
        deliveryUnknown: aborted,
        httpStatus: null,
      };
      if (aborted || attempt === INSTAGRAM_SEND_MAX_ATTEMPTS) return lastFailure;
    } finally {
      clearTimeout(timer);
    }
    await wait(200 * attempt);
  }

  return lastFailure;
}

export async function sendInstagramText(options: {
  recipientId: string;
  text: string;
  deps?: InstagramSendDeps;
  config?: InstagramSendConfig | null;
}): Promise<InstagramSendResult> {
  const config =
    options.config ?? resolveInstagramGraphSendConfig(options.deps ?? {});
  if (!config) {
    return {
      ok: false,
      errorCode: "instagram_send_not_configured",
      retryable: false,
      messagingWindowExpired: false,
      deliveryUnknown: false,
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
      deliveryUnknown: false,
      httpStatus: null,
    };
  }
  return postInstagramMessage(
    config,
    {
      recipient: { id: options.recipientId.trim() },
      message: { text },
    },
    options.deps ?? {},
  );
}

export async function sendInstagramQuickReplies(options: {
  recipientId: string;
  text: string;
  quickReplies: InstagramQuickReply[];
  deps?: InstagramSendDeps;
  config?: InstagramSendConfig | null;
}): Promise<InstagramSendResult> {
  const config =
    options.config ?? resolveInstagramGraphSendConfig(options.deps ?? {});
  if (!config) {
    return {
      ok: false,
      errorCode: "instagram_send_not_configured",
      retryable: false,
      messagingWindowExpired: false,
      deliveryUnknown: false,
      httpStatus: null,
    };
  }
  const text = options.text.trim();
  if (!text || options.quickReplies.length === 0) {
    return {
      ok: false,
      errorCode: "empty_message",
      retryable: false,
      messagingWindowExpired: false,
      deliveryUnknown: false,
      httpStatus: null,
    };
  }
  return postInstagramMessage(
    config,
    {
      recipient: { id: options.recipientId.trim() },
      messaging_type: "RESPONSE",
      message: {
        text,
        quick_replies: options.quickReplies.map((reply) => ({
          content_type: "text",
          title: reply.title.slice(0, 20),
          payload: reply.payload,
        })),
      },
    },
    options.deps ?? {},
  );
}
