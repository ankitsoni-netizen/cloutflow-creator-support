export const INSTAGRAM_EMAIL_DRAIN_PURPOSES = [
  "instagram-ticket-confirmation",
  "instagram-inbound-notify",
  "instagram-agency-details",
  "instagram-general-inquiry",
  "whatsapp-ticket-confirmation",
] as const;

export type InstagramEmailDrainPurpose =
  (typeof INSTAGRAM_EMAIL_DRAIN_PURPOSES)[number];

export const INSTAGRAM_EMAIL_TERMINAL_CODES = new Set([
  "creator_email_invalid",
  "support_inbox_missing",
  "empty_reply",
  "no_email_recipient",
  "email_retry_exhausted",
]);

export function isInstagramEmailDrainPurpose(
  purpose: string,
): purpose is InstagramEmailDrainPurpose {
  return (INSTAGRAM_EMAIL_DRAIN_PURPOSES as readonly string[]).includes(purpose);
}

export function isInstagramEmailTerminalError(
  errorCode: string | null | undefined,
): boolean {
  const code = errorCode?.trim() ?? "";
  return code.length > 0 && INSTAGRAM_EMAIL_TERMINAL_CODES.has(code);
}
