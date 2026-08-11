import "server-only";

import { getBrevoSmtpConfig } from "@/lib/email/config";
import {
  getBrevoTransporter,
  mapTransportError,
} from "@/lib/email/transport";
import {
  EmailServiceError,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
} from "@/lib/email/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertEmail(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
    throw new EmailServiceError(
      "validation",
      `${label} must be a valid email address.`,
    );
  }
  return trimmed;
}

function buildSafeHeaders(
  headers: Record<string, string> | undefined,
  metadata: Record<string, string> | undefined,
): Record<string, string> {
  const safe: Record<string, string> = {};

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      const headerName = key.trim();
      const headerValue = value.trim();
      if (!headerName || !headerValue) continue;
      if (!/^x-cloutflow-[a-z0-9-]+$/i.test(headerName)) {
        throw new EmailServiceError(
          "validation",
          "Custom email headers must use the X-Cloutflow-* prefix.",
        );
      }
      if (/pass|secret|key|token|auth/i.test(headerName)) {
        throw new EmailServiceError(
          "validation",
          "Custom email headers must not reference secrets.",
        );
      }
      safe[headerName] = headerValue.slice(0, 200);
    }
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      const metaKey = key.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const metaValue = value.trim();
      if (!metaKey || !metaValue) continue;
      if (/pass|secret|key|token|auth/.test(metaKey)) {
        throw new EmailServiceError(
          "validation",
          "Email metadata keys must not reference secrets.",
        );
      }
      safe[`X-Cloutflow-Meta-${metaKey}`] = metaValue.slice(0, 200);
    }
  }

  return safe;
}

/**
 * Send a transactional email through Brevo SMTP.
 * Returns SMTP acceptance details only — not inbox delivery confirmation.
 */
export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
): Promise<SendTransactionalEmailResult> {
  const config = getBrevoSmtpConfig();

  const toEmail = assertEmail(input.toEmail, "Recipient email");
  const subject = input.subject.trim();
  if (!subject) {
    throw new EmailServiceError("validation", "Email subject is required.");
  }

  const html = input.html.trim();
  const text = input.text.trim();
  if (!html || !text) {
    throw new EmailServiceError(
      "validation",
      "Both HTML and plain-text email content are required.",
    );
  }

  const replyTo = assertEmail(
    input.replyTo?.trim() || config.replyToEmail,
    "Reply-To email",
  );

  const toName = input.toName?.trim();
  const to = toName ? `"${toName.replace(/"/g, "")}" <${toEmail}>` : toEmail;
  const headers = buildSafeHeaders(input.headers, input.metadata);

  try {
    const info = await getBrevoTransporter().sendMail({
      from: `"${config.fromName.replace(/"/g, "")}" <${config.fromEmail}>`,
      to,
      replyTo,
      subject,
      html,
      text,
      headers,
    });

    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);

    if (accepted.length === 0) {
      throw new EmailServiceError(
        "send",
        "Brevo SMTP did not accept the message for any recipient.",
      );
    }

    return {
      messageId: info.messageId ? String(info.messageId) : null,
      accepted,
      rejected,
      status: "accepted_by_brevo",
    };
  } catch (error) {
    if (error instanceof EmailServiceError) throw error;
    throw mapTransportError(error, "send");
  }
}
