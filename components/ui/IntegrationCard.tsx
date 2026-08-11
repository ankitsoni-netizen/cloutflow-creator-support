"use client";

type IntegrationStatus = "not_connected" | "setup_required" | "connected" | "error";

interface IntegrationCardProps {
  name: string;
  description: string;
  inbound: string;
  outbound: string;
  setupNotes: string;
  status?: IntegrationStatus;
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  not_connected: "Not Connected",
  setup_required: "Setup Required",
  connected: "Connected",
  error: "Error",
};

const STATUS_CLASS: Record<IntegrationStatus, string> = {
  not_connected: "bg-surface-muted text-muted ring-border",
  setup_required: "bg-[var(--warning-soft)] text-[var(--warning)] ring-[color-mix(in_srgb,var(--warning)_25%,transparent)]",
  connected: "bg-[var(--success-soft)] text-[var(--success)] ring-[color-mix(in_srgb,var(--success)_25%,transparent)]",
  error: "bg-[var(--danger-soft)] text-[var(--danger)] ring-[color-mix(in_srgb,var(--danger)_25%,transparent)]",
};

export default function IntegrationCard({
  name,
  description,
  inbound,
  outbound,
  setupNotes,
  status = "not_connected",
}: IntegrationCardProps) {
  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{name}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${STATUS_CLASS[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Inbound</dt>
          <dd className="text-right text-foreground">{inbound}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Outbound</dt>
          <dd className="text-right text-foreground">{outbound}</dd>
        </div>
      </dl>

      <p className="mt-4 rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-xs leading-5 text-muted">
        {setupNotes}
      </p>
      <p className="mt-2 text-[11px] text-muted">
        Credentials are never collected or stored in the frontend.
      </p>
    </article>
  );
}
