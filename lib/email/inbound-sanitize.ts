const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_PATTERN = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const TAG_PATTERN = /<[^>]+>/g;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\([^)]*\)/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]*)]\([^)]*\)/g;

export const INBOUND_BODY_MAX_CHARS = 20_000;

function stripUnsafeMarkup(value: string): string {
  return value
    .replace(SCRIPT_PATTERN, " ")
    .replace(STYLE_PATTERN, " ")
    .replace(/javascript:/gi, " ")
    .replace(/data:/gi, " ")
    .replace(TAG_PATTERN, " ")
    .replace(MARKDOWN_IMAGE_PATTERN, " ")
    .replace(MARKDOWN_LINK_PATTERN, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeInboundEmailBody(
  markdownOrText: string | null | undefined,
  htmlFallback?: string | null,
): string {
  const primary =
    typeof markdownOrText === "string" && markdownOrText.trim()
      ? markdownOrText
      : "";
  if (primary) {
    return stripUnsafeMarkup(primary).slice(0, INBOUND_BODY_MAX_CHARS);
  }
  if (typeof htmlFallback === "string" && htmlFallback.trim()) {
    return stripUnsafeMarkup(htmlFallback).slice(0, INBOUND_BODY_MAX_CHARS);
  }
  return "";
}

const UNSAFE_NAME = /[\\/]|[.]+$|\.\./;

export function sanitizeAttachmentFilename(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base || base.length > 180 || UNSAFE_NAME.test(base)) return null;
  if (/[\r\n\u0000]/.test(base)) return null;
  return base;
}
