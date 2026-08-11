/**
 * Diagnostic script: verify Brevo SMTP and send one branded test email.
 * Never prints or logs BREVO_SMTP_KEY / SMTP credentials.
 *
 * Usage:
 *   npm run email:test -- you@example.com
 */

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnvConfig(projectRoot, true);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENSITIVE_ENV_NAMES = new Set([
  "BREVO_SMTP_KEY",
  "BREVO_SMTP_USER",
  "BREVO_SMTP_HOST",
  "BREVO_SMTP_PORT",
  "BREVO_FROM_EMAIL",
  "BREVO_FROM_NAME",
  "BREVO_REPLY_TO_EMAIL",
]);

function fail(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    fail(`Missing required Brevo SMTP environment variable: ${name}.`);
  }
  return value.trim();
}

function parseSmtpPort(raw) {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("BREVO_SMTP_PORT must be a valid TCP port number.");
  }
  return port;
}

function sanitizeErrorMessage(error) {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "Unexpected SMTP failure.";

  let message = raw;
  for (const name of SENSITIVE_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.length > 0) {
      message = message.split(value).join(`[${name}]`);
    }
  }

  const lowered = message.toLowerCase();
  if (
    lowered.includes("invalid login") ||
    lowered.includes("authentication failed") ||
    lowered.includes("535") ||
    lowered.includes("534")
  ) {
    return "Brevo SMTP authentication failed. Check server-side SMTP credentials.";
  }
  if (
    lowered.includes("econnrefused") ||
    lowered.includes("enotfound") ||
    lowered.includes("etimedout") ||
    lowered.includes("econnreset") ||
    lowered.includes("certificate") ||
    lowered.includes("tls") ||
    lowered.includes("socket")
  ) {
    return "Could not connect securely to Brevo SMTP. Check host, port, and TLS settings.";
  }
  if (lowered.includes("pass") || lowered.includes("secret") || lowered.includes("key=")) {
    return "Brevo SMTP request failed. Check server-side email configuration.";
  }
  return message;
}

function buildTestHtml(recipient) {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f4fb;font-family:Arial,Helvetica,sans-serif;color:#1f1630;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f4fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e7e0f2;border-radius:12px;padding:28px;">
            <tr>
              <td>
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b4eff;font-weight:700;">
                  Cloutflow Creator Support
                </p>
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">
                  Email setup successful
                </h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
                  This is a Brevo SMTP integration test for Cloutflow Creator Support.
                </p>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
                  No support ticket was created. This message only confirms that the
                  application can authenticate with Brevo and submit a transactional email.
                </p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6575;">
                  Test recipient: ${recipient.replace(/</g, "&lt;")}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTestText(recipient) {
  return [
    "Cloutflow Creator Support — Email setup successful",
    "",
    "This is a Brevo SMTP integration test for Cloutflow Creator Support.",
    "No support ticket was created.",
    "This message only confirms that the application can authenticate with Brevo",
    "and submit a transactional email.",
    "",
    `Test recipient: ${recipient}`,
  ].join("\n");
}

async function main() {
  const recipient = process.argv[2]?.trim();
  if (!recipient) {
    fail(
      "Missing test recipient. Usage: npm run email:test -- you@example.com",
    );
  }
  if (!EMAIL_PATTERN.test(recipient)) {
    fail("Test recipient must be a valid email address.");
  }

  const host = readRequiredEnv("BREVO_SMTP_HOST");
  const port = parseSmtpPort(readRequiredEnv("BREVO_SMTP_PORT"));
  const user = readRequiredEnv("BREVO_SMTP_USER");
  const pass = readRequiredEnv("BREVO_SMTP_KEY");
  const fromEmail = readRequiredEnv("BREVO_FROM_EMAIL");
  const fromName = readRequiredEnv("BREVO_FROM_NAME");
  const replyToEmail = readRequiredEnv("BREVO_REPLY_TO_EMAIL");

  const secure = port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user,
      pass,
    },
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  try {
    await transporter.verify();
    console.log("SMTP connection verified with Brevo.");
  } catch (error) {
    fail(sanitizeErrorMessage(error));
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${fromEmail}>`,
      to: recipient,
      replyTo: replyToEmail,
      subject: "Cloutflow Creator Support — Email setup successful",
      html: buildTestHtml(recipient),
      text: buildTestText(recipient),
      headers: {
        "X-Cloutflow-Email-Test": "brevo-phase-1",
      },
    });

    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);

    if (accepted.length === 0) {
      fail("Brevo SMTP did not accept the message for any recipient.");
    }

    console.log("Message accepted by Brevo (SMTP acceptance, not delivery proof).");
    console.log(`messageId: ${info.messageId ? String(info.messageId) : "(none)"}`);
    console.log(`accepted: ${accepted.join(", ") || "(none)"}`);
    console.log(`rejected: ${rejected.join(", ") || "(none)"}`);
  } catch (error) {
    fail(sanitizeErrorMessage(error));
  }
}

main().catch((error) => {
  fail(sanitizeErrorMessage(error));
});
