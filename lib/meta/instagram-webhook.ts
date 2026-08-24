import "server-only";

import { getInstagramWebhookAppSecrets } from "@/lib/meta/config";
import { META_WEBHOOK_EVENT_RECEIVED } from "@/lib/meta/constants";
import { diagnoseMetaWebhookPayload } from "@/lib/meta/diagnose";
import {
  logMetaWebhookError,
  logMetaWebhookNormalizeDiagnostic,
} from "@/lib/meta/log";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import {
  createAdminInstagramStore,
  ingestInstagramInboundMessage,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-ingest";
import {
  handleMetaWebhookGet,
  readVerifiedMetaWebhookPost,
  type MetaWebhookDeps,
} from "@/lib/meta/webhook";
import { NextResponse, type NextRequest } from "next/server";

export type InstagramWebhookDeps = MetaWebhookDeps & {
  instagramStore?: InstagramIngestStore;
};

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
  const env = deps.env ?? process.env;
  const verified = await readVerifiedMetaWebhookPost(
    request,
    env,
    getInstagramWebhookAppSecrets(env),
  );
  if (!verified.ok) return verified.response;

  const payload = verified.payload;
  const events = normalizeMetaWebhookPayload(payload).filter(
    (event) => event.channel === "instagram",
  );
  if (events.length === 0) {
    logMetaWebhookNormalizeDiagnostic(diagnoseMetaWebhookPayload(payload));
    return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
  }

  let store: InstagramIngestStore;
  try {
    store = deps.instagramStore ?? createAdminInstagramStore();
  } catch {
    logMetaWebhookError("admin_client_missing");
    return textResponse("Unable to process event", 500);
  }

  let hadRetryableFailure = false;
  for (const event of events) {
    let result;
    try {
      result = await ingestInstagramInboundMessage(event, store, {
        webhookPayload: payload,
      });
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

  if (hadRetryableFailure) {
    return textResponse("Unable to process event", 500);
  }

  return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
}
