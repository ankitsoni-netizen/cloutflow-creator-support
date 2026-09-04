import { normalizeEmailAddress } from "@/lib/email/reply-alias";

export const INBOUND_IGNORE_BOUNCE = "bounce";
export const INBOUND_IGNORE_AUTO_REPLY = "auto_reply";
export const INBOUND_IGNORE_DELIVERY_STATUS = "delivery_status";
export const INBOUND_IGNORE_SELF_SENT = "self_sent";

const MAILER_LOCAL_PARTS = new Set([
  "mailer-daemon",
  "mailerdaemon",
  "postmaster",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
]);

function headerLookup(
  headers: Record<string, unknown> | null | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0].trim();
    }
  }
  return null;
}

export function classifyInboundEmailNoise(input: {
  fromAddress: string | null;
  headers?: Record<string, unknown> | null;
  selfSentAddresses: string[];
}): string | null {
  const from = normalizeEmailAddress(input.fromAddress);
  const autoSubmitted = headerLookup(input.headers, "auto-submitted");
  if (autoSubmitted && !/^no$/i.test(autoSubmitted)) {
    return INBOUND_IGNORE_AUTO_REPLY;
  }
  const precedence = headerLookup(input.headers, "precedence");
  if (precedence && /^(bulk|junk|list)$/i.test(precedence)) {
    return INBOUND_IGNORE_AUTO_REPLY;
  }
  if (headerLookup(input.headers, "x-auto-response-suppress")) {
    return INBOUND_IGNORE_AUTO_REPLY;
  }
  if (headerLookup(input.headers, "x-autoreply")) {
    return INBOUND_IGNORE_AUTO_REPLY;
  }
  if (headerLookup(input.headers, "x-autorespond")) {
    return INBOUND_IGNORE_AUTO_REPLY;
  }

  const contentType = headerLookup(input.headers, "content-type");
  if (contentType && /multipart\/report/i.test(contentType)) {
    return INBOUND_IGNORE_DELIVERY_STATUS;
  }
  if (headerLookup(input.headers, "x-failed-recipients")) {
    return INBOUND_IGNORE_BOUNCE;
  }

  if (from) {
    if (from.endsWith("@reply.cloutflow.com")) return INBOUND_IGNORE_SELF_SENT;
    for (const own of input.selfSentAddresses) {
      const normalizedOwn = normalizeEmailAddress(own);
      if (normalizedOwn && normalizedOwn === from) {
        return INBOUND_IGNORE_SELF_SENT;
      }
    }
    const local = from.slice(0, from.indexOf("@"));
    if (MAILER_LOCAL_PARTS.has(local)) return INBOUND_IGNORE_BOUNCE;
  }

  return null;
}
