"use client";

import { useState, type ReactNode } from "react";
import AssignmentControl from "@/components/ticket/AssignmentControl";
import StatusControl from "@/components/ticket/StatusControl";
import ChannelBadge from "@/components/ui/ChannelBadge";
import CopyField from "@/components/ui/CopyField";
import type { StaffOption } from "@/lib/tickets/workflow-types";
import type { Ticket, TicketStatus } from "@/lib/types";
import { displayOrFallback, formatDateTime } from "@/lib/utils";

interface TicketPropertiesProps {
  ticket: Ticket;
  staffOptions: StaffOption[];
  statusSaving: boolean;
  statusError: string | null;
  assignSaving: boolean;
  assignError: string | null;
  onStatusChange: (status: Exclude<TicketStatus, "Resolved">) => void;
  onAssignmentChange: (assigneeUserId: string) => void;
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          {title}
        </h3>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2">
      <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export default function TicketProperties({
  ticket,
  staffOptions,
  statusSaving,
  statusError,
  assignSaving,
  assignError,
  onStatusChange,
  onAssignmentChange,
}: TicketPropertiesProps) {
  const isWebsite = ticket.sourceChannel === "Website";
  const isCreatorSupport =
    ticket.requestCategoryKey === "creator_support" ||
    (!ticket.requestCategoryKey && Boolean(ticket.brand || ticket.campaignMonth));

  const showRequesterProfile =
    hasText(ticket.creatorName) ||
    hasText(ticket.phone) ||
    hasText(ticket.email) ||
    hasText(ticket.socialHandle) ||
    hasText(ticket.platform) ||
    hasText(ticket.companyName) ||
    hasText(ticket.requesterType);

  const showCampaignDetails =
    isCreatorSupport ||
    hasText(ticket.campaignName) ||
    hasText(ticket.brand) ||
    hasText(ticket.campaignMonth) ||
    hasText(ticket.cloutflowPoc) ||
    hasText(ticket.cloutflowPocContactNumber);

  const showEnquiryExtras =
    isWebsite &&
    (hasText(ticket.requestCategory) ||
      hasText(ticket.companyName) ||
      hasText(ticket.requesterType) ||
      hasText(ticket.topicOrModule));

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <Section title="Ticket properties">
        <div className="space-y-3">
          <StatusControl
            status={ticket.status}
            saving={statusSaving}
            error={statusError}
            onChange={onStatusChange}
          />
          <ReadRow label="Priority" value={ticket.priority} />
          {hasText(ticket.requestCategory) ? (
            <ReadRow label="Enquiry category" value={ticket.requestCategory} />
          ) : null}
          {isCreatorSupport || !isWebsite ? (
            <ReadRow label="Issue type" value={ticket.issueType} />
          ) : null}
          <div className="py-2">
            <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Source channel
            </dt>
            <dd className="mt-1">
              <ChannelBadge channel={ticket.sourceChannel} />
            </dd>
          </div>
          <ReadRow
            label="Created"
            value={formatDateTime(ticket.createdAt)}
          />
          <ReadRow
            label="Last updated"
            value={formatDateTime(ticket.updatedAt)}
          />
        </div>
      </Section>

      {showRequesterProfile ? (
        <Section title={isWebsite && !isCreatorSupport ? "Requester" : "Creator profile"}>
          <dl className="divide-y divide-border">
            <ReadRow label="Name" value={ticket.creatorName} />
            {hasText(ticket.requesterType) ? (
              <ReadRow label="Requester type" value={ticket.requesterType} />
            ) : null}
            {hasText(ticket.companyName) ? (
              <ReadRow label="Company" value={ticket.companyName} />
            ) : null}
            {hasText(ticket.phone) ? (
              <CopyField label="Phone" value={ticket.phone} />
            ) : null}
            {hasText(ticket.email) ? (
              <CopyField label="Email" value={ticket.email} />
            ) : null}
            {hasText(ticket.socialHandle) ? (
              <CopyField label="Social handle" value={ticket.socialHandle} />
            ) : null}
            {hasText(ticket.platform) ? (
              <ReadRow label="Platform" value={ticket.platform} />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {showEnquiryExtras && !isCreatorSupport ? (
        <Section title="Website enquiry details" defaultOpen>
          <dl className="divide-y divide-border">
            <ReadRow label="Enquiry category" value={ticket.requestCategory} />
            {hasText(ticket.companyName) ? (
              <ReadRow label="Company" value={ticket.companyName} />
            ) : null}
            {hasText(ticket.requesterType) ? (
              <ReadRow label="Requester type" value={ticket.requesterType} />
            ) : null}
            {hasText(ticket.topicOrModule) ? (
              <ReadRow label="Topic or module" value={ticket.topicOrModule} />
            ) : null}
            {hasText(ticket.campaignName) ? (
              <ReadRow
                label="Campaign name or ID"
                value={ticket.campaignName}
              />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {showCampaignDetails ? (
        <Section title="Campaign details">
          <dl className="divide-y divide-border">
            {hasText(ticket.campaignName) ? (
              <ReadRow label="Campaign" value={ticket.campaignName} />
            ) : null}
            {hasText(ticket.brand) ? (
              <ReadRow label="Brand" value={ticket.brand} />
            ) : null}
            {hasText(ticket.campaignMonth) ? (
              <ReadRow label="Campaign month" value={ticket.campaignMonth} />
            ) : null}
            {hasText(ticket.cloutflowPoc) ? (
              <ReadRow label="Cloutflow POC" value={ticket.cloutflowPoc} />
            ) : null}
            {hasText(ticket.cloutflowPocContactNumber) ? (
              <CopyField
                label="POC contact number"
                value={ticket.cloutflowPocContactNumber}
              />
            ) : null}
            {!hasText(ticket.campaignName) &&
            !hasText(ticket.brand) &&
            !hasText(ticket.campaignMonth) &&
            !hasText(ticket.cloutflowPoc) &&
            !hasText(ticket.cloutflowPocContactNumber) ? (
              <p className="py-2 text-sm text-muted">
                No campaign details on this ticket.
              </p>
            ) : null}
          </dl>
        </Section>
      ) : null}

      <Section title="Assignment">
        <div className="space-y-3">
          <AssignmentControl
            assignedExecutiveId={ticket.assignedExecutiveId}
            assignedExecutive={ticket.assignedExecutive}
            staffOptions={staffOptions}
            saving={assignSaving}
            error={assignError}
            onChange={onAssignmentChange}
          />
          <ReadRow
            label="Assigned team"
            value={displayOrFallback(ticket.assignedTeam)}
          />
        </div>
      </Section>

      <Section title="Resolution">
        {ticket.resolutionSummary ? (
          <div className="space-y-2">
            <ReadRow
              label="Resolved at"
              value={
                ticket.resolvedAt
                  ? formatDateTime(ticket.resolvedAt)
                  : "Not provided"
              }
            />
            <div>
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                Summary
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {ticket.resolutionSummary}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No resolution recorded yet.
          </p>
        )}
      </Section>

      <Section title="Channel information">
        <dl className="divide-y divide-border">
          <ReadRow label="Inbound source" value={ticket.sourceChannel} />
          <ReadRow
            label="Email outbound"
            value="Connected · Cloutflow Creator Support"
          />
          <ReadRow label="WhatsApp" value="Not connected" />
          <ReadRow label="Instagram" value="Not connected" />
          <ReadRow label="Website chatbot" value="Not connected" />
          <ReadRow
            label="Integration health"
            value="Email connected · 3 channels offline"
          />
        </dl>
        {ticket.internalCallNotes ? (
          <div className="mt-3 rounded-md border border-[var(--note-border)] bg-[var(--note-soft)] p-3">
            <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Internal call notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {ticket.internalCallNotes}
            </p>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
