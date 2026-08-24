import "server-only";

import {
  META_SIGNATURE_HEADER,
  META_WEBHOOK_EVENT_RECEIVED,
  META_WEBHOOK_HEALTH_BODY,
  META_WEBHOOK_MAX_BODY_BYTES,
} from "@/lib/meta/constants";
import { getMetaAppSecret, getMetaVerifyToken } from "@/lib/meta/config";
import {
  logMetaWebhookError,
  logMetaWebhookMisconfiguration,
  logMetaWebhookSignatureFailure,
} from "@/lib/meta/log";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import { timingSafeEqualString, verifyMetaSignature } from "@/lib/meta/signature";
import {
  createAdminMetaStore,
  persistNormalizedInboundMessage,
  type MetaInboundStore,
  type PersistResult,
} from "@/lib/meta/store";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import { NextResponse, type NextRequest } from "next/server";

export type MetaWebhookDeps = {
  env?: Record<string, string | undefined>;
  allowHealth?: boolean;
  persistInboundMessage?: (
    event: NormalizedMetaInboundText,
    context: { webhookPayload: unknown },
  ) => Promise<PersistResult>;
  store?: MetaInboundStore;
};

function textResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function defaultPersist(
  event: NormalizedMetaInboundText,
  webhookPayload: unknown,
  deps: MetaWebhookDeps,
): Promise<PersistResult> {
  if (deps.persistInboundMessage) {
    return deps.persistInboundMessage(event, { webhookPayload });
  }

  try {
    const store = deps.store ?? createAdminMetaStore();
    return persistNormalizedInboundMessage(event, store, { webhookPayload });
  } catch {
    return Promise.resolve({
      outcome: "failed",
      errorCode: "admin_client_missing",
    });
  }
}

/**
 * GET is Meta's verification handshake when hub.* query params are present.
 * A parameter-less GET returns a generic health body and never reports
 * whether individual secrets are configured.
 */
export function handleMetaWebhookGet(
  request: NextRequest,
  deps: MetaWebhookDeps = {},
): NextResponse {
  const env = deps.env ?? process.env;
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const allowHealth = deps.allowHealth !== false;

  if (allowHealth && mode === null && token === null && challenge === null) {
    return textResponse(META_WEBHOOK_HEALTH_BODY, 200);
  }

  const expected = getMetaVerifyToken(env);
  if (!expected) {
    logMetaWebhookMisconfiguration("verify_token_missing");
    return textResponse("Forbidden", 403);
  }

  if (mode !== "subscribe" || !challenge) {
    return textResponse("Forbidden", 403);
  }

  if (!timingSafeEqualString(token ?? "", expected)) {
    return textResponse("Forbidden", 403);
  }

  return textResponse(challenge, 200);
}

export type VerifiedMetaPostResult =
  | { ok: true; payload: unknown }
  | { ok: false; response: NextResponse };

export async function readVerifiedMetaWebhookPost(
  request: NextRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<VerifiedMetaPostResult> {
  const appSecret = getMetaAppSecret(env);
  if (!appSecret) {
    logMetaWebhookMisconfiguration("app_secret_missing");
    return { ok: false, response: textResponse("Service unavailable", 503) };
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      Number.isFinite(contentLength) &&
      contentLength > META_WEBHOOK_MAX_BODY_BYTES
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

  if (rawBytes.byteLength > META_WEBHOOK_MAX_BODY_BYTES) {
    return { ok: false, response: textResponse("Payload too large", 413) };
  }

  const signatureHeader = request.headers.get(META_SIGNATURE_HEADER);
  if (!verifyMetaSignature(rawBytes, signatureHeader, appSecret)) {
    const signaturePresent =
      typeof signatureHeader === "string" && signatureHeader.trim().length > 0;
    logMetaWebhookSignatureFailure(
      signaturePresent ? "signature_invalid" : "signature_missing",
    );
    return { ok: false, response: textResponse("Unauthorized", 401) };
  }

  try {
    const rawText = rawBytes.toString("utf8");
    const payload: unknown = rawText ? JSON.parse(rawText) : null;
    return { ok: true, payload };
  } catch {
    return { ok: false, response: textResponse("Invalid JSON", 400) };
  }
}

export async function handleMetaWebhookPost(
  request: NextRequest,
  deps: MetaWebhookDeps = {},
): Promise<NextResponse> {
  const env = deps.env ?? process.env;
  const verified = await readVerifiedMetaWebhookPost(request, env);
  if (!verified.ok) return verified.response;

  const payload = verified.payload;
  const events = normalizeMetaWebhookPayload(payload);
  if (events.length === 0) {
    return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
  }

  let hadRetryableFailure = false;

  for (const event of events) {
    let result: PersistResult;
    try {
      result = await defaultPersist(event, payload, deps);
    } catch {
      result = { outcome: "failed", errorCode: "unexpected_failure" };
    }

    if (result.outcome === "failed") {
      logMetaWebhookError(result.errorCode ?? "unexpected_failure", {
        channel: event.channel,
        externalEventId: event.externalEventId,
        externalMessageId: event.externalMessageId,
      });
      hadRetryableFailure = true;
    }
  }

  if (hadRetryableFailure) {
    return textResponse("Unable to process event", 500);
  }

  return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
}
