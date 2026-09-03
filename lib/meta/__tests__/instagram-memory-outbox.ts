import { isInstagramTerminalSendError } from "@/lib/meta/instagram-send";
import {
  isInstagramEmailDrainPurpose,
  isInstagramEmailTerminalError,
} from "@/lib/meta/email-drain-purposes";

export function instagramMemoryOutbox(messages: Array<Record<string, unknown>>) {
  return {
    async listDueInstagramOutbounds(conversationId: string, nowIso: string) {
      return dueRows(messages, nowIso).filter(
        (row) => row.conversationId === conversationId,
      );
    },
    async listDueInstagramOutboxBatch(input: { nowIso: string; limit: number }) {
      return dueRows(messages, input.nowIso).slice(0, Math.max(1, input.limit));
    },
    async claimInstagramOutboundSend(input: {
      id: string;
      now: string;
      maxAttempts: number;
    }) {
      const row = messages.find((message) => message.id === input.id);
      if (!row) return { outcome: "failed" as const, errorCode: "outbound_lookup_failed" };
      const attempts = Number(row.deliveryAttemptCount ?? 0) || 0;
      const nextAt = row.nextAttemptAt ? Date.parse(String(row.nextAttemptAt)) : 0;
      const now = Date.parse(input.now);
      if (
        row.outboundClaimed === true ||
        row.direction !== "outbound" ||
        row.purpose === "staff_reply" ||
        (row.deliveryStatus !== "pending" && row.deliveryStatus !== "failed") ||
        attempts >= input.maxAttempts ||
        isInstagramTerminalSendError(String(row.deliveryErrorCode ?? "")) ||
        (row.nextAttemptAt && !Number.isNaN(nextAt) && nextAt > now)
      ) {
        return { outcome: "skipped" as const };
      }
      row.outboundClaimed = true;
      row.deliveryAttemptCount = attempts + 1;
      row.lastAttemptAt = input.now;
      row.nextAttemptAt = new Date(now + 60_000).toISOString();
      return { outcome: "claimed" as const, attemptCount: attempts + 1 };
    },
    async findPendingTimeoutOutbound(input: {
      conversationId: string;
      messageBody: string;
    }) {
      const pending = messages.filter(
        (message) =>
          message.conversationId === input.conversationId &&
          message.direction === "outbound" &&
          message.deliveryStatus === "pending" &&
          message.deliveryErrorCode === "timeout_unknown" &&
          !message.externalMessageId,
      );
      const body = input.messageBody.trim();
      const matched =
        pending.find((message) => String(message.messageBody ?? "").trim() === body) ??
        pending[0];
      if (!matched) return null;
      return {
        id: String(matched.id),
        externalMessageId: (matched.externalMessageId as string | null) ?? null,
        deliveryStatus: String(matched.deliveryStatus ?? "pending"),
        idempotencyKey: (matched.idempotencyKey as string | null) ?? null,
        recipientExternalId: (matched.recipientExternalId as string | null) ?? null,
        conversationId: (matched.conversationId as string | null) ?? null,
      };
    },
  };
}

function dueRows(messages: Array<Record<string, unknown>>, nowIso: string) {
  const now = Date.parse(nowIso);
  return messages
    .filter((message) => {
      if (message.direction !== "outbound") return false;
      if (message.channel && message.channel !== "instagram") return false;
      if (message.purpose === "staff_reply") return false;
      if (message.deliveryStatus !== "pending" && message.deliveryStatus !== "failed") {
        return false;
      }
      const attempts = Number(message.deliveryAttemptCount ?? 0) || 0;
      if (attempts >= 5) return false;
      if (isInstagramTerminalSendError(String(message.deliveryErrorCode ?? ""))) {
        return false;
      }
      const nextAt = message.nextAttemptAt
        ? Date.parse(String(message.nextAttemptAt))
        : 0;
      return !message.nextAttemptAt || (!Number.isNaN(nextAt) && nextAt <= now);
    })
    .map((message) => ({
      id: String(message.id),
      conversationId: String(message.conversationId ?? ""),
      recipientExternalId: String(message.recipientExternalId ?? ""),
      messageBody: String(message.messageBody ?? ""),
      purpose: (message.purpose as string | null) ?? null,
      deliveryStatus: String(message.deliveryStatus ?? "pending"),
      deliveryErrorCode: (message.deliveryErrorCode as string | null) ?? null,
      deliveryAttemptCount: Number(message.deliveryAttemptCount ?? 0) || 0,
      nextAttemptAt: (message.nextAttemptAt as string | null) ?? null,
      rawPayload: message.rawPayload ?? message.raw_payload ?? null,
    }));
}

export function instagramMemoryEmailOutbox(emails: Array<Record<string, unknown>>) {
  return {
    async listDueInstagramEmailDeliveries(input: { nowIso: string; limit: number }) {
      void input.nowIso;
      return emails
        .filter((row) => {
          const purpose = String(row.purpose ?? "");
          if (!isInstagramEmailDrainPurpose(purpose)) return false;
          const status = String(row.deliveryStatus ?? "pending");
          if (!["pending", "failed", "skipped"].includes(status)) return false;
          if (isInstagramEmailTerminalError(String(row.errorCode ?? ""))) return false;
          return true;
        })
        .slice(0, Math.max(1, input.limit))
        .map((row) => ({
          id: String(row.id),
          ticketId: (row.ticketId as string | null) ?? null,
          conversationId: (row.conversationId as string | null) ?? null,
          purpose: String(row.purpose ?? ""),
          deliveryStatus: String(row.deliveryStatus ?? "pending"),
          errorCode: (row.errorCode as string | null) ?? null,
          updatedAt: (row.updatedAt as string | null) ?? null,
        }));
    },
    async claimInstagramEmailRetry(input: {
      id: string;
      observedUpdatedAt: string | null;
      nowIso: string;
    }) {
      const row = emails.find((email) => email.id === input.id);
      if (!row) return { outcome: "failed" as const, errorCode: "email_outbox_lookup_failed" };
      if (row.emailClaimed === true) return { outcome: "skipped" as const };
      if (isInstagramEmailTerminalError(row.errorCode as string | null)) {
        return { outcome: "skipped" as const };
      }
      const status = String(row.deliveryStatus ?? "pending");
      if (!["pending", "failed", "skipped"].includes(status)) {
        return { outcome: "skipped" as const };
      }
      if (status === "pending") {
        const currentUpdated = (row.updatedAt as string | null) ?? null;
        if ((input.observedUpdatedAt ?? null) !== currentUpdated) {
          return { outcome: "skipped" as const };
        }
      } else if (status !== "failed" && status !== "skipped") {
        return { outcome: "skipped" as const };
      }
      row.emailClaimed = true;
      row.deliveryStatus = "pending";
      row.errorCode = null;
      row.updatedAt = input.nowIso;
      return { outcome: "claimed" as const, id: String(row.id) };
    },
    async getConversationEmailContext(conversationId: string) {
      void conversationId;
      return null;
    },
  };
}
