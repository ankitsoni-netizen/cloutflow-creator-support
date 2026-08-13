import "server-only";

import { timingSafeEqual } from "node:crypto";

export const WHATSAPP_INTAKE_UNAUTHORIZED = {
  success: false as const,
  message: "Unauthorized.",
};

export const WHATSAPP_INTAKE_UNAVAILABLE = {
  success: false as const,
  message: "Support intake is temporarily unavailable. Please try again later.",
};

function configuredApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env.WHATSAPP_INTAKE_API_KEY;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function apiKeysMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Server-to-server API key check for WhatsApp intake.
 * Never logs or returns the key value.
 */
export function verifyWhatsAppIntakeApiKey(
  providedHeader: string | null,
  env: Record<string, string | undefined> = process.env,
):
  | { ok: true }
  | { ok: false; status: 401 | 503; response: { success: false; message: string } } {
  const expected = configuredApiKey(env);
  if (!expected) {
    console.error("whatsapp intake: server API key is not configured");
    return {
      ok: false,
      status: 503,
      response: WHATSAPP_INTAKE_UNAVAILABLE,
    };
  }

  const provided = providedHeader?.trim() ?? "";
  if (!provided || !apiKeysMatch(provided, expected)) {
    return {
      ok: false,
      status: 401,
      response: WHATSAPP_INTAKE_UNAUTHORIZED,
    };
  }

  return { ok: true };
}
