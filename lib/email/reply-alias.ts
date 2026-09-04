export const REPLY_ALIAS_DOMAIN = "reply.cloutflow.com";
export const REPLY_ALIAS_LOCAL_PATTERN = /^t-[0-9a-f]{32}$/;
const REPLY_ALIAS_ADDRESS_PATTERN =
  /^t-[0-9a-f]{32}@reply\.cloutflow\.com$/i;

export function normalizeEmailAddress(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  if (/[\r\n]/.test(trimmed)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function parseReplyAliasLocalPart(
  address: string | null | undefined,
): string | null {
  const normalized = normalizeEmailAddress(address);
  if (!normalized || !REPLY_ALIAS_ADDRESS_PATTERN.test(normalized)) {
    return null;
  }
  const local = normalized.slice(0, normalized.indexOf("@"));
  return REPLY_ALIAS_LOCAL_PATTERN.test(local) ? local : null;
}

export function collectReplyAliasLocalParts(
  addresses: Array<string | null | undefined>,
): string[] {
  const unique = new Set<string>();
  for (const address of addresses) {
    const local = parseReplyAliasLocalPart(address);
    if (local) unique.add(local);
  }
  return [...unique];
}

export function formatReplyAliasAddress(localPart: string): string {
  return `${localPart}@${REPLY_ALIAS_DOMAIN}`;
}
