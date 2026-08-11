/**
 * Pure Brevo env presence check (no network, no secret values).
 */

const REQUIRED_BREVO_ENV = [
  "BREVO_SMTP_HOST",
  "BREVO_SMTP_PORT",
  "BREVO_SMTP_USER",
  "BREVO_SMTP_KEY",
  "BREVO_FROM_EMAIL",
  "BREVO_FROM_NAME",
  "BREVO_REPLY_TO_EMAIL",
] as const;

export type BrevoConfigStatus = "configured" | "not_configured";

export function getBrevoConfigStatus(
  env: Record<string, string | undefined> = process.env,
): BrevoConfigStatus {
  for (const key of REQUIRED_BREVO_ENV) {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) {
      return "not_configured";
    }
  }
  return "configured";
}

export function isBrevoConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getBrevoConfigStatus(env) === "configured";
}
