/**
 * Sanitized Meta webhook logs. Never include message text, emails, phones,
 * access tokens, signatures, or full payloads.
 */
export function logMetaWebhookError(
  errorCode: string,
  identifiers: {
    channel?: string | null;
    externalEventId?: string | null;
    externalMessageId?: string | null;
  } = {},
): void {
  console.error("meta webhook storage failed", {
    errorCode,
    channel: identifiers.channel ?? null,
    externalEventId: identifiers.externalEventId ?? null,
    externalMessageId: identifiers.externalMessageId ?? null,
  });
}

export function logMetaWebhookMisconfiguration(reason: string): void {
  console.error("meta webhook misconfigured", { reason });
}

export type MetaWebhookSignatureFailureReason =
  | "signature_missing"
  | "signature_invalid";

/**
 * Diagnostic-only: reason codes for HMAC verification failures.
 * Never include the signature header, body, App Secret, or payload contents.
 */
export function logMetaWebhookSignatureFailure(
  reason: MetaWebhookSignatureFailureReason,
): void {
  console.error("meta webhook signature verification failed", { reason });
}
