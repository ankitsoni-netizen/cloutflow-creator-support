import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { classifyInboundEmailNoise } from "@/lib/email/inbound-classify";
import type { InboundEmailIngestResult } from "@/lib/email/inbound-ingest-core";
import {
  classifyBrevoInboundWebhookPayload,
  decideInboundAttachments,
  parseInboundEmailItem,
  uniqueAliasLocalPart,
} from "@/lib/email/inbound-parse";
import {
  INBOUND_BODY_MAX_CHARS,
  sanitizeInboundEmailBody,
} from "@/lib/email/inbound-sanitize";
import { normalizeEmailAddress } from "@/lib/email/reply-alias";

const INGEST_RPC = "ingest_brevo_inbound_email";

export type HandleInboundEmailResult = {
  status: number;
  body: { ok: boolean; outcome: string; errorCode?: string };
};

function selfSentAddresses(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return [
    env.BREVO_FROM_EMAIL,
    env.SUPPORT_INBOX_EMAIL,
    env.BREVO_REPLY_TO_EMAIL,
  ].filter((value): value is string => typeof value === "string");
}

export function planInboundEmailItem(
  item: unknown,
  env: Record<string, string | undefined> = process.env,
):
  | { ok: false; errorCode: "malformed_item" }
  | {
      ok: true;
      messageId: string;
      aliasLocalPart: string | null;
      ignoreReason: string | null;
      senderNormalized: string | null;
      bodyText: string;
      attachments: ReturnType<typeof decideInboundAttachments>;
    } {
  const parsed = parseInboundEmailItem(item);
  if (!parsed) return { ok: false, errorCode: "malformed_item" };

  const noise = classifyInboundEmailNoise({
    fromAddress: parsed.fromAddress,
    headers: parsed.headers,
    selfSentAddresses: selfSentAddresses(env),
  });

  const unique = uniqueAliasLocalPart(parsed.aliasLocalParts);
  const aliasLocalPart =
    noise || parsed.aliasLocalParts.length <= 1 ? unique : null;
  const attachments = decideInboundAttachments(parsed.attachments);
  const bodyText = sanitizeInboundEmailBody(
    parsed.markdown ?? parsed.text,
    parsed.markdown || parsed.text ? null : parsed.html,
  ).slice(0, INBOUND_BODY_MAX_CHARS);

  const ignoreReason =
    noise ?? (bodyText ? null : "empty_reply");

  return {
    ok: true,
    messageId: parsed.messageId,
    aliasLocalPart,
    ignoreReason,
    senderNormalized: normalizeEmailAddress(parsed.fromAddress),
    bodyText,
    attachments,
  };
}

export async function callIngestBrevoInboundEmail(input: {
  messageId: string;
  aliasLocalPart: string | null;
  senderNormalized: string | null;
  bodyText: string;
  ignoreReason: string | null;
  attachments: ReturnType<typeof decideInboundAttachments>;
}): Promise<InboundEmailIngestResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc(INGEST_RPC, {
    p_message_id: input.messageId,
    p_alias_local_part: input.aliasLocalPart,
    p_sender_normalized: input.senderNormalized,
    p_body_text: input.bodyText,
    p_ignore_reason: input.ignoreReason,
    p_attachments: input.attachments,
  });
  if (error) {
    throw Object.assign(new Error("inbound_email_persist_failed"), {
      code: "inbound_email_persist_failed",
    });
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  const outcome = String(payload.outcome ?? "rejected");
  if (
    outcome !== "appended" &&
    outcome !== "duplicate" &&
    outcome !== "ignored" &&
    outcome !== "rejected"
  ) {
    throw Object.assign(new Error("inbound_email_persist_failed"), {
      code: "inbound_email_persist_failed",
    });
  }
  return {
    outcome,
    errorCode: typeof payload.error_code === "string" ? payload.error_code : null,
    reopened: payload.reopened === true,
    commentId: typeof payload.comment_id === "string" ? payload.comment_id : null,
  };
}

export async function handleBrevoInboundEmailPayload(
  payload: unknown,
  env: Record<string, string | undefined> = process.env,
  ingest: typeof callIngestBrevoInboundEmail = callIngestBrevoInboundEmail,
): Promise<HandleInboundEmailResult> {
  const classified = classifyBrevoInboundWebhookPayload(payload);
  if (classified.kind === "ignored") {
    return {
      status: 200,
      body: { ok: true, outcome: "ignored", errorCode: "not_inbound_email" },
    };
  }
  if (classified.kind === "malformed") {
    return { status: 400, body: { ok: false, outcome: "rejected", errorCode: "malformed" } };
  }

  let sawRetryable = false;
  let processed = 0;
  let lastOutcome = "rejected";
  let lastCode: string | undefined;

  for (const item of classified.items) {
    const planned = planInboundEmailItem(item, env);
    if (!planned.ok) {
      continue;
    }
    processed += 1;
    try {
      const result = await ingest({
        messageId: planned.messageId,
        aliasLocalPart: planned.aliasLocalPart,
        senderNormalized: planned.senderNormalized,
        bodyText: planned.bodyText,
        ignoreReason: planned.ignoreReason,
        attachments: planned.attachments,
      });
      lastOutcome = result.outcome;
      lastCode = result.errorCode ?? undefined;
    } catch {
      sawRetryable = true;
    }
  }

  if (sawRetryable) {
    return {
      status: 500,
      body: { ok: false, outcome: "retryable", errorCode: "persist_failed" },
    };
  }

  if (processed === 0) {
    return {
      status: 400,
      body: { ok: false, outcome: "rejected", errorCode: "malformed_item" },
    };
  }

  return {
    status: 200,
    body: lastCode
      ? { ok: true, outcome: lastOutcome, errorCode: lastCode }
      : { ok: true, outcome: lastOutcome },
  };
}
