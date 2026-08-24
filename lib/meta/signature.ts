import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  META_SIGNATURE_PREFIX,
} from "@/lib/meta/constants";

const SHA256_HEX_LENGTH = 64;
const HEX_DIGEST_PATTERN = /^[0-9a-f]+$/i;

export function timingSafeEqualString(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Verifies Meta `x-hub-signature-256: sha256=<hex>` against the exact raw body.
 * Rejects missing or malformed signatures. Does not log secrets or payloads.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const header = signatureHeader.trim();
  if (!header.toLowerCase().startsWith(META_SIGNATURE_PREFIX)) return false;

  const providedHex = header.slice(META_SIGNATURE_PREFIX.length).trim();
  if (
    providedHex.length !== SHA256_HEX_LENGTH ||
    !HEX_DIGEST_PATTERN.test(providedHex)
  ) {
    return false;
  }

  let providedDigest: Buffer;
  try {
    providedDigest = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }

  const expectedDigest = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest();

  if (providedDigest.length !== expectedDigest.length) return false;
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Accepts the signature if it matches any of the provided secrets.
 * Checks every unique secret so timing does not reveal which value matched.
 * Never logs secrets, signatures, or bodies.
 */
export function verifyMetaSignatureAgainstSecrets(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  appSecrets: readonly string[],
): boolean {
  if (appSecrets.length === 0) return false;
  let matched = false;
  for (const secret of appSecrets) {
    if (verifyMetaSignature(rawBody, signatureHeader, secret)) {
      matched = true;
    }
  }
  return matched;
}
