import "server-only";

import {
  WATI_WEBHOOK_EVENT_RECEIVED,
  WATI_WEBHOOK_MAX_BODY_BYTES,
} from "@/lib/wati/constants";
import {
  getWatiChannelPhoneNumber,
  getWatiWebhookSecret,
} from "@/lib/wati/config";
import {
  logWatiWebhookAuthFailure,
  logWatiWebhookError,
  logWatiWebhookMisconfiguration,
} from "@/lib/wati/log";
import {
  normalizeWatiWebhookPayload,
  sanitizeWatiWebhookStoragePayload,
} from "@/lib/wati/normalize";
import { timingSafeEqualString } from "@/lib/meta/signature";
import {
  createAdminInstagramStore,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import {
  ingestWhatsAppInboundMessage,
  ingestWhatsAppStatus,
} from "@/lib/meta/whatsapp-ingest";
import { NextResponse, type NextRequest } from "next/server";

export type WatiWebhookDeps = {
  env?: Record<string, string | undefined>;
  store?: InstagramIngestStore;
};

function textResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Authenticate via ?token= query param with timing-safe compare to WATI_WEBHOOK_SECRET.
 * Never logs the URL, query string, or token.
 */
export function authenticateWatiWebhookRequest(
  request: NextRequest,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; response: NextResponse } {
  const expected = getWatiWebhookSecret(env);
  if (!expected) {
    logWatiWebhookMisconfiguration("webhook_secret_missing");
    logWatiWebhookAuthFailure("secret_missing");
    return { ok: false, response: textResponse("Unauthorized", 401) };
  }

  const provided = request.nextUrl.searchParams.get("token");
  if (provided === null || provided === "") {
    logWatiWebhookAuthFailure("token_missing");
    return { ok: false, response: textResponse("Unauthorized", 401) };
  }

  if (!timingSafeEqualString(provided, expected)) {
    logWatiWebhookAuthFailure("token_invalid");
    return { ok: false, response: textResponse("Unauthorized", 401) };
  }

  return { ok: true };
}

async function readLimitedBody(
  request: NextRequest,
): Promise<
  | { ok: true; raw: Buffer }
  | { ok: false; response: NextResponse }
> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      Number.isFinite(contentLength) &&
      contentLength > WATI_WEBHOOK_MAX_BODY_BYTES
    ) {
      return { ok: false, response: textResponse("Payload too large", 413) };
    }
  }

  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(await request.arrayBuffer());
  } catch {
    return { ok: false, response: textResponse("Unable to read request body", 400) };
  }

  if (rawBytes.byteLength > WATI_WEBHOOK_MAX_BODY_BYTES) {
    return { ok: false, response: textResponse("Payload too large", 413) };
  }

  return { ok: true, raw: rawBytes };
}

function storagePayloadFor(
  record: Record<string, unknown> | null,
  fallback: unknown,
): unknown {
  if (record) return sanitizeWatiWebhookStoragePayload(record);
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return sanitizeWatiWebhookStoragePayload(fallback as Record<string, unknown>);
  }
  return { provider: "wati_whatsapp", sanitized: true };
}

export async function handleWatiWebhookPost(
  request: NextRequest,
  deps: WatiWebhookDeps = {},
): Promise<NextResponse> {
  const env = deps.env ?? process.env;

  const auth = authenticateWatiWebhookRequest(request, env);
  if (!auth.ok) return auth.response;

  const body = await readLimitedBody(request);
  if (!body.ok) return body.response;

  let payload: unknown;
  try {
    const text = body.raw.toString("utf8");
    if (!text.trim()) {
      // Empty authenticated callback — acknowledge.
      return textResponse(WATI_WEBHOOK_EVENT_RECEIVED, 200);
    }
    payload = JSON.parse(text);
  } catch {
    return textResponse("Invalid JSON", 400);
  }

  const expectedChannel = getWatiChannelPhoneNumber(env);
  const normalized = normalizeWatiWebhookPayload(payload, {
    expectedChannelPhoneNumber: expectedChannel,
  });

  // Wrong channel: acknowledge without progressing chatbot / creating duplicates.
  if (
    normalized.rejected.some((item) => item.reason === "wrong_channel") &&
    normalized.events.length === 0 &&
    normalized.statuses.length === 0
  ) {
    return textResponse(WATI_WEBHOOK_EVENT_RECEIVED, 200);
  }

  if (normalized.events.length === 0 && normalized.statuses.length === 0) {
    // Safely ignored status/echo/owner events.
    return textResponse(WATI_WEBHOOK_EVENT_RECEIVED, 200);
  }

  let store: InstagramIngestStore;
  try {
    store = deps.store ?? createAdminInstagramStore();
  } catch {
    logWatiWebhookError("admin_client_missing");
    return textResponse("Unable to process event", 500);
  }

  let hadRetryableFailure = false;

  for (const status of normalized.statuses) {
    let result;
    try {
      result = await ingestWhatsAppStatus(status, store, {
        webhookPayload: storagePayloadFor(null, {
          eventType: "status",
          hasWhatsappMessageId: true,
        }),
      });
    } catch {
      result = { outcome: "failed" as const, errorCode: "unexpected_failure" };
    }
    if (result.outcome === "failed") {
      logWatiWebhookError(result.errorCode ?? "unexpected_failure", {
        externalEventId: status.externalEventId,
        externalMessageId: status.metaMessageId,
      });
      hadRetryableFailure = true;
    }
  }

  for (const event of normalized.events) {
    let result;
    try {
      result = await ingestWhatsAppInboundMessage(event, store, {
        webhookPayload: storagePayloadFor(
          event.eventFragment as Record<string, unknown>,
          event.eventFragment,
        ),
      });
    } catch {
      result = { outcome: "failed" as const, errorCode: "unexpected_failure" };
    }
    if (result.outcome === "failed") {
      logWatiWebhookError(result.errorCode ?? "unexpected_failure", {
        externalEventId: event.externalEventId,
        externalMessageId: event.externalMessageId,
      });
      hadRetryableFailure = true;
    }
  }

  if (hadRetryableFailure) {
    return textResponse("Unable to process event", 500);
  }
  return textResponse(WATI_WEBHOOK_EVENT_RECEIVED, 200);
}
