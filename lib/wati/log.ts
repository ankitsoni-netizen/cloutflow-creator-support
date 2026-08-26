/**
 * Sanitized WATI webhook logs. Never include message text, phones, tokens,
 * query strings, raw bodies, sourceUrl, avatarUrl, or full payloads.
 */

export function logWatiWebhookError(
  errorCode: string,
  identifiers: {
    externalEventId?: string | null;
    externalMessageId?: string | null;
  } = {},
): void {
  console.error("wati webhook storage failed", {
    errorCode,
    externalEventId: identifiers.externalEventId ?? null,
    externalMessageId: identifiers.externalMessageId ?? null,
  });
}

export function logWatiWebhookMisconfiguration(reason: string): void {
  console.error("wati webhook misconfigured", { reason });
}

export function logWatiWebhookAuthFailure(
  reason: "token_missing" | "token_invalid" | "secret_missing",
): void {
  console.error("wati webhook auth failed", { reason });
}
