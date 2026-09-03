import "server-only";

import {
  sendInstagramAgencyDetailsEmail,
  sendInstagramGeneralInquiryEmail,
  sendInstagramInboundHelpNotification,
  sendInstagramTicketConfirmationEmail,
  type InstagramMailResult,
} from "@/lib/email/instagram-ticket-mail";
import { collectedFromRecord } from "@/lib/meta/intake-collected";
import type { InstagramOutboxDrainCounts, DrainClock } from "@/lib/meta/instagram-outbox";
import { emptyInstagramOutboxDrainCounts } from "@/lib/meta/instagram-outbox";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import type { DbTicket } from "@/lib/tickets/types";
import {
  INSTAGRAM_EMAIL_DRAIN_PURPOSES,
  isInstagramEmailDrainPurpose,
  isInstagramEmailTerminalError,
  type InstagramEmailDrainPurpose,
} from "@/lib/meta/email-drain-purposes";

export const INSTAGRAM_EMAIL_DRAIN_BATCH = 2;
export const INSTAGRAM_EMAIL_PENDING_STALE_MS = 60_000;
export const INSTAGRAM_EMAIL_FAILED_BACKOFF_MS = 15_000;

export {
  INSTAGRAM_EMAIL_DRAIN_PURPOSES,
  isInstagramEmailDrainPurpose,
  isInstagramEmailTerminalError,
  type InstagramEmailDrainPurpose,
};

function formatTranscript(
  rows: Array<{ direction: string; messageBody: string }>,
): string {
  return rows
    .map((row) => {
      const who = row.direction === "inbound" ? "Creator" : "Cloutflow";
      return `${who}: ${row.messageBody}`;
    })
    .join("\n\n");
}

function lastInboundPreview(
  rows: Array<{ direction: string; messageBody: string }>,
): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.direction === "inbound" && row.messageBody.trim()) {
      return row.messageBody.trim();
    }
  }
  return "A creator sent a new Instagram reply.";
}

async function defaultLoadTicket(ticketId: string): Promise<DbTicket | null> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { ticketSelect } = await import("@/lib/tickets/select");
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("tickets")
      .select(ticketSelect())
      .eq("id", ticketId)
      .maybeSingle();
    return data ? (data as DbTicket) : null;
  } catch {
    return null;
  }
}

function mailKind(
  mailed: InstagramMailResult,
): "sent" | "retryable" | "terminal" {
  if (mailed.outcome === "sent") return "sent";
  if (isInstagramEmailTerminalError(mailed.errorCode)) return "terminal";
  return "retryable";
}

async function sendReconstructedInstagramEmail(input: {
  store: InstagramIngestStore;
  purpose: InstagramEmailDrainPurpose;
  ticketId: string | null;
  conversationId: string | null;
  loadTicket: (id: string) => Promise<DbTicket | null>;
}): Promise<InstagramMailResult> {
    if (
      input.purpose === "instagram-ticket-confirmation" ||
      input.purpose === "whatsapp-ticket-confirmation" ||
      input.purpose === "instagram-inbound-notify"
    ) {
    if (!input.ticketId) {
      return { outcome: "failed", errorCode: "email_send_failed" };
    }
    const ticket = await input.loadTicket(input.ticketId);
    if (!ticket) {
      return { outcome: "failed", errorCode: "email_send_failed" };
    }
    const transcriptRows = input.conversationId
      ? await input.store.listSupportTranscript({
          conversationId: input.conversationId,
          ticketId: input.ticketId,
        })
      : [];
    if (
      input.purpose === "instagram-ticket-confirmation" ||
      input.purpose === "whatsapp-ticket-confirmation"
    ) {
      return sendInstagramTicketConfirmationEmail({
        ticket,
        transcriptText: formatTranscript(transcriptRows),
      });
    }
    return sendInstagramInboundHelpNotification({
      ticket,
      messagePreview: lastInboundPreview(transcriptRows),
      channelLabel: "Instagram",
    });
  }

  if (!input.conversationId) {
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
  const conversation = await input.store.getConversationEmailContext(
    input.conversationId,
  );
  if (!conversation || "errorCode" in conversation) {
    return { outcome: "failed", errorCode: "email_send_failed" };
  }
  const collected = collectedFromRecord(conversation.collectedData);
  const conversationRef = conversation.externalConversationId ?? "";
  if (input.purpose === "instagram-agency-details") {
    return sendInstagramAgencyDetailsEmail({
      agencyName: collected.agencyName,
      contactName: collected.creatorName,
      contactEmail: collected.email,
      rosterUrl: collected.rosterUrl,
      instagramConversationRef: conversationRef,
    });
  }
  return sendInstagramGeneralInquiryEmail({
    contactName: collected.creatorName,
    contactEmail: collected.email,
    contactPhone: collected.phoneDisplay ?? collected.phoneNormalized,
    inquiryDetails: collected.inquiryDetails,
    instagramConversationRef: conversationRef,
  });
}

/**
 * Retry failed/skipped/stale Instagram internal emails after Instagram Graph
 * drain so email never delays creator DMs.
 */
export async function drainDueInstagramEmails(input: {
  store: InstagramIngestStore;
  now?: Date;
  limit?: number;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
  deadlineAtMs?: number;
  clock?: DrainClock;
}): Promise<InstagramOutboxDrainCounts> {
  const now = input.now ?? new Date();
  const counts = emptyInstagramOutboxDrainCounts();
  const due = await input.store.listDueInstagramEmailDeliveries({
    nowIso: now.toISOString(),
    limit: input.limit ?? INSTAGRAM_EMAIL_DRAIN_BATCH,
  });
  if ("errorCode" in due) return counts;

  const loadTicket = input.loadTicket ?? defaultLoadTicket;
  const nowMs = now.getTime();
  const clock = input.clock ?? { nowMs: () => Date.now() };

  for (const row of due) {
    if (
      input.deadlineAtMs != null &&
      clock.nowMs() >= input.deadlineAtMs
    ) {
      break;
    }
    if (!isInstagramEmailDrainPurpose(row.purpose)) continue;
    if (isInstagramEmailTerminalError(row.errorCode)) continue;
    const updatedMs = row.updatedAt ? Date.parse(row.updatedAt) : 0;
    if (row.deliveryStatus === "pending") {
      if (
        row.updatedAt &&
        !Number.isNaN(updatedMs) &&
        nowMs - updatedMs < INSTAGRAM_EMAIL_PENDING_STALE_MS
      ) {
        continue;
      }
    } else if (
      row.updatedAt &&
      !Number.isNaN(updatedMs) &&
      nowMs - updatedMs < INSTAGRAM_EMAIL_FAILED_BACKOFF_MS
    ) {
      continue;
    }

    const claimed = await input.store.claimInstagramEmailRetry({
      id: row.id,
      observedUpdatedAt: row.updatedAt,
      nowIso: now.toISOString(),
    });
    if (claimed.outcome !== "claimed") continue;
    counts.claimed += 1;

    let mailed: InstagramMailResult;
    try {
      mailed = await sendReconstructedInstagramEmail({
        store: input.store,
        purpose: row.purpose,
        ticketId: row.ticketId,
        conversationId: row.conversationId,
        loadTicket,
      });
    } catch {
      mailed = { outcome: "failed", errorCode: "email_send_failed" };
    }

    const kind = mailKind(mailed);
    await input.store.markEmailDelivery(row.id, {
      deliveryStatus:
        mailed.outcome === "sent"
          ? "sent"
          : mailed.outcome === "skipped"
            ? "skipped"
            : "failed",
      brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
      errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
    });
    counts[kind] += 1;
  }

  return counts;
}
