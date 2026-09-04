import { timingSafeEqualString } from "@/lib/meta/signature";

export const BREVO_INBOUND_WEBHOOK_SECRET_ENV = "BREVO_INBOUND_WEBHOOK_SECRET";
export const BREVO_INBOUND_WEBHOOK_HEADER = "x-cloutflow-inbound-email-secret";

export function getBrevoInboundWebhookSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[BREVO_INBOUND_WEBHOOK_SECRET_ENV];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function headerValue(
  headers: Headers | Record<string, string | null | undefined>,
  name: string,
): string | null {
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(name);
    return value?.trim() ? value.trim() : null;
  }
  const record = headers as Record<string, string | null | undefined>;
  const direct = record[name] ?? record[name.toLowerCase()];
  return typeof direct === "string" && direct.trim() ? direct.trim() : null;
}

export function verifyBrevoInboundWebhookAuth(
  headers: Headers | Record<string, string | null | undefined>,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = getBrevoInboundWebhookSecret(env);
  const provided = headerValue(headers, BREVO_INBOUND_WEBHOOK_HEADER);
  if (!expected || !provided) return false;
  return timingSafeEqualString(provided, expected);
}
