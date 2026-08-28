"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

interface ResolveTicketModalProps {
  open: boolean;
  ticketCode: string;
  creatorName: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (resolutionSummary: string) => void | Promise<void>;
}

export default function ResolveTicketModal({
  open,
  ticketCode,
  creatorName,
  submitting,
  error,
  onClose,
  onConfirm,
}: ResolveTicketModalProps) {
  if (!open) return null;

  return (
    <ResolveTicketModalForm
      ticketCode={ticketCode}
      creatorName={creatorName}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function ResolveTicketModalForm({
  ticketCode,
  creatorName,
  submitting,
  error,
  onClose,
  onConfirm,
}: Omit<ResolveTicketModalProps, "open">) {
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [summary, setSummary] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = summary.trim();
    if (!trimmed) {
      setLocalError("Resolution summary is required.");
      return;
    }
    setLocalError(null);
    await onConfirm(trimmed);
  }

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8 sm:items-center">
      <button
        type="button"
        aria-label="Close resolve modal overlay"
        className="absolute inset-0"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl"
      >
        <form onSubmit={handleSubmit}>
          <div className="border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              Mark as Resolved
            </h2>
            <p className="mt-1 text-sm text-muted">
              Confirm resolution for{" "}
              <span className="font-medium text-foreground">{ticketCode}</span>{" "}
              · {creatorName}
            </p>
          </div>

          <div className="space-y-3 px-5 py-5">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-foreground">
                Resolution summary <span className="text-red-600">*</span>
              </span>
              <textarea
                ref={inputRef}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setLocalError(null);
                }}
                disabled={submitting}
                className="min-h-28 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-70"
                placeholder="Summarize how this ticket was resolved"
              />
            </label>
            <p className="text-xs text-muted">
              Confirming will mark the ticket resolved. The creator will be
              notified in the background when a channel is available.
            </p>
            {displayError ? (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {displayError}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Resolving..." : "Confirm Resolve"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
