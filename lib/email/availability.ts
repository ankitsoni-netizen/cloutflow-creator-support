import "server-only";

import {
  getBrevoConfigStatus,
  isBrevoConfigured,
  type BrevoConfigStatus,
} from "@/lib/email/env-check";

export type { BrevoConfigStatus };

/** Safe client-facing channel status — never includes credentials. */
export interface EmailChannelStatus {
  configured: boolean;
  status: BrevoConfigStatus;
  label: "Email connected" | "Email not configured";
  fromDisplay: string | null;
}

/**
 * Returns whether required Brevo env vars are present.
 * Does not open SMTP connections or run during module import.
 */
export function getEmailChannelStatus(): EmailChannelStatus {
  const status = getBrevoConfigStatus();
  const configured = status === "configured";
  const fromName = process.env.BREVO_FROM_NAME?.trim() || null;
  const fromEmail = process.env.BREVO_FROM_EMAIL?.trim() || null;

  return {
    configured,
    status,
    label: configured ? "Email connected" : "Email not configured",
    fromDisplay:
      configured && fromName && fromEmail
        ? `${fromName} <${fromEmail}>`
        : configured
          ? "Cloutflow Creator Support"
          : null,
  };
}

export function assertBrevoReadyForSend(): void {
  if (!isBrevoConfigured()) {
    throw new Error(
      "Email is not configured. Add Brevo SMTP environment variables on the server.",
    );
  }
}
