import "server-only";

/**
 * Server-only Meta Cloud API configuration.
 * Never expose these values via NEXT_PUBLIC_* variables.
 *
 * Required for webhook verification (this phase):
 * - META_WEBHOOK_VERIFY_TOKEN (falls back to META_VERIFY_TOKEN)
 * - META_APP_SECRET
 *
 * Used later for outbound Graph API calls; unused in this phase:
 * - META_GRAPH_API_VERSION
 * - META_WHATSAPP_ACCESS_TOKEN
 * - META_WHATSAPP_PHONE_NUMBER_ID
 * - META_IG_ACCESS_TOKEN (falls back to META_INSTAGRAM_ACCESS_TOKEN)
 * - META_IG_ACCOUNT_ID (falls back to META_INSTAGRAM_ACCOUNT_ID)
 *
 * Readers are lazy: CRM pages can load before Meta is configured.
 */

export const META_ENV = {
  VERIFY_TOKEN: "META_VERIFY_TOKEN",
  WEBHOOK_VERIFY_TOKEN: "META_WEBHOOK_VERIFY_TOKEN",
  APP_SECRET: "META_APP_SECRET",
  GRAPH_API_VERSION: "META_GRAPH_API_VERSION",
  WHATSAPP_ACCESS_TOKEN: "META_WHATSAPP_ACCESS_TOKEN",
  WHATSAPP_PHONE_NUMBER_ID: "META_WHATSAPP_PHONE_NUMBER_ID",
  INSTAGRAM_ACCESS_TOKEN: "META_INSTAGRAM_ACCESS_TOKEN",
  INSTAGRAM_ACCOUNT_ID: "META_INSTAGRAM_ACCOUNT_ID",
  IG_ACCESS_TOKEN: "META_IG_ACCESS_TOKEN",
  IG_ACCOUNT_ID: "META_IG_ACCOUNT_ID",
} as const;

export type MetaEnvName = (typeof META_ENV)[keyof typeof META_ENV];

export function readMetaEnv(
  name: MetaEnvName,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getMetaVerifyToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    readMetaEnv(META_ENV.WEBHOOK_VERIFY_TOKEN, env) ??
    readMetaEnv(META_ENV.VERIFY_TOKEN, env)
  );
}

export function getMetaAppSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return readMetaEnv(META_ENV.APP_SECRET, env);
}

/**
 * Graph API version is not needed for webhook ingest.
 * Prefer an explicit META_GRAPH_API_VERSION; no implicit default here.
 */
export function getMetaGraphApiVersion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return readMetaEnv(META_ENV.GRAPH_API_VERSION, env);
}

export function getMetaWhatsAppSendConfig(
  env: Record<string, string | undefined> = process.env,
): { accessToken: string; phoneNumberId: string } | null {
  const accessToken = readMetaEnv(META_ENV.WHATSAPP_ACCESS_TOKEN, env);
  const phoneNumberId = readMetaEnv(META_ENV.WHATSAPP_PHONE_NUMBER_ID, env);
  if (!accessToken || !phoneNumberId) return null;
  return { accessToken, phoneNumberId };
}

export function getMetaInstagramSendConfig(
  env: Record<string, string | undefined> = process.env,
): { accessToken: string; accountId: string } | null {
  const accessToken =
    readMetaEnv(META_ENV.IG_ACCESS_TOKEN, env) ??
    readMetaEnv(META_ENV.INSTAGRAM_ACCESS_TOKEN, env);
  const accountId =
    readMetaEnv(META_ENV.IG_ACCOUNT_ID, env) ??
    readMetaEnv(META_ENV.INSTAGRAM_ACCOUNT_ID, env);
  if (!accessToken || !accountId) return null;
  return { accessToken, accountId };
}
