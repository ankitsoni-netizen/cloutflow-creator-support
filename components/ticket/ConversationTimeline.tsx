"use client";

import { formatDateTime } from "@/lib/utils";
import type { TimelineItem } from "@/lib/tickets/workflow-types";

function deliveryLabel(
  status: TimelineItem["deliveryStatus"],
  kind: TimelineItem["kind"],
): string | null {
  if (!status) return null;
  switch (status) {
    case "pending":
      return "Pending";
    case "sent":
      return "Sent";
    case "delivered":
      return kind === "whatsapp_outbound" ? "Delivered" : "Sent";
    case "read":
      return "Read";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function itemStyles(kind: TimelineItem["kind"]): {
  bubble: string;
  dot: string;
  label: string;
} {
  switch (kind) {
    case "internal_note":
      return {
        bubble:
          "border-[var(--internal-border)] bg-[var(--internal-soft)]",
        dot: "bg-[var(--brand-violet)]",
        label: "Internal note",
      };
    case "creator_reply":
    case "instagram_outbound":
    case "whatsapp_outbound":
      return {
        bubble: "border-border bg-surface",
        dot: "bg-[var(--brand-blue)]",
        label:
          kind === "whatsapp_outbound"
            ? "WhatsApp reply"
            : kind === "instagram_outbound"
              ? "Instagram reply"
              : "Creator reply",
      };
    case "instagram_inbound":
    case "whatsapp_inbound":
      return {
        bubble: "border-border bg-surface-muted",
        dot: "bg-accent",
        label: kind === "whatsapp_inbound" ? "WhatsApp inbound" : "Instagram inbound",
      };
    case "acknowledgement_email":
      return {
        bubble: "border-border bg-surface",
        dot: "bg-accent",
        label: "Acknowledgement",
      };
    case "resolution":
      return {
        bubble:
          "border-[color-mix(in_srgb,var(--status-resolved)_30%,transparent)] bg-[var(--status-resolved-soft)]",
        dot: "bg-[var(--status-resolved)]",
        label: "Resolution",
      };
    case "status_changed":
    case "assignment_changed":
    case "ticket_created":
      return {
        bubble: "border-transparent bg-transparent px-0 py-0 shadow-none",
        dot: "bg-border-strong",
        label: "System",
      };
    default:
      return {
        bubble: "border-border bg-surface-muted",
        dot: "bg-muted",
        label: "Event",
      };
  }
}

interface ConversationTimelineProps {
  items: TimelineItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRetryEmail?: (commentId: string) => void;
  retryingCommentId?: string | null;
  issueDescription?: string;
  createdAt?: string;
  creatorName?: string;
}

export default function ConversationTimeline({
  items,
  loading,
  error,
  onRetry,
  onRetryEmail,
  retryingCommentId = null,
  issueDescription,
  createdAt,
  creatorName,
}: ConversationTimelineProps) {
  const isSystem = (kind: TimelineItem["kind"]) =>
    kind === "status_changed" ||
    kind === "assignment_changed" ||
    kind === "ticket_created" ||
    kind === "other_event";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {issueDescription ? (
          <article className="mb-5 rounded-lg border border-border bg-surface-muted p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Original inquiry
              </p>
              {createdAt ? (
                <p className="text-[11px] text-muted tabular-nums">
                  {formatDateTime(createdAt)}
                </p>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted">
              From {creatorName || "creator"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {issueDescription}
            </p>
          </article>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted">Loading conversation...</p>
        ) : error ? (
          <div>
            <p className="text-sm text-[var(--danger)]">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">
            No conversation activity yet. Add an internal note or send a creator
            email to begin the thread.
          </p>
        ) : (
          <ol className="space-y-4">
            {items.map((item, index) => {
              const styles = itemStyles(item.kind);
              const delivery = deliveryLabel(item.deliveryStatus, item.kind);
              const system = isSystem(item.kind);

              if (system) {
                return (
                  <li key={item.id} className="flex justify-center">
                    <div className="max-w-xl rounded-full border border-border bg-surface-muted px-3 py-1 text-center text-[11px] text-muted">
                      <span className="font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="tabular-nums">
                        {" "}
                        · {item.actor} · {formatDateTime(item.timestamp)}
                      </span>
                    </div>
                  </li>
                );
              }

              return (
                <li key={item.id} className="relative flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-2 h-2.5 w-2.5 rounded-full ${styles.dot}`}
                    />
                    {index < items.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-border" />
                    ) : null}
                  </div>
                  <div
                    className={`min-w-0 flex-1 rounded-lg border px-3.5 py-3 shadow-[var(--shadow-xs)] ${styles.bubble}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {item.title}
                      </p>
                      {item.visibilityLabel ? (
                        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
                          {item.visibilityLabel}
                        </span>
                      ) : (
                        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-border">
                          {styles.label}
                        </span>
                      )}
                      {delivery ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                            item.deliveryStatus === "failed"
                              ? "bg-red-50 text-red-700 ring-red-200"
                              : item.deliveryStatus === "pending"
                                ? "bg-[var(--warning-soft)] text-[var(--warning)] ring-[color-mix(in_srgb,var(--warning)_25%,transparent)]"
                                : "bg-accent-soft text-accent ring-accent/20"
                          }`}
                        >
                          {delivery}
                        </span>
                      ) : null}
                    </div>
                    {item.detail ? (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        {item.detail}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-[11px] text-muted tabular-nums">
                        {item.actor} · {formatDateTime(item.timestamp)}
                      </p>
                      {item.canRetryEmail && item.commentId && onRetryEmail ? (
                        <button
                          type="button"
                          disabled={retryingCommentId === item.commentId}
                          onClick={() => onRetryEmail(item.commentId!)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {retryingCommentId === item.commentId
                            ? "Retrying..."
                            : item.canRetryInstagram || item.canRetryWhatsApp
                              ? "Retry"
                              : "Retry Email"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
