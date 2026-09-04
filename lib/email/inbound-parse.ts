import { collectReplyAliasLocalParts } from "@/lib/email/reply-alias";
import { sanitizeAttachmentFilename } from "@/lib/email/inbound-sanitize";

export const INBOUND_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const INBOUND_ATTACHMENT_MAX_COUNT = 8;

export const INBOUND_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

export type InboundAttachmentDecision = {
  filename: string;
  content_type: string;
  byte_size: number | null;
  status:
    | "accepted_metadata"
    | "rejected_type"
    | "rejected_size"
    | "rejected_name"
    | "unavailable";
};

export type ParsedInboundEmail = {
  messageId: string;
  fromAddress: string | null;
  aliasLocalParts: string[];
  subject: string | null;
  markdown: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, unknown>;
  attachments: Array<{
    name: string | null;
    contentType: string | null;
    contentLength: number | null;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Mailbox.Address, a bare address, or `Name <address>`. Never uses display Name. */
export function readMailboxAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const angled = trimmed.match(/<([^<>]+)>/);
    return (angled?.[1] ?? trimmed).trim();
  }
  const record = asRecord(value);
  if (!record) return null;
  return readString(record, "Address", "address");
}

function collectAddresses(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectAddresses(entry));
  }
  const address = readMailboxAddress(value);
  return address ? [address] : [];
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

export function normalizeInboundContentType(
  value: string | null | undefined,
): string {
  const raw = (value ?? "application/octet-stream").trim().toLowerCase();
  return raw.split(";")[0]?.trim() || "application/octet-stream";
}

export type ClassifiedInboundWebhook =
  | { kind: "inbound"; items: unknown[] }
  | { kind: "ignored" }
  | { kind: "malformed" };

export function classifyBrevoInboundWebhookPayload(
  payload: unknown,
): ClassifiedInboundWebhook {
  const record = asRecord(payload);
  if (!record) return { kind: "malformed" };
  if (Array.isArray(record.items)) {
    return { kind: "inbound", items: record.items };
  }
  const event = typeof record.event === "string" ? record.event.trim() : "";
  if (event && event !== "inboundEmailProcessed") {
    return { kind: "ignored" };
  }
  if (event === "inboundEmailProcessed" || record.MessageId || record.messageId) {
    return { kind: "inbound", items: [record] };
  }
  return { kind: "malformed" };
}

export function parseInboundEmailItem(item: unknown): ParsedInboundEmail | null {
  const record = asRecord(item);
  if (!record) return null;
  const messageId = readString(record, "MessageId", "messageId", "message_id");
  if (!messageId) return null;

  const headers = asRecord(record.Headers) ?? asRecord(record.headers) ?? {};
  const to = collectAddresses(record.To ?? record.to);
  const cc = collectAddresses(record.Cc ?? record.cc);
  const recipients = collectAddresses(record.Recipients ?? record.recipients);
  const delivered = collectAddresses(
    record.DeliveredTo ?? record["Delivered-To"] ?? headers["Delivered-To"],
  );

  return {
    messageId,
    fromAddress: readMailboxAddress(record.From ?? record.from),
    aliasLocalParts: collectReplyAliasLocalParts([
      ...to,
      ...cc,
      ...recipients,
      ...delivered,
    ]),
    subject: readString(record, "Subject", "subject"),
    markdown: readString(
      record,
      "ExtractedMarkdownMessage",
      "extractedMarkdownMessage",
    ),
    text: readString(record, "RawTextBody", "rawTextBody"),
    html: readString(record, "RawHtmlBody", "rawHtmlBody"),
    headers,
    attachments: (Array.isArray(record.Attachments) ? record.Attachments : []).map(
      (attachment) => {
        const row = asRecord(attachment) ?? {};
        return {
          name: readString(row, "Name", "name", "filename"),
          contentType: readString(row, "ContentType", "contentType", "content_type"),
          contentLength: readNumber(row.ContentLength ?? row.contentLength ?? row.size),
        };
      },
    ),
  };
}

export function decideInboundAttachments(
  attachments: ParsedInboundEmail["attachments"],
): InboundAttachmentDecision[] {
  return attachments.slice(0, INBOUND_ATTACHMENT_MAX_COUNT).map((attachment) => {
    const filename = sanitizeAttachmentFilename(attachment.name);
    const contentType = normalizeInboundContentType(attachment.contentType);
    const byteSize = attachment.contentLength;
    if (!filename) {
      return {
        filename: "file",
        content_type: contentType,
        byte_size: byteSize,
        status: "rejected_name",
      };
    }
    if (!INBOUND_ALLOWED_MIME_TYPES.has(contentType)) {
      return {
        filename,
        content_type: contentType,
        byte_size: byteSize,
        status: "rejected_type",
      };
    }
    if (byteSize != null && byteSize > INBOUND_ATTACHMENT_MAX_BYTES) {
      return {
        filename,
        content_type: contentType,
        byte_size: byteSize,
        status: "rejected_size",
      };
    }
    return {
      filename,
      content_type: contentType,
      byte_size: byteSize,
      status: "accepted_metadata",
    };
  });
}

export function uniqueAliasLocalPart(parts: string[]): string | null {
  if (parts.length !== 1) return null;
  return parts[0] ?? null;
}
