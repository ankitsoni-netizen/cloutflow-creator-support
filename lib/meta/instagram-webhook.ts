import "server-only";

import { getInstagramWebhookAppSecrets } from "@/lib/meta/config";
import { META_WEBHOOK_EVENT_RECEIVED } from "@/lib/meta/constants";
import { diagnoseMetaWebhookPayload } from "@/lib/meta/diagnose";
import {
  logMetaWebhookError,
  logMetaWebhookNormalizeDiagnostic,
} from "@/lib/meta/log";
import {
  extractInstagramEchoes,
  normalizeMetaWebhookPayload,
} from "@/lib/meta/normalize";
import { ingestInstagramEcho } from "@/lib/meta/instagram-echo";
import {
  createAdminInstagramStore,
  ingestInstagramInboundMessage,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-ingest";
import { createInstagramTimingSession } from "@/lib/meta/timing";
import {
  handleMetaWebhookGet,
  readVerifiedMetaWebhookPost,
  type MetaWebhookDeps,
} from "@/lib/meta/webhook";
import { NextResponse, type NextRequest } from "next/server";

export type InstagramWebhookDeps = MetaWebhookDeps & {
  instagramStore?: InstagramIngestStore;
};

function flushInstagramWebhookTiming(
  timing: ReturnType<typeof createInstagramTimingSession>,
) {
  timing.record("instagram_webhook_total_ms", timing.elapsedMs());
  timing.flush();
}

function textResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function handleInstagramWebhookGet(
  request: NextRequest,
  deps: InstagramWebhookDeps = {},
): NextResponse {
  return handleMetaWebhookGet(request, { ...deps, allowHealth: false });
}

export async function handleInstagramWebhookPost(
  request: NextRequest,
  deps: InstagramWebhookDeps = {},
): Promise<NextResponse> {
  /**
   * Meta delivers Instagram webhooks at-least-once. Duplicates are minimized by
   * claiming the webhook event id, unique inbound mids, last_processed_external_message_id,
   * and outbound idempotency keys. Once inbound + reservation are durable this
   * handler returns HTTP 200. Graph send retries belong to the Instagram outbox,
   * not Meta's inbound retry loop.
   */
  const env = deps.env ?? process.env;
  const verified = await readVerifiedMetaWebhookPost(
    request,
    env,
    getInstagramWebhookAppSecrets(env),
  );
  if (!verified.ok) return verified.response;

  const timing = createInstagramTimingSession();
  timing.mark("signature_verified");

  const payload = verified.payload;
  const echoes = extractInstagramEchoes(payload);
  const events = normalizeMetaWebhookPayload(payload).filter(
    (event) => event.channel === "instagram",
  );
  if (events.length === 0) {
    logMetaWebhookNormalizeDiagnostic(diagnoseMetaWebhookPayload(payload));
    if (echoes.length === 0) {
      flushInstagramWebhookTiming(timing);
      return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
    }
  }

  let store: InstagramIngestStore;
  try {
    store = deps.instagramStore ?? createAdminInstagramStore();
  } catch {
    logMetaWebhookError("admin_client_missing");
    flushInstagramWebhookTiming(timing);
    return textResponse("Unable to process event", 500);
  }

  let hadRetryableFailure = false;

  for (const event of events) {
    let result;
    try {
      result = await ingestInstagramInboundMessage(
        event,
        store,
        { webhookPayload: payload },
        { timing, sendDeps: { env } },
      );
    } catch {
      result = { outcome: "failed" as const, errorCode: "unexpected_failure" };
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

  for (const echo of echoes) {
    let result;
    try {
      result = await ingestInstagramEcho(echo, store, {
        webhookPayload: payload,
      });
    } catch {
      result = { outcome: "failed" as const, errorCode: "unexpected_failure" };
    }
    if (result.outcome === "failed") {
      logMetaWebhookError(result.errorCode ?? "unexpected_failure", {
        channel: "instagram",
        externalEventId: echo.externalEventId,
        externalMessageId: echo.externalMessageId,
      });
      hadRetryableFailure = true;
    }
  }

  if (hadRetryableFailure) {
    flushInstagramWebhookTiming(timing);
    return textResponse("Unable to process event", 500);
  }

  flushInstagramWebhookTiming(timing);
  return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
}
