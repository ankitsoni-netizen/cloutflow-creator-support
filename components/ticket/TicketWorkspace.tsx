"use client";

import { useEffect, useState } from "react";
import AssignmentControl from "@/components/ticket/AssignmentControl";
import CloutflowCopilot from "@/components/ticket/CloutflowCopilot";
import ConversationTimeline from "@/components/ticket/ConversationTimeline";
import ReplyComposer from "@/components/ticket/ReplyComposer";
import ResolveTicketModal from "@/components/ticket/ResolveTicketModal";
import StatusControl from "@/components/ticket/StatusControl";
import TicketProperties from "@/components/ticket/TicketProperties";
import ChannelBadge from "@/components/ui/ChannelBadge";
import EmptyState from "@/components/ui/EmptyState";
import ResizeHandle, { clampSize } from "@/components/ui/ResizeHandle";
import { CloseIcon, PanelIcon, SparklesIcon } from "@/components/ui/Icons";
import {
  retryAcknowledgementEmailAction,
  retryCreatorEmailAction,
} from "@/lib/tickets/email-actions";
import { fetchInstagramTicketTimelineAction } from "@/lib/tickets/instagram-thread";
import {
  applyResolutionEmailLabels,
  buildTimeline,
} from "@/lib/tickets/timeline";
import type { StaffOption, TimelineItem } from "@/lib/tickets/workflow-types";
import {
  addInternalNoteAction,
  queueCreatorReplyAction,
  reassignTicketAction,
  resolveTicketAction,
  updateTicketStatusAction,
} from "@/lib/tickets/workflow-actions";
import { fetchTicketTimeline } from "@/lib/tickets/workflow-api";
import type { Ticket, TicketStatus } from "@/lib/types";
import {
  formatDateTime,
  getInitials,
  priorityClass,
  statusClass,
} from "@/lib/utils";

interface TicketWorkspaceProps {
  ticket: Ticket | null;
  staffOptions: StaffOption[];
  onTicketUpdated: (ticket: Ticket) => void;
  onTicketResolved: (ticket: Ticket) => void;
  onClose?: () => void;
  showClose?: boolean;
  pendingReplyIds?: Set<string>;
  onConversationMutated?: () => void;
}

type SidePanel = "properties" | "copilot" | null;

export default function TicketWorkspace({
  ticket,
  staffOptions,
  onTicketUpdated,
  onTicketResolved,
  onClose,
  showClose = false,
  pendingReplyIds,
  onConversationMutated,
}: TicketWorkspaceProps) {
  if (!ticket) {
    return (
      <section className="flex h-full items-center justify-center bg-surface-muted px-6">
        <EmptyState
          title="Select a ticket"
          description="Choose a ticket from the queue to open the conversation workspace, properties, and Cloutflow Copilot."
        />
      </section>
    );
  }

  return (
    <TicketWorkspaceActive
      key={ticket.id}
      ticket={ticket}
      staffOptions={staffOptions}
      onTicketUpdated={onTicketUpdated}
      onTicketResolved={onTicketResolved}
      onClose={onClose}
      showClose={showClose}
      hasPendingCreatorReply={pendingReplyIds?.has(ticket.id) ?? false}
      onConversationMutated={onConversationMutated}
    />
  );
}

function TicketWorkspaceActive({
  ticket,
  staffOptions,
  onTicketUpdated,
  onTicketResolved,
  onClose,
  showClose,
  hasPendingCreatorReply,
  onConversationMutated,
}: {
  ticket: Ticket;
  staffOptions: StaffOption[];
  onTicketUpdated: (ticket: Ticket) => void;
  onTicketResolved: (ticket: Ticket) => void;
  onClose?: () => void;
  showClose: boolean;
  hasPendingCreatorReply: boolean;
  onConversationMutated?: () => void;
}) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveSaving, setResolveSaving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveNotice, setResolveNotice] = useState<string | null>(null);

  const [ackRetrying, setAckRetrying] = useState(false);
  const [ackMessage, setAckMessage] = useState<string | null>(null);
  const [retryingCommentId, setRetryingCommentId] = useState<string | null>(
    null,
  );

  const [copilotCollapsed, setCopilotCollapsed] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<SidePanel>(null);
  const [propertiesWidth, setPropertiesWidth] = useState(300);
  const [copilotWidth, setCopilotWidth] = useState(280);
  const [composerHeight, setComposerHeight] = useState(220);

  function enrichTimeline(
    comments: Parameters<typeof buildTimeline>[1],
    events: Parameters<typeof buildTimeline>[0],
  ) {
    const base = buildTimeline(events, comments, {
      acknowledgementEmailSentAt: ticket.acknowledgementEmailSentAt,
    });
    return applyResolutionEmailLabels(base, ticket.resolutionSummary);
  }

  async function loadTimeline() {
    setTimelineLoading(true);
    setTimelineError(null);
    const result = await fetchTicketTimeline(ticket.id);
    if ("error" in result) {
      setTimeline([]);
      setTimelineError(result.error);
      setTimelineLoading(false);
      return;
    }
    let items = enrichTimeline(result.comments, result.events);
    if (ticket.sourceChannel === "Instagram") {
      items = items.map((item) =>
        item.canRetryEmail ? { ...item, canRetryInstagram: true } : item,
      );
      const ig = await fetchInstagramTicketTimelineAction({
        ticketId: ticket.id,
        externalConversationId: ticket.externalConversationId ?? null,
      });
      if (!("error" in ig) && ig.items.length > 0) {
        items = [...items, ...ig.items].sort((a, b) => {
          const diff =
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          if (diff !== 0) return diff;
          return a.id.localeCompare(b.id);
        });
      }
    }
    setTimeline(items);
    setTimelineLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchTicketTimeline(ticket.id).then(async (result) => {
      if (cancelled) return;
      if ("error" in result) {
        setTimeline([]);
        setTimelineError(result.error);
      } else {
        let items = applyResolutionEmailLabels(
          buildTimeline(result.events, result.comments, {
            acknowledgementEmailSentAt: ticket.acknowledgementEmailSentAt,
          }),
          ticket.resolutionSummary,
        );
        if (ticket.sourceChannel === "Instagram") {
          items = items.map((item) =>
            item.canRetryEmail ? { ...item, canRetryInstagram: true } : item,
          );
          const ig = await fetchInstagramTicketTimelineAction({
            ticketId: ticket.id,
            externalConversationId: ticket.externalConversationId ?? null,
          });
          if (cancelled) return;
          if (!("error" in ig) && ig.items.length > 0) {
            items = [...items, ...ig.items].sort((a, b) => {
              const diff =
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
              if (diff !== 0) return diff;
              return a.id.localeCompare(b.id);
            });
          }
        }
        setTimeline(items);
      }
      setTimelineLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    ticket.id,
    ticket.acknowledgementEmailSentAt,
    ticket.resolutionSummary,
    ticket.sourceChannel,
    ticket.externalConversationId,
  ]);

  async function handleStatusChange(
    nextStatus: Exclude<TicketStatus, "Resolved">,
  ) {
    if (statusSaving || ticket.status === nextStatus) return;
    setStatusSaving(true);
    setStatusError(null);
    const result = await updateTicketStatusAction({
      ticketId: ticket.id,
      status: nextStatus,
    });
    setStatusSaving(false);
    if ("error" in result) {
      setStatusError(result.error);
      return;
    }
    onTicketUpdated(result.data);
    void loadTimeline();
  }

  async function handleAssignmentChange(assigneeUserId: string) {
    if (assignSaving) return;
    const nextId = assigneeUserId.trim();
    if (nextId === (ticket.assignedExecutiveId ?? "")) return;
    setAssignSaving(true);
    setAssignError(null);
    const result = await reassignTicketAction({
      ticketId: ticket.id,
      assigneeUserId: nextId || null,
    });
    setAssignSaving(false);
    if ("error" in result) {
      setAssignError(result.error);
      return;
    }
    onTicketUpdated(result.data);
    void loadTimeline();
  }

  async function handleQueueReply(text: string) {
    const result = await queueCreatorReplyAction({
      ticketId: ticket.id,
      commentText: text,
    });
    if ("error" in result) {
      return { ok: false as const, message: result.error };
    }
    onTicketUpdated(result.ticket);
    void loadTimeline();
    onConversationMutated?.();
    if (result.delivery === "failed") {
      return {
        ok: false as const,
        message:
          result.deliveryMessage ||
          (ticket.sourceChannel === "Instagram"
            ? "The creator reply was saved, but Instagram delivery failed."
            : "The creator reply was saved, but the email could not be sent."),
      };
    }
    return { ok: true as const };
  }

  async function handleSaveNote(text: string) {
    const result = await addInternalNoteAction({
      ticketId: ticket.id,
      commentText: text,
    });
    if ("error" in result) {
      return { ok: false as const, message: result.error };
    }
    void loadTimeline();
    onConversationMutated?.();
    return { ok: true as const };
  }

  async function handleResolve(summary: string) {
    if (resolveSaving) return;
    setResolveSaving(true);
    setResolveError(null);
    setResolveNotice(null);
    const result = await resolveTicketAction({
      ticketId: ticket.id,
      resolutionSummary: summary,
    });
    setResolveSaving(false);
    if ("error" in result) {
      setResolveError(result.error);
      return;
    }
    setResolveOpen(false);
    if (result.resolutionEmail === "failed") {
      setResolveNotice(
        result.resolutionEmailMessage ||
          "Ticket resolved, but the resolution email could not be sent.",
      );
    } else {
      setResolveNotice(result.resolutionEmailMessage || null);
    }
    onTicketResolved(result.data);
    void loadTimeline();
    onConversationMutated?.();
  }

  async function handleRetryEmail(commentId: string) {
    if (retryingCommentId) return;
    setRetryingCommentId(commentId);
    const result = await retryCreatorEmailAction({
      ticketId: ticket.id,
      commentId,
    });
    setRetryingCommentId(null);
    if ("error" in result) {
      setAckMessage(result.error);
      return;
    }
    onTicketUpdated(result.ticket);
    void loadTimeline();
    onConversationMutated?.();
    setAckMessage(
      result.delivery === "sent"
        ? result.deliveryMessage || "Email accepted by Brevo."
        : result.deliveryMessage || "Email retry failed.",
    );
  }

  async function handleRetryAcknowledgement() {
    if (ackRetrying) return;
    setAckRetrying(true);
    setAckMessage(null);
    const result = await retryAcknowledgementEmailAction({
      ticketId: ticket.id,
    });
    setAckRetrying(false);
    if ("error" in result) {
      setAckMessage(result.error);
      return;
    }
    onTicketUpdated(result.ticket);
    void loadTimeline();
    setAckMessage(
      result.acknowledgementMessage ||
        (result.acknowledgement === "sent"
          ? "Acknowledgement email accepted by Brevo."
          : "Acknowledgement email could not be sent."),
    );
  }

  const canRetryAcknowledgement =
    Boolean(ticket.sendAcknowledgementEmail) &&
    Boolean(ticket.email.trim()) &&
    !ticket.acknowledgementEmailSentAt;

  const isResolved = ticket.status === "Resolved";
  const assigneeInitials = getInitials(ticket.assignedExecutive || "?");

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-accent tabular-nums">
                {ticket.ticketNumber}
              </span>
              <ChannelBadge channel={ticket.sourceChannel} />
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${priorityClass(ticket.priority)}`}
              >
                {ticket.priority}
              </span>
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(ticket.status)}`}
              >
                {ticket.status}
              </span>
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-foreground">
              {ticket.creatorName}
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted">{ticket.issueType}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
                  aria-hidden="true"
                >
                  {ticket.assignedExecutive ? assigneeInitials : "—"}
                </span>
                {ticket.assignedExecutive || "Unassigned"}
              </span>
              <span className="tabular-nums">
                Created {formatDateTime(ticket.createdAt)}
              </span>
              <span className="tabular-nums">
                Updated {formatDateTime(ticket.updatedAt)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted xl:hidden"
              onClick={() => setMobilePanel("properties")}
              aria-label="Open ticket properties"
            >
              <PanelIcon className="h-3.5 w-3.5" />
              Properties
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted xl:hidden"
              onClick={() => setMobilePanel("copilot")}
              aria-label="Open Cloutflow Copilot"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              Copilot
            </button>
            {canRetryAcknowledgement ? (
              <button
                type="button"
                onClick={() => {
                  void handleRetryAcknowledgement();
                }}
                disabled={ackRetrying}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-70"
              >
                {ackRetrying ? "Retrying ack..." : "Retry acknowledgement"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setResolveError(null);
                setResolveOpen(true);
              }}
              disabled={isResolved}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isResolved ? "Resolved" : "Mark as Resolved"}
            </button>
            {showClose && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted lg:hidden"
                aria-label="Back to ticket list"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:hidden">
          <StatusControl
            status={ticket.status}
            saving={statusSaving}
            error={statusError}
            onChange={(status) => {
              void handleStatusChange(status);
            }}
          />
          <AssignmentControl
            assignedExecutiveId={ticket.assignedExecutiveId}
            assignedExecutive={ticket.assignedExecutive}
            staffOptions={staffOptions}
            saving={assignSaving}
            error={assignError}
            onChange={(id) => {
              void handleAssignmentChange(id);
            }}
          />
        </div>
        {ackMessage || resolveNotice ? (
          <div className="mt-3 space-y-1">
            {ackMessage ? (
              <p className="text-xs text-muted" role="status">
                {ackMessage}
              </p>
            ) : null}
            {resolveNotice ? (
              <p
                className={`text-xs ${
                  resolveNotice.includes("could not be sent")
                    ? "text-[var(--danger)]"
                    : "text-[var(--success)]"
                }`}
                role="status"
              >
                {resolveNotice}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConversationTimeline
            items={timeline}
            loading={timelineLoading}
            error={timelineError}
            onRetry={() => {
              void loadTimeline();
            }}
            onRetryEmail={(commentId) => {
              void handleRetryEmail(commentId);
            }}
            retryingCommentId={retryingCommentId}
            issueDescription={ticket.issueDescription}
            createdAt={ticket.createdAt}
            creatorName={ticket.creatorName}
          />
          <ResizeHandle
            orientation="horizontal"
            label="Resize reply composer"
            onResize={(delta) => {
              setComposerHeight((prev) => clampSize(prev - delta, 140, 480));
            }}
          />
          <ReplyComposer
            height={composerHeight}
            creatorEmail={ticket.email}
            sourceChannel={ticket.sourceChannel}
            onQueueReply={handleQueueReply}
            onSaveNote={handleSaveNote}
            disabled={isResolved}
          />
        </div>

        <ResizeHandle
          orientation="vertical"
          label="Resize ticket properties column"
          className="hidden xl:block"
          onResize={(delta) => {
            setPropertiesWidth((prev) => clampSize(prev - delta, 240, 480));
          }}
        />

        <div
          className="hidden min-h-0 shrink-0 xl:block"
          style={{ width: propertiesWidth }}
        >
          <TicketProperties
            ticket={ticket}
            staffOptions={staffOptions}
            statusSaving={statusSaving}
            statusError={statusError}
            assignSaving={assignSaving}
            assignError={assignError}
            onStatusChange={(status) => {
              void handleStatusChange(status);
            }}
            onAssignmentChange={(id) => {
              void handleAssignmentChange(id);
            }}
          />
        </div>

        {!copilotCollapsed ? (
          <ResizeHandle
            orientation="vertical"
            label="Resize Cloutflow Copilot column"
            className="hidden xl:block"
            onResize={(delta) => {
              setCopilotWidth((prev) => clampSize(prev - delta, 220, 420));
            }}
          />
        ) : null}

        <div
          className="hidden min-h-0 shrink-0 xl:block"
          style={{ width: copilotCollapsed ? 52 : copilotWidth }}
        >
          <CloutflowCopilot
            ticket={ticket}
            hasPendingCreatorReply={hasPendingCreatorReply}
            collapsed={copilotCollapsed}
            onToggle={() => setCopilotCollapsed((prev) => !prev)}
          />
        </div>
      </div>

      {mobilePanel ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close side panel"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobilePanel(null)}
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-xl border border-border bg-surface shadow-[var(--shadow-lg)] sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[360px] sm:rounded-none sm:border-l">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">
                {mobilePanel === "properties"
                  ? "Ticket properties"
                  : "Cloutflow Copilot"}
              </p>
              <button
                type="button"
                onClick={() => setMobilePanel(null)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {mobilePanel === "properties" ? (
                <TicketProperties
                  ticket={ticket}
                  staffOptions={staffOptions}
                  statusSaving={statusSaving}
                  statusError={statusError}
                  assignSaving={assignSaving}
                  assignError={assignError}
                  onStatusChange={(status) => {
                    void handleStatusChange(status);
                  }}
                  onAssignmentChange={(id) => {
                    void handleAssignmentChange(id);
                  }}
                />
              ) : (
                <CloutflowCopilot
                  ticket={ticket}
                  hasPendingCreatorReply={hasPendingCreatorReply}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      <ResolveTicketModal
        open={resolveOpen}
        ticketCode={ticket.ticketNumber}
        creatorName={ticket.creatorName}
        submitting={resolveSaving}
        error={resolveError}
        onClose={() => {
          if (!resolveSaving) setResolveOpen(false);
        }}
        onConfirm={handleResolve}
      />
    </section>
  );
}
