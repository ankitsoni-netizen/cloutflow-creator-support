"use client";

import EmptyState from "@/components/ui/EmptyState";
import { SparklesIcon } from "@/components/ui/Icons";

const REQUIRED_FIELDS = [
  "Name",
  "Phone",
  "Email",
  "Social media handle",
  "Platform",
  "Campaign",
  "Brand",
  "Campaign month",
  "Cloutflow POC",
  "POC contact",
  "Issue description",
];

const WORKFLOWS = [
  {
    id: "payment",
    title: "Payment Delayed",
    routingTeam: "Finance Operations",
    escalation:
      "Escalate to Finance Supervisor when creator provides verified invoice and campaign proof and status remains unpaid after internal confirmation.",
    safeResponses: [
      "Acknowledge receipt and confirm required documents.",
      "Explain that payment dates are only shared after verified finance status.",
    ],
    prohibited: [
      "Never promise a payment date without verified data.",
      "Never invent payment status.",
    ],
    humanApproval: "Financial commitments require human approval.",
    resolutionSources: ["Payment", "Invoice", "Banking"],
    channels: ["WhatsApp", "Email", "Website Chat", "Phone intake"],
  },
  {
    id: "tax",
    title: "TDS / GST",
    routingTeam: "Finance Operations",
    escalation:
      "Escalate when creator disputes TDS/GST amounts or requests formal certificates beyond standard windows.",
    safeResponses: [
      "Collect campaign and invoice identifiers.",
      "Share only verified TDS/GST guidance from Resolution Base.",
    ],
    prohibited: [
      "Never invent TDS or GST status.",
      "Never invent Form 16A timelines.",
    ],
    humanApproval: "Tax commitments and certificate promises require human approval.",
    resolutionSources: ["TDS", "GST", "Invoice"],
    channels: ["WhatsApp", "Email", "Website Chat"],
  },
  {
    id: "conduct",
    title: "POC or Conduct Concern",
    routingTeam: "Campaign Operations / Supervisor",
    escalation:
      "Immediately escalate legal threats and sensitive conduct complaints to a human supervisor.",
    safeResponses: [
      "Acknowledge concern with empathy.",
      "Collect facts without making disciplinary judgments.",
    ],
    prohibited: [
      "Never make disciplinary judgments.",
      "Never expose internal comments.",
      "Never disclose another creator’s information.",
    ],
    humanApproval: "All conduct outcomes require human review.",
    resolutionSources: ["POC Escalation", "Creator Conduct"],
    channels: ["WhatsApp", "Email", "Phone intake"],
  },
  {
    id: "other",
    title: "Other Creator Query",
    routingTeam: "CRM Executive",
    escalation:
      "Escalate when required creator/campaign fields are incomplete after one clarification attempt, or when the query becomes financial/legal.",
    safeResponses: [
      "Collect missing required fields.",
      "Create a structured ticket and confirm next human step.",
    ],
    prohibited: [
      "Never invent campaign or ownership facts.",
      "Never auto-close without human confirmation when money or compliance is involved.",
    ],
    humanApproval: "Any commitment beyond information collection requires human approval.",
    resolutionSources: ["General Support", "Platform Guidance"],
    channels: ["Website Chat", "WhatsApp", "Instagram", "Email", "Phone intake"],
  },
] as const;

interface AIAgentStudioProps {
  onOpenInbox: () => void;
}

export default function AIAgentStudio({ onOpenInbox }: AIAgentStudioProps) {
  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md brand-gradient text-white">
                <SparklesIcon className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-semibold text-foreground">
                AI Agent Studio
              </h1>
            </div>
            <p className="mt-2 text-sm text-muted">
              Future creator chatbot workflows for Cloutflow Copilot. Agent
              status is not configured until a real AI backend is connected.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[var(--ai-setup-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ai-setup)] ring-1 ring-border">
              Not configured
            </span>
            <button
              type="button"
              onClick={onOpenInbox}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Open Inbox
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">
            Required creator information
          </h2>
          <p className="mt-1 text-xs text-muted">
            Every automated intake path must collect these fields before
            routing.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {REQUIRED_FIELDS.map((field) => (
              <li
                key={field}
                className="rounded-md bg-surface-muted px-2.5 py-1 text-xs text-foreground"
              >
                {field}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {WORKFLOWS.map((workflow) => (
            <article
              key={workflow.id}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {workflow.title}
                </h3>
                <span className="rounded-md bg-[var(--ai-setup-soft)] px-2 py-1 text-[10px] font-semibold text-muted">
                  Setup required
                </span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Routing team
                  </dt>
                  <dd className="mt-0.5 text-foreground">{workflow.routingTeam}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Escalation rules
                  </dt>
                  <dd className="mt-0.5 text-muted">{workflow.escalation}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Safe automatic responses
                  </dt>
                  <dd className="mt-0.5">
                    <ul className="list-disc space-y-1 pl-4 text-muted">
                      {workflow.safeResponses.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Prohibited AI actions
                  </dt>
                  <dd className="mt-0.5">
                    <ul className="list-disc space-y-1 pl-4 text-muted">
                      {workflow.prohibited.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Human approval
                  </dt>
                  <dd className="mt-0.5 text-muted">{workflow.humanApproval}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Resolution Base sources
                  </dt>
                  <dd className="mt-0.5 text-muted">
                    {workflow.resolutionSources.join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
                    Supported future channels
                  </dt>
                  <dd className="mt-0.5 text-muted">
                    {workflow.channels.join(", ")}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                disabled
                className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted"
              >
                Connect AI to activate
              </button>
            </article>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-border bg-surface">
          <EmptyState
            compact
            title="No live AI agent connected"
            description="This studio defines guardrails and workflow contracts only. OpenAI and channel APIs are not called from this milestone."
          />
        </div>
      </div>
    </section>
  );
}
