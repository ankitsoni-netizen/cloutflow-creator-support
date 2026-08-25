import "server-only";

import { getMetaWhatsAppPhoneNumberId } from "@/lib/meta/config";
import { META_WEBHOOK_EVENT_RECEIVED } from "@/lib/meta/constants";
import { diagnoseMetaWebhookPayload } from "@/lib/meta/diagnose";
import {
  logMetaWebhookError,
  logMetaWebhookNormalizeDiagnostic,
} from "@/lib/meta/log";
import {
  extractWhatsAppStatuses,
  normalizeMetaWebhookPayload,
} from "@/lib/meta/normalize";
import {
  createAdminInstagramStore,
  type InstagramIngestStore,
} from "@/lib/meta/instagram-store";
import {
  ingestWhatsAppInboundMessage,
  ingestWhatsAppStatus,
} from "@/lib/meta/whatsapp-ingest";
import { NextResponse } from "next/server";

function textResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function phoneNumberIdAllowed(
  incoming: string | null,
  expected: string | null,
): boolean {
  if (!expected) return true;
  if (!incoming) return false;
  return incoming === expected;
}

export async function processWhatsAppVerifiedPayload(
  payload: unknown,
  options: {
    env?: Record<string, string | undefined>;
    store?: InstagramIngestStore;
  } = {},
): Promise<NextResponse> {
  const env = options.env ?? process.env;
  const expectedPhoneId = getMetaWhatsAppPhoneNumberId(env);
  const statuses = extractWhatsAppStatuses(payload);
  const events = normalizeMetaWebhookPayload(payload).filter(
    (event) => event.channel === "whatsapp",
  );

  if (events.length === 0 && statuses.length === 0) {
    logMetaWebhookNormalizeDiagnostic(diagnoseMetaWebhookPayload(payload));
    return textResponse(META_WEBHOOK_EVENT_RECEIVED, 200);
  }

  let store: InstagramIngestStore;
  try {
    store = options.store ?? createAdminInstagramStore();
  } catch {
    logMetaWebhookError("admin_client_missing");
    return textResponse("Unable to process event", 500);
  }

  let hadRetryableFailure = false;

  for (const status of statuses) {
    if (!phoneNumberIdAllowed(status.phoneNumberId, expectedPhoneId)) {
      continue;
    }
    let result;
    try {
      result = await ingestWhatsAppStatus(status, store, { webhookPayload: payload });
    } catch {
      result = { outcome: "failed" as const, errorCode: "unexpected_failure" };
    }
    if (result.outcome === "failed") {
      logMetaWebhookError(result.errorCode ?? "unexpected_failure", {
        channel: "whatsapp",
        externalEventId: status.externalEventId,
        externalMessageId: status.metaMessageId,
      });
      hadRetryableFailure = true;
    }
  }

  for (const event of events) {
    if (!phoneNumberIdAllowed(event.phoneNumberId, expectedPhoneId)) {
      continue;
    }
    let result;
    try {
      result = await ingestWhatsAppInboundMessage(event, store, {
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
