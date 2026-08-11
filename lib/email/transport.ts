import "server-only";

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getBrevoSmtpConfig } from "@/lib/email/config";
import { EmailServiceError } from "@/lib/email/types";

type Transporter = nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

let transporter: Transporter | null = null;

/**
 * Returns a reused Nodemailer transporter for Brevo SMTP.
 * Auth material stays inside this module / transporter instance.
 */
export function getBrevoTransporter(): Transporter {
  if (transporter) return transporter;

  const config = getBrevoSmtpConfig();

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  return transporter;
}

export function resetBrevoTransporter(): void {
  transporter = null;
}

export async function verifyBrevoTransporter(): Promise<void> {
  const transport = getBrevoTransporter();
  try {
    await transport.verify();
  } catch (error) {
    throw mapTransportError(error, "connection");
  }
}

export function mapTransportError(
  error: unknown,
  fallback: "authentication" | "connection" | "send" = "send",
): EmailServiceError {
  if (error instanceof EmailServiceError) return error;

  const rawMessage =
    error instanceof Error ? error.message : "Unexpected email transport error.";
  const lowered = rawMessage.toLowerCase();

  // Never surface credential material if a library embeds it.
  if (
    lowered.includes("brevo_smtp_key") ||
    lowered.includes("auth.pass") ||
    lowered.includes("password")
  ) {
    if (
      lowered.includes("invalid login") ||
      lowered.includes("auth") ||
      lowered.includes("credentials") ||
      lowered.includes("535") ||
      lowered.includes("534")
    ) {
      return new EmailServiceError(
        "authentication",
        "Brevo SMTP authentication failed. Check server-side SMTP credentials.",
      );
    }
    return new EmailServiceError(
      fallback,
      "Brevo SMTP request failed. Check server-side email configuration.",
    );
  }

  if (
    lowered.includes("invalid login") ||
    lowered.includes("authentication failed") ||
    lowered.includes("535") ||
    lowered.includes("534") ||
    (lowered.includes("auth") && lowered.includes("fail"))
  ) {
    return new EmailServiceError(
      "authentication",
      "Brevo SMTP authentication failed. Check server-side SMTP credentials.",
    );
  }

  if (
    lowered.includes("econnrefused") ||
    lowered.includes("enotfound") ||
    lowered.includes("etimedout") ||
    lowered.includes("econnreset") ||
    lowered.includes("certificate") ||
    lowered.includes("tls") ||
    lowered.includes("socket") ||
    lowered.includes("connect")
  ) {
    return new EmailServiceError(
      "connection",
      "Could not connect securely to Brevo SMTP. Check host, port, and TLS settings.",
    );
  }

  return new EmailServiceError(
    fallback,
    "Brevo SMTP could not accept the message. Try again or check server logs.",
  );
}
