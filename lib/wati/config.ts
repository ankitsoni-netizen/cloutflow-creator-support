import "server-only";

/**
 * Server-only WATI WhatsApp configuration.
 * Never expose these via NEXT_PUBLIC_* variables.
 *
 * - WHATSAPP_PROVIDER (wati | meta) — required; missing/invalid fails closed
 * - WATI_API_ENDPOINT
 * - WATI_API_TOKEN (token only; Authorization Bearer is added by the client)
 * - WATI_CHANNEL_PHONE_NUMBER
 * - WATI_WEBHOOK_SECRET
 */

export const WATI_ENV = {
  WHATSAPP_PROVIDER: "WHATSAPP_PROVIDER",
  API_ENDPOINT: "WATI_API_ENDPOINT",
  API_TOKEN: "WATI_API_TOKEN",
  CHANNEL_PHONE_NUMBER: "WATI_CHANNEL_PHONE_NUMBER",
  WEBHOOK_SECRET: "WATI_WEBHOOK_SECRET",
} as const;

export type WatiEnvName = (typeof WATI_ENV)[keyof typeof WATI_ENV];

export const WHATSAPP_PROVIDER_NOT_CONFIGURED =
  "whatsapp_provider_not_configured" as const;

export type WhatsAppProviderName = "wati" | "meta";

export type WhatsAppProviderResolution =
  | { ok: true; provider: WhatsAppProviderName }
  | { ok: false; errorCode: typeof WHATSAPP_PROVIDER_NOT_CONFIGURED };

export function readWatiEnv(
  name: WatiEnvName,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fail-closed provider selection.
 * - wati → WATI only
 * - meta → Meta Cloud API only
 * - missing, blank, or any other value → whatsapp_provider_not_configured
 * Never silently defaults to Meta.
 */
export function resolveWhatsAppProvider(
  env: Record<string, string | undefined> = process.env,
): WhatsAppProviderResolution {
  const raw = env[WATI_ENV.WHATSAPP_PROVIDER];
  if (typeof raw !== "string") {
    return { ok: false, errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED };
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { ok: false, errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED };
  }
  if (normalized === "wati") return { ok: true, provider: "wati" };
  if (normalized === "meta") return { ok: true, provider: "meta" };
  return { ok: false, errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED };
}

/**
 * @deprecated Prefer resolveWhatsAppProvider for fail-closed behaviour.
 * Returns null when the provider is missing or invalid.
 */
export function getWhatsAppProviderName(
  env: Record<string, string | undefined> = process.env,
): WhatsAppProviderName | null {
  const resolved = resolveWhatsAppProvider(env);
  return resolved.ok ? resolved.provider : null;
}

export function getWatiWebhookSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return readWatiEnv(WATI_ENV.WEBHOOK_SECRET, env);
}

export function getWatiChannelPhoneNumber(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = readWatiEnv(WATI_ENV.CHANNEL_PHONE_NUMBER, env);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export type WatiSendConfig = {
  apiEndpoint: string;
  apiToken: string;
  channelPhoneNumber: string;
};

/**
 * Returns a validated WATI send config, or null when incomplete.
 * Does not log endpoint or token values.
 */
export function getWatiSendConfig(
  env: Record<string, string | undefined> = process.env,
): WatiSendConfig | null {
  const apiEndpoint = readWatiEnv(WATI_ENV.API_ENDPOINT, env);
  const apiToken = readWatiEnv(WATI_ENV.API_TOKEN, env);
  const channelPhoneNumber = getWatiChannelPhoneNumber(env);
  if (!apiEndpoint || !apiToken || !channelPhoneNumber) return null;
  return { apiEndpoint, apiToken, channelPhoneNumber };
}
