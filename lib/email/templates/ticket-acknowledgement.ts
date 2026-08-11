import { displayOrDash, escapeHtml } from "@/lib/email/html";
import {
  renderDetailRows,
  renderEmailLayout,
} from "@/lib/email/templates/layout";

export interface TicketAcknowledgementContent {
  creatorName: string;
  ticketCode: string;
  issueType: string;
  brand: string;
  campaignName: string;
  campaignMonth: string;
}

export function buildTicketAcknowledgementEmail(
  input: TicketAcknowledgementContent,
): { subject: string; html: string; text: string } {
  const creatorName = displayOrDash(input.creatorName);
  const ticketCode = displayOrDash(input.ticketCode);
  const issueType = displayOrDash(input.issueType);
  const brand = displayOrDash(input.brand);
  const campaignName = displayOrDash(input.campaignName);
  const campaignMonth = displayOrDash(input.campaignMonth);

  const subject = `We've received your request — ${ticketCode}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(creatorName)},</p>
    <p style="margin:0 0 12px;">
      Cloutflow Creator Support has logged your request. Our team will review it
      and follow up as soon as possible.
    </p>
    ${renderDetailRows([
      { label: "Ticket code", value: ticketCode },
      { label: "Issue type", value: issueType },
      { label: "Brand", value: brand },
      { label: "Campaign", value: campaignName },
      { label: "Campaign month", value: campaignMonth },
    ])}
    <p style="margin:16px 0 0;">
      Please keep ticket code <strong>${escapeHtml(ticketCode)}</strong> for
      future communication about this request.
    </p>`;

  const text = [
    `Hi ${creatorName},`,
    "",
    "Cloutflow Creator Support has logged your request. Our team will review it and follow up as soon as possible.",
    "",
    `Ticket code: ${ticketCode}`,
    `Issue type: ${issueType}`,
    `Brand: ${brand}`,
    `Campaign: ${campaignName}`,
    `Campaign month: ${campaignMonth}`,
    "",
    `Please keep ticket code ${ticketCode} for future communication about this request.`,
    "",
    "You can reply to this email if you need further assistance.",
  ].join("\n");

  return {
    subject,
    html: renderEmailLayout({
      preheader: `We've received your request — ${ticketCode}`,
      title: "We've received your request",
      bodyHtml,
    }),
    text,
  };
}
