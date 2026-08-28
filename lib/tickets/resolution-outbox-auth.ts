import { timingSafeEqualString } from "@/lib/meta/signature";

export const TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET_ENV =
  "TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET";

export function getTicketResolutionOutboxDrainSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET_ENV];
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

export function verifyTicketResolutionOutboxDrainAuth(
  authorizationHeader: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = getTicketResolutionOutboxDrainSecret(env);
  const provided = bearerTokenFromAuthorization(authorizationHeader);
  if (!expected || !provided) return false;
  return timingSafeEqualString(provided, expected);
}
