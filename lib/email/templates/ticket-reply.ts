import { displayOrDash, escapeHtml } from "@/lib/email/html";
import {
  renderDetailRows,
  renderEmailLayout,
} from "@/lib/email/templates/layout";

export interface TicketReplyContent {
  creatorName: string;
  ticketCode: string;
  staffReply: string;
  ticketStatus: string;
  brand: string;
  campaignName: string;
  campaignMonth?: string;
}

export function buildTicketReplyEmail(input: TicketReplyContent): {
  subject: string;
  html: string;
  text: string;
} {
  const creatorName = displayOrDash(input.creatorName);
  const ticketCode = displayOrDash(input.ticketCode);
  const staffReply = input.staffReply.trim();
  const ticketStatus = displayOrDash(input.ticketStatus);
  const brand = displayOrDash(input.brand);
  const campaignName = displayOrDash(input.campaignName);
  const campaignMonth = displayOrDash(input.campaignMonth);

  const subject = `Update on your Cloutflow support ticket ${ticketCode}`;

  const contextRows = [
    { label: "Ticket code", value: ticketCode },
    { label: "Status", value: ticketStatus },
  ];
  if (brand !== "—") contextRows.push({ label: "Brand", value: brand });
  if (campaignName !== "—") {
    contextRows.push({ label: "Campaign", value: campaignName });
  }
  if (campaignMonth !== "—") {
    contextRows.push({ label: "Campaign month", value: campaignMonth });
  }

  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(creatorName)},</p>
    <p style="margin:0 0 12px;">
      Here is an update from Cloutflow Creator Support regarding your ticket.
    </p>
    ${renderDetailRows(contextRows)}
    <div style="margin:16px 0;padding:14px 16px;border-radius:8px;background:#f4f0fb;border:1px solid #e7e0f2;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#6b4eff;font-weight:700;">
        Message from support
      </p>
      <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.6;">
        ${escapeHtml(staffReply)}
      </p>
    </div>
    <p style="margin:0;">
      You can reply to this email if you need further assistance.
    </p>`;

  const text = [
    `Hi ${creatorName},`,
    "",
    "Here is an update from Cloutflow Creator Support regarding your ticket.",
    "",
    `Ticket code: ${ticketCode}`,
    `Status: ${ticketStatus}`,
    brand !== "—" ? `Brand: ${brand}` : null,
    campaignName !== "—" ? `Campaign: ${campaignName}` : null,
    campaignMonth !== "—" ? `Campaign month: ${campaignMonth}` : null,
    "",
    "Message from support:",
    staffReply,
    "",
    "You can reply to this email if you need further assistance.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    subject,
    html: renderEmailLayout({
      preheader: `Update on ticket ${ticketCode}`,
      title: "Update on your support ticket",
      bodyHtml,
    }),
    text,
  };
}
