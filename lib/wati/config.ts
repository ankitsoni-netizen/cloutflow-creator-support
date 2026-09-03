import "server-only";

/**
 * Server-only WATI WhatsApp configuration.
 * Never expose these via NEXT_PUBLIC_* variables.
 *
 * - WHATSAPP_PROVIDER (wati | meta) — required; missing/invalid fails closed
 * - WATI_API_ENDPOINT
 * - WATI_API_TOKEN (token only; Authorization Bearer is added by the client)
 * - WATI_CHANNEL_PHONE_NUMBER
 * - WATI_CONVERSATION_TARGET_MODE (channel_recipient | recipient; unset defaults)
 * - WATI_WEBHOOK_SECRET
 * - WATI_OUTBOX_DRAIN_SECRET (internal drain route only; never a send credential)
 */

export const WATI_ENV = {
  WHATSAPP_PROVIDER: "WHATSAPP_PROVIDER",
  API_ENDPOINT: "WATI_API_ENDPOINT",
  API_TOKEN: "WATI_API_TOKEN",
  CHANNEL_PHONE_NUMBER: "WATI_CHANNEL_PHONE_NUMBER",
  CONVERSATION_TARGET_MODE: "WATI_CONVERSATION_TARGET_MODE",
  WEBHOOK_SECRET: "WATI_WEBHOOK_SECRET",
} as const;

export const WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT =
  "channel_recipient" as const;
export const WATI_CONVERSATION_TARGET_MODE_RECIPIENT = "recipient" as const;

export const WATI_CONVERSATION_TARGET_MODES = [
  WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT,
  WATI_CONVERSATION_TARGET_MODE_RECIPIENT,
] as const;

export type WatiConversationTargetMode =
  (typeof WATI_CONVERSATION_TARGET_MODES)[number];

export const INVALID_WATI_CONVERSATION_TARGET_MODE =
  "invalid_wati_conversation_target_mode" as const;

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

export type WatiConversationTargetModeResolution =
  | { ok: true; mode: WatiConversationTargetMode }
  | { ok: false; errorCode: typeof INVALID_WATI_CONVERSATION_TARGET_MODE };

/**
 * Unset or blank → channel_recipient.
 * Only channel_recipient and recipient are allowed.
 * Invalid values fail closed. Never logs the raw value.
 */
export function resolveWatiConversationTargetMode(
  env: Record<string, string | undefined> = process.env,
): WatiConversationTargetModeResolution {
  const raw = env[WATI_ENV.CONVERSATION_TARGET_MODE];
  if (raw === undefined || raw === null) {
    return { ok: true, mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT };
  }
  if (typeof raw !== "string") {
    return { ok: false, errorCode: INVALID_WATI_CONVERSATION_TARGET_MODE };
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { ok: true, mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT };
  }
  if (normalized === WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT) {
    return { ok: true, mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT };
  }
  if (normalized === WATI_CONVERSATION_TARGET_MODE_RECIPIENT) {
    return { ok: true, mode: WATI_CONVERSATION_TARGET_MODE_RECIPIENT };
  }
  return { ok: false, errorCode: INVALID_WATI_CONVERSATION_TARGET_MODE };
}

export type WatiSendConfig = {
  apiEndpoint: string;
  apiToken: string;
  channelPhoneNumber: string;
  conversationTargetMode?: WatiConversationTargetMode;
};

export type WatiSendConfigResolution =
  | { ok: true; config: WatiSendConfig }
  | {
      ok: false;
      errorCode:
        | "wati_send_not_configured"
        | typeof INVALID_WATI_CONVERSATION_TARGET_MODE;
    };

/**
 * Validated WATI send config. Channel phone remains required in every mode.
 * Does not log endpoint, token, phone, or mode values.
 */
export function resolveWatiSendConfig(
  env: Record<string, string | undefined> = process.env,
): WatiSendConfigResolution {
  const apiEndpoint = readWatiEnv(WATI_ENV.API_ENDPOINT, env);
  const apiToken = readWatiEnv(WATI_ENV.API_TOKEN, env);
  const channelPhoneNumber = getWatiChannelPhoneNumber(env);
  if (!apiEndpoint || !apiToken || !channelPhoneNumber) {
    return { ok: false, errorCode: "wati_send_not_configured" };
  }
  const mode = resolveWatiConversationTargetMode(env);
  if (!mode.ok) return mode;
  return {
    ok: true,
    config: {
      apiEndpoint,
      apiToken,
      channelPhoneNumber,
      conversationTargetMode: mode.mode,
    },
  };
}

/**
 * Returns a validated WATI send config, or null when incomplete or invalid.
 * Does not log endpoint or token values.
 */
export function getWatiSendConfig(
  env: Record<string, string | undefined> = process.env,
): WatiSendConfig | null {
  const resolved = resolveWatiSendConfig(env);
  return resolved.ok ? resolved.config : null;
}
