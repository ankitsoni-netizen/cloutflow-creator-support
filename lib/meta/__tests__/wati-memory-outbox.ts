import { isWatiTerminalSendError } from "@/lib/wati/outbox-errors";

export function watiMemoryOutbox(messages: Array<Record<string, unknown>>) {
  return {
    async listDueWatiOutbounds(conversationId: string, nowIso: string) {
      return dueWatiRows(messages, nowIso).filter(
        (row) => row.conversationId === conversationId,
      );
    },
    async listDueWatiOutboxBatch(input: { nowIso: string; limit: number }) {
      return dueWatiRows(messages, input.nowIso).slice(0, Math.max(1, input.limit));
    },
    async claimWatiOutboundSend(input: {
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
        row.channel !== "whatsapp" ||
        row.purpose === "staff_reply" ||
        (row.deliveryStatus !== "pending" && row.deliveryStatus !== "failed") ||
        attempts >= input.maxAttempts ||
        isWatiTerminalSendError(String(row.deliveryErrorCode ?? "")) ||
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
  };
}

function dueWatiRows(messages: Array<Record<string, unknown>>, nowIso: string) {
  const now = Date.parse(nowIso);
  return messages
    .filter((message) => {
      if (message.direction !== "outbound") return false;
      if (message.channel !== "whatsapp") return false;
      if (message.purpose === "staff_reply") return false;
      if (message.deliveryStatus !== "pending" && message.deliveryStatus !== "failed") {
        return false;
      }
      const attempts = Number(message.deliveryAttemptCount ?? 0) || 0;
      if (attempts >= 5) return false;
      if (isWatiTerminalSendError(String(message.deliveryErrorCode ?? ""))) {
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
