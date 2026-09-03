import "server-only";

import { timingSafeEqualString } from "@/lib/meta/signature";

export const WATI_OUTBOX_DRAIN_SECRET_ENV = "WATI_OUTBOX_DRAIN_SECRET";

export function getWatiOutboxDrainSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[WATI_OUTBOX_DRAIN_SECRET_ENV];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function bearerTokenFromAuthorization(
  header: string | null | undefined,
): string | null {
  if (typeof header !== "string") return null;
  const match = header.trim().match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

export function verifyWatiOutboxDrainAuth(
  authorizationHeader: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = getWatiOutboxDrainSecret(env);
  const provided = bearerTokenFromAuthorization(authorizationHeader);
  if (!expected || !provided) return false;
  return timingSafeEqualString(provided, expected);
}
