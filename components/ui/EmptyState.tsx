"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}

export default function EmptyState({
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-md flex-col items-center text-center ${
        compact ? "px-4 py-8" : "px-6 py-16"
      }`}
    >
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
