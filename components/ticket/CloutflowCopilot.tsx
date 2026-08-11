"use client";

import { SparklesIcon } from "@/components/ui/Icons";
import type { CopilotAiResult, Ticket } from "@/lib/types";
import { isTicketAssigned, ticketAgeLabel } from "@/lib/utils";

interface CloutflowCopilotProps {
  ticket: Ticket;
  hasPendingCreatorReply?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Reserved for future AI backend responses. Never fabricate. */
  aiResult?: CopilotAiResult | null;
  aiConfigured?: boolean;
}

function missingFields(ticket: Ticket): string[] {
  const checks: { label: string; value: string | null | undefined }[] = [
    { label: "Creator phone", value: ticket.phone },
    { label: "Creator email", value: ticket.email },
    { label: "Social handle", value: ticket.socialHandle },
    { label: "Campaign name", value: ticket.campaignName },
    { label: "Brand", value: ticket.brand },
    { label: "Campaign month", value: ticket.campaignMonth },
    { label: "Cloutflow POC", value: ticket.cloutflowPoc },
    { label: "POC contact", value: ticket.cloutflowPocContactNumber },
    { label: "Issue description", value: ticket.issueDescription },
    { label: "Assigned executive", value: ticket.assignedExecutive },
  ];

  return checks
    .filter((item) => !item.value?.trim())
    .map((item) => item.label);
}

function AiPlaceholder({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted/80 px-3 py-3">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {value ? (
        <p className="mt-1 text-sm leading-5 text-foreground">{value}</p>
      ) : (
        <>
          <p className="mt-1 text-[11px] leading-5 text-muted">{description}</p>
          <button
            type="button"
            disabled
            className="mt-2 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted"
          >
            Connect AI to generate
          </button>
        </>
      )}
    </div>
  );
}

export default function CloutflowCopilot({
  ticket,
  hasPendingCreatorReply = false,
  collapsed = true,
  onToggle,
  aiResult = null,
  aiConfigured = false,
}: CloutflowCopilotProps) {
  const missing = missingFields(ticket);
  const assigned = isTicketAssigned(ticket);

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center border-l border-border bg-surface px-1 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-accent hover:bg-accent-soft"
          aria-label="Expand Cloutflow Copilot"
          title="Cloutflow Copilot"
        >
          <SparklesIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md brand-gradient text-white">
              <SparklesIcon className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">
              Cloutflow Copilot
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {aiConfigured
              ? "AI connected"
              : "AI assistance panel · Setup required"}
          </p>
        </div>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-muted"
          >
            Collapse
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="rounded-md border border-border bg-[var(--accent-blue-soft)] px-3 py-3">
          <p className="text-[11px] font-semibold tracking-wide text-[var(--brand-blue)] uppercase">
            Ticket facts
          </p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="Status" value={ticket.status} />
            <Row label="Issue type" value={ticket.issueType} />
            <Row label="Ticket age" value={ticketAgeLabel(ticket.createdAt)} />
            <Row label="Priority" value={ticket.priority} />
            <Row
              label="Assigned"
              value={assigned ? ticket.assignedExecutive : "Unassigned"}
            />
            <Row
              label="Creator reply"
              value={
                hasPendingCreatorReply
                  ? "Pending delivery queued"
                  : "No pending queued reply on record"
              }
            />
            <Row
              label="Creator"
              value={ticket.creatorName || "Not provided"}
            />
            <Row
              label="Campaign"
              value={
                [ticket.campaignName, ticket.brand, ticket.campaignMonth]
                  .filter(Boolean)
                  .join(" · ") || "Not provided"
              }
            />
          </dl>
        </section>

        <section>
          <p className="text-xs font-semibold text-foreground">
            Missing information
          </p>
          {missing.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              All common required fields are present on this ticket.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {missing.map((field) => (
                <li
                  key={field}
                  className="rounded-md border border-[var(--warning-soft)] bg-[var(--warning-soft)] px-2.5 py-1.5 text-xs text-[var(--warning)]"
                >
                  {field}
                </li>
              ))}
            </ul>
          )}
        </section>

        <AiPlaceholder
          title="Ticket summary"
          description="Connect Cloutflow Copilot to generate a concise summary from conversation history."
          value={aiResult?.summary}
        />
        <AiPlaceholder
          title="Suggested next action"
          description="Suggested actions appear after an AI backend is configured."
          value={aiResult?.suggestedNextAction}
        />
        <AiPlaceholder
          title="Draft creator response"
          description="Draft replies stay disabled until AI is connected. Delivery still depends on channels."
          value={aiResult?.draftCreatorResponse}
        />
        <AiPlaceholder
          title="Resolution Base matches"
          description="Knowledge matches require AI indexing and published articles."
        />
        <AiPlaceholder
          title="Similar resolved tickets"
          description="Similar-ticket retrieval requires AI embeddings. No fabricated matches."
        />
        <AiPlaceholder
          title="Risk and escalation"
          description="Sentiment/risk scoring stays disabled until AI is connected. No fabricated scores."
          value={
            aiResult?.riskAndEscalation
              ? `${aiResult.riskAndEscalation.level}: ${aiResult.riskAndEscalation.rationale}`
              : undefined
          }
        />
        <AiPlaceholder
          title="Suggested assignment"
          description="Assignment suggestions require AI and team routing rules."
          value={
            aiResult?.suggestedAssignment
              ? [
                  aiResult.suggestedAssignment.executiveName,
                  aiResult.suggestedAssignment.team,
                  aiResult.suggestedAssignment.rationale,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        <AiPlaceholder
          title="Suggested priority"
          description="Priority suggestions require AI. Current priority remains manually controlled."
          value={
            aiResult?.suggestedPriority
              ? `${aiResult.suggestedPriority.priority}: ${aiResult.suggestedPriority.rationale}`
              : undefined
          }
        />
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
