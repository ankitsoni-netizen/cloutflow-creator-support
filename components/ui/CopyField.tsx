"use client";

import { useState } from "react";
import { CopyIcon } from "@/components/ui/Icons";
import { displayOrFallback } from "@/lib/utils";

interface CopyFieldProps {
  label: string;
  value: string | null | undefined;
}

export default function CopyField({ label, value }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const display = displayOrFallback(value);
  const canCopy = Boolean(value?.trim());

  async function handleCopy() {
    if (!canCopy || !value) return;
    try {
      await navigator.clipboard.writeText(value.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
          {label}
        </dt>
        <dd className="mt-0.5 break-all text-sm text-foreground">{display}</dd>
      </div>
      {canCopy ? (
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-surface-muted hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          <CopyIcon className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}
