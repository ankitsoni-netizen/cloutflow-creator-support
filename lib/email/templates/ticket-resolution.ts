import { displayOrDash, escapeHtml } from "@/lib/email/html";
import {
  renderDetailRows,
  renderEmailLayout,
} from "@/lib/email/templates/layout";

export interface TicketResolutionContent {
  creatorName: string;
  ticketCode: string;
  issueType: string;
  resolutionSummary: string;
  brand: string;
  campaignName: string;
  campaignMonth?: string;
}

export function buildTicketResolutionEmail(input: TicketResolutionContent): {
  subject: string;
  html: string;
  text: string;
} {
  const creatorName = displayOrDash(input.creatorName);
  const ticketCode = displayOrDash(input.ticketCode);
  const issueType = displayOrDash(input.issueType);
  const resolutionSummary = input.resolutionSummary.trim();
  const brand = displayOrDash(input.brand);
  const campaignName = displayOrDash(input.campaignName);
  const campaignMonth = displayOrDash(input.campaignMonth);

  const subject = `Resolved: Your Cloutflow support ticket ${ticketCode}`;

  const contextRows = [
    { label: "Ticket code", value: ticketCode },
    { label: "Issue type", value: issueType },
    { label: "Brand", value: brand },
    { label: "Campaign", value: campaignName },
    { label: "Campaign month", value: campaignMonth },
  ];

  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(creatorName)},</p>
    <p style="margin:0 0 12px;">
      Your Cloutflow Creator Support ticket
      <strong>${escapeHtml(ticketCode)}</strong> has been marked as resolved.
    </p>
    ${renderDetailRows(contextRows)}
    <div style="margin:16px 0;padding:14px 16px;border-radius:8px;background:#f4f0fb;border:1px solid #e7e0f2;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#6b4eff;font-weight:700;">
        Resolution summary
      </p>
      <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.6;">
        ${escapeHtml(resolutionSummary)}
      </p>
    </div>
    <p style="margin:0;">
      If you still need help, reply to this email and our team will assist you.
    </p>`;

  const text = [
    `Hi ${creatorName},`,
    "",
    `Your Cloutflow Creator Support ticket ${ticketCode} has been marked as resolved.`,
    "",
    `Ticket code: ${ticketCode}`,
    `Issue type: ${issueType}`,
    `Brand: ${brand}`,
    `Campaign: ${campaignName}`,
    `Campaign month: ${campaignMonth}`,
    "",
    "Resolution summary:",
    resolutionSummary,
    "",
    "If you still need help, reply to this email and our team will assist you.",
  ].join("\n");

  return {
    subject,
    html: renderEmailLayout({
      preheader: `Resolved: ticket ${ticketCode}`,
      title: "Your support ticket is resolved",
      bodyHtml,
    }),
    text,
  };
}
