"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

type ComposerMode = "reply" | "note";

interface ReplyComposerProps {
  creatorEmail?: string;
  onQueueReply: (text: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onSaveNote: (text: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  disabled?: boolean;
  height?: number;
}

export default function ReplyComposer({
  creatorEmail = "",
  onQueueReply,
  onSaveNote,
  disabled = false,
  height,
}: ReplyComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("reply");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const trimmedEmail = creatorEmail.trim();
  const canEmailCreator = Boolean(trimmedEmail);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || disabled) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError(
        mode === "reply"
          ? "Creator reply cannot be empty."
          : "Internal note cannot be empty.",
      );
      return;
    }

    if (mode === "reply" && !canEmailCreator) {
      setError("This ticket has no creator email address.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const result =
      mode === "reply" ? await onQueueReply(trimmed) : await onSaveNote(trimmed);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (mode === "reply") {
      setText("");
      setSuccess("Email accepted by Brevo.");
    } else {
      setText("");
      setSuccess("Internal note saved.");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      const form = event.currentTarget.form;
      form?.requestSubmit();
    }
  }

  const charCount = text.length;
  const placeholder =
    mode === "reply"
      ? "Write a creator-facing reply. This will be emailed to the creator."
      : "Write a private note visible only to Cloutflow staff.";

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      style={height ? { height } : undefined}
      className="flex shrink-0 flex-col border-t border-border bg-surface"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 pt-2 sm:px-4">
        <button
          type="button"
          onClick={() => {
            setMode("reply");
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-t-md px-3 py-2 text-xs font-semibold transition-colors ${
            mode === "reply"
              ? "border border-b-surface border-border bg-surface text-accent"
              : "text-muted hover:text-foreground"
          }`}
        >
          Reply to Creator
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("note");
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-t-md px-3 py-2 text-xs font-semibold transition-colors ${
            mode === "note"
              ? "border border-b-surface border-border bg-surface text-accent"
              : "text-muted hover:text-foreground"
          }`}
        >
          Internal Note
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col space-y-2 overflow-hidden px-3 py-3 sm:px-4">
        <div
          className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] ${
            mode === "reply"
              ? "border-[color-mix(in_srgb,var(--brand-blue)_25%,transparent)] bg-[var(--accent-blue-soft)] text-[var(--brand-blue)]"
              : "border-[var(--internal-border)] bg-[var(--internal-soft)] text-[var(--brand-violet)]"
          }`}
        >
          {mode === "reply"
            ? canEmailCreator
              ? `Public reply mode · Email will be sent to ${trimmedEmail}`
              : "Public reply mode · This ticket has no creator email address."
            : "Private note mode · Visible to staff only. Never sent to the creator."}
        </div>

        <label className="flex min-h-0 flex-1 flex-col">
          <span className="sr-only">
            {mode === "reply" ? "Creator reply" : "Internal note"}
          </span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
              setSuccess(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={submitting || disabled}
            rows={height ? undefined : 4}
            className="min-h-0 w-full flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-70"
            placeholder={placeholder}
          />
        </label>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted tabular-nums">
              {charCount} character{charCount === 1 ? "" : "s"}
            </p>
            <p className="text-[11px] text-muted">
              Tip: press Cmd/Ctrl+Enter to send · Attachments unavailable in this
              phase
            </p>
          </div>
          <button
            type="submit"
            disabled={
              submitting ||
              disabled ||
              (mode === "reply" && !canEmailCreator)
            }
            className={`rounded-md px-3.5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
              mode === "reply"
                ? "bg-accent hover:bg-accent-hover"
                : "bg-[var(--brand-violet)] hover:bg-accent-hover"
            }`}
          >
            {submitting
              ? mode === "reply"
                ? "Sending..."
                : "Saving..."
              : mode === "reply"
                ? "Send Email"
                : "Save Note"}
          </button>
        </div>

        {error ? (
          <p className="shrink-0 text-xs text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="shrink-0 text-xs text-[var(--success)]" role="status">
            {success}
          </p>
        ) : null}
      </div>
    </form>
  );
}
