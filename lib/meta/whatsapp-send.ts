import "server-only";

import {
  getMetaGraphApiVersion,
  getMetaWhatsAppSendConfig,
} from "@/lib/meta/config";
import type { InstagramQuickReply } from "@/lib/meta/conversation-machine";

export const WHATSAPP_GRAPH_BASE = "https://graph.facebook.com";
export const WHATSAPP_SEND_TIMEOUT_MS = 10_000;
export const WHATSAPP_SEND_MAX_RESPONSE_BYTES = 64 * 1024;
export const WHATSAPP_SEND_MAX_ATTEMPTS = 3;

const GRAPH_VERSION_PATTERN = /^v\d+(?:\.\d+)?$/;
const WA_ID_PATTERN = /^\d{6,20}$/;

export type WhatsAppSendConfig = {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
};

export type WhatsAppSendSuccess = {
  ok: true;
  metaMessageId: string | null;
  recipientId: string;
};

export type WhatsAppSendFailure = {
  ok: false;
  errorCode: string;
  retryable: boolean;
  messagingWindowExpired: boolean;
  httpStatus: number | null;
};

export type WhatsAppSendResult = WhatsAppSendSuccess | WhatsAppSendFailure;

export type WhatsAppSendDeps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getWhatsAppGraphSendConfig(
  env: Record<string, string | undefined> = process.env,
): WhatsAppSendConfig | null {
  const send = getMetaWhatsAppSendConfig(env);
  const graphVersion = getMetaGraphApiVersion(env);
  if (!send || !graphVersion) return null;
  if (!GRAPH_VERSION_PATTERN.test(graphVersion)) return null;
  if (!WA_ID_PATTERN.test(send.phoneNumberId)) return null;
  return {
    accessToken: send.accessToken,
    phoneNumberId: send.phoneNumberId,
    graphVersion,
  };
}

export function whatsappMessagesUrl(config: WhatsAppSendConfig): string {
  return `${WHATSAPP_GRAPH_BASE}/${config.graphVersion}/${config.phoneNumberId}/messages`;
}

function isValidWaId(recipientId: string): boolean {
  return WA_ID_PATTERN.test(recipientId.trim());
}

function classifyGraphError(status: number, body: unknown): WhatsAppSendFailure {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const error =
    record && typeof record.error === "object" && record.error
      ? (record.error as Record<string, unknown>)
      : null;
  const code = typeof error?.code === "number" ? error.code : null;

  const messagingWindowExpired = code === 131047;
  let errorCode = "whatsapp_send_failed";
  if (messagingWindowExpired) errorCode = "outside_customer_service_window";
  else if (status === 429) errorCode = "http_429";
  else if (status >= 500) errorCode = "http_5xx";
  else if (code !== null) errorCode = `graph_${code}`;

  const retryable = status === 429 || status >= 500;
  return {
    ok: false,
    errorCode,
    retryable,
    messagingWindowExpired,
    httpStatus: status,
  };
}

async function readLimitedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false; errorCode: string }> {
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.byteLength > WHATSAPP_SEND_MAX_RESPONSE_BYTES) {
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
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const first = messages[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const id = (first as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  if (typeof record.message_id === "string" && record.message_id.trim()) {
    return record.message_id.trim();
  }
  return null;
}

async function postWhatsAppMessage(
  config: WhatsAppSendConfig,
  body: Record<string, unknown>,
  deps: WhatsAppSendDeps,
): Promise<WhatsAppSendResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const wait = deps.sleep ?? sleep;
  const url = whatsappMessagesUrl(config);
  const recipientId = typeof body.to === "string" ? body.to.trim() : "";
  if (!isValidWaId(recipientId)) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }

  let lastFailure: WhatsAppSendFailure = {
    ok: false,
    errorCode: "whatsapp_send_failed",
    retryable: true,
    messagingWindowExpired: false,
    httpStatus: null,
  };

  for (let attempt = 1; attempt <= WHATSAPP_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHATSAPP_SEND_TIMEOUT_MS);
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
      if (!lastFailure.retryable || attempt === WHATSAPP_SEND_MAX_ATTEMPTS) {
        return lastFailure;
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      lastFailure = {
        ok: false,
        errorCode: aborted ? "send_timeout" : "network_error",
        retryable: true,
        messagingWindowExpired: false,
        httpStatus: null,
      };
      if (attempt === WHATSAPP_SEND_MAX_ATTEMPTS) return lastFailure;
    } finally {
      clearTimeout(timer);
    }
    await wait(200 * attempt);
  }

  return lastFailure;
}

export async function sendWhatsAppText(options: {
  recipientId: string;
  text: string;
  deps?: WhatsAppSendDeps;
  config?: WhatsAppSendConfig | null;
}): Promise<WhatsAppSendResult> {
  const env = options.deps?.env ?? process.env;
  const config = options.config ?? getWhatsAppGraphSendConfig(env);
  if (!config) {
    return {
      ok: false,
      errorCode: "whatsapp_send_not_configured",
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
  return postWhatsAppMessage(
    config,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: options.recipientId.trim(),
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    },
    options.deps ?? {},
  );
}

export async function sendWhatsAppReplyButtons(options: {
  recipientId: string;
  text: string;
  quickReplies: InstagramQuickReply[];
  deps?: WhatsAppSendDeps;
  config?: WhatsAppSendConfig | null;
}): Promise<WhatsAppSendResult> {
  const env = options.deps?.env ?? process.env;
  const config = options.config ?? getWhatsAppGraphSendConfig(env);
  if (!config) {
    return {
      ok: false,
      errorCode: "whatsapp_send_not_configured",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }
  const text = options.text.trim();
  const buttons = options.quickReplies.slice(0, 3);
  if (!text || buttons.length === 0) {
    return {
      ok: false,
      errorCode: "empty_message",
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    };
  }
  return postWhatsAppMessage(
    config,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: options.recipientId.trim(),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: {
          buttons: buttons.map((reply) => ({
            type: "reply",
            reply: {
              id: reply.payload.slice(0, 256),
              title: reply.title.slice(0, 20),
            },
          })),
        },
      },
    },
    options.deps ?? {},
  );
}
