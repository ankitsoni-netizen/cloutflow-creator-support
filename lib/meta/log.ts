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

export type MetaWebhookNormalizeLogFields = {
  objectType: string | null;
  entryCount: number;
  messagingEventCount: number;
  hasMessage: boolean;
  hasSender: boolean;
  hasRecipient: boolean;
  hasMessageId: boolean;
  ignoredReason: string | null;
};

/**
 * Privacy-safe normalize diagnostics. Never include payloads, IDs, usernames,
 * message text, tokens, or signatures.
 */
export function logMetaWebhookNormalizeDiagnostic(
  diagnostic: MetaWebhookNormalizeLogFields,
): void {
  console.info("meta webhook normalize diagnostic", {
    objectType: diagnostic.objectType,
    entryCount: diagnostic.entryCount,
    messagingEventCount: diagnostic.messagingEventCount,
    hasMessage: diagnostic.hasMessage,
    hasSender: diagnostic.hasSender,
    hasRecipient: diagnostic.hasRecipient,
    hasMessageId: diagnostic.hasMessageId,
    ignoredReason: diagnostic.ignoredReason,
  });
}
