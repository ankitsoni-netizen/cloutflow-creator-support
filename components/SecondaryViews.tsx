"use client";

import type { Ticket } from "@/lib/types";

interface AnalyticsViewProps {
  tickets: Ticket[];
  onOpenInbox: () => void;
}

export function AnalyticsView({ tickets, onOpenInbox }: AnalyticsViewProps) {
  const openCount = tickets.filter((t) => t.status === "Open").length;
  const inProgress = tickets.filter((t) => t.status === "In Progress").length;
  const waiting = tickets.filter((t) => t.status === "Waiting").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const urgent = tickets.filter((t) => t.priority === "Urgent").length;

  const stats = [
    { label: "Total tickets", value: tickets.length },
    { label: "Open", value: openCount },
    { label: "In Progress", value: inProgress },
    { label: "Waiting", value: waiting },
    { label: "Resolved", value: resolved },
    { label: "Urgent", value: urgent },
  ];

  return (
    <section className="h-full overflow-y-auto bg-surface p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
            <p className="mt-1 text-sm text-muted">
              Snapshot of the current Creator Support queue.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenInbox}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Back to Inbox
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border bg-surface-muted px-4 py-5"
            >
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                {stat.label}
              </p>
              <p className="mt-2 text-3xl font-semibold text-foreground">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const RESOLUTION_ARTICLES = [
  {
    title: "Payment delay checklist",
    summary:
      "Verify invoice, milestone approval, finance queue status, and creator bank details before escalation.",
  },
  {
    title: "TDS and Form 16A response template",
    summary:
      "Standard language for explaining TDS deductions and expected Form 16A issuance windows.",
  },
  {
    title: "POC conduct escalation path",
    summary:
      "Internal steps for urgent creator conduct concerns, including brand POC outreach and follow-up SLAs.",
  },
  {
    title: "GST invoice guidance for creators",
    summary:
      "When GST invoices are required and how creators update GSTIN on their Cloutflow profile.",
  },
];

interface ResolutionBaseViewProps {
  onOpenInbox: () => void;
}

export function ResolutionBaseView({ onOpenInbox }: ResolutionBaseViewProps) {
  return (
    <section className="h-full overflow-y-auto bg-surface p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Resolution Base
            </h1>
            <p className="mt-1 text-sm text-muted">
              Quick reference playbooks for common creator support issues.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenInbox}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Back to Inbox
          </button>
        </div>

        <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
          {RESOLUTION_ARTICLES.map((article) => (
            <li key={article.title} className="px-4 py-4">
              <h2 className="text-sm font-semibold text-foreground">
                {article.title}
              </h2>
              <p className="mt-1 text-sm text-muted">{article.summary}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

interface SettingsViewProps {
  emailAcknowledgements: boolean;
  onToggleEmailAcknowledgements: () => void;
  onOpenInbox: () => void;
}

export function SettingsView({
  emailAcknowledgements,
  onToggleEmailAcknowledgements,
  onOpenInbox,
}: SettingsViewProps) {
  return (
    <section className="h-full overflow-y-auto bg-surface p-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Settings</h1>
            <p className="mt-1 text-sm text-muted">
              Prototype preferences for Creator Support workflows.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenInbox}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Back to Inbox
          </button>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-surface-muted p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Default acknowledgement emails
              </h2>
              <p className="mt-1 text-sm text-muted">
                Prefill the acknowledgement checkbox when raising a new ticket.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emailAcknowledgements}
              onClick={onToggleEmailAcknowledgements}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                emailAcknowledgements ? "bg-accent" : "bg-border-strong"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  emailAcknowledgements ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
