import "server-only";

import { EmailServiceError } from "@/lib/email/types";

export interface BrevoSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  /** SMTP secret — never log, return to clients, or expose in errors. */
  pass: string;
  fromEmail: string;
  fromName: string;
  replyToEmail: string;
}

let cachedConfig: BrevoSmtpConfig | null = null;

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new EmailServiceError(
      "configuration",
      `Missing required Brevo SMTP environment variable: ${name}.`,
    );
  }
  return value.trim();
}

function parseSmtpPort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailServiceError(
      "configuration",
      "BREVO_SMTP_PORT must be a valid TCP port number.",
    );
  }
  return port;
}

/**
 * Lazily validate and cache Brevo SMTP settings from process.env.
 * Call only from server-side email modules.
 */
export function getBrevoSmtpConfig(): BrevoSmtpConfig {
  if (cachedConfig) return cachedConfig;

  const host = readRequiredEnv("BREVO_SMTP_HOST");
  const port = parseSmtpPort(readRequiredEnv("BREVO_SMTP_PORT"));
  const user = readRequiredEnv("BREVO_SMTP_USER");
  const pass = readRequiredEnv("BREVO_SMTP_KEY");
  const fromEmail = readRequiredEnv("BREVO_FROM_EMAIL");
  const fromName = readRequiredEnv("BREVO_FROM_NAME");
  const replyToEmail = readRequiredEnv("BREVO_REPLY_TO_EMAIL");

  const secure = port === 465;

  cachedConfig = {
    host,
    port,
    secure,
    requireTls: !secure,
    user,
    pass,
    fromEmail,
    fromName,
    replyToEmail,
  };

  return cachedConfig;
}

/** Test helper — clears cached config between diagnostic runs. */
export function resetBrevoSmtpConfigCache(): void {
  cachedConfig = null;
}
