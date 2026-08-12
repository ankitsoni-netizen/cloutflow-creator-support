import { displayOrDash, escapeHtml } from "@/lib/email/html";
import {
  renderDetailRows,
  renderEmailLayout,
} from "@/lib/email/templates/layout";

export interface TicketAcknowledgementDetailRow {
  label: string;
  value: string;
}

export interface TicketAcknowledgementContent {
  creatorName: string;
  ticketCode: string;
  /** Readable enquiry category or legacy issue type headline. */
  enquiryCategory: string;
  detailRows: TicketAcknowledgementDetailRow[];
}

export function buildTicketAcknowledgementEmail(
  input: TicketAcknowledgementContent,
): { subject: string; html: string; text: string } {
  const creatorName = displayOrDash(input.creatorName);
  const ticketCode = displayOrDash(input.ticketCode);
  const enquiryCategory = displayOrDash(input.enquiryCategory);
  const detailRows = [
    { label: "Ticket code", value: ticketCode },
    { label: "Enquiry category", value: enquiryCategory },
    ...input.detailRows
      .map((row) => ({
        label: row.label.trim(),
        value: row.value.trim(),
      }))
      .filter((row) => row.label && row.value),
  ];

  const subject = `We've received your request — ${ticketCode}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(creatorName)},</p>
    <p style="margin:0 0 12px;">
      Cloutflow Creator Support has logged your request. Our team will review it
      and follow up as soon as possible.
    </p>
    ${renderDetailRows(detailRows)}
    <p style="margin:16px 0 0;">
      Please keep ticket code <strong>${escapeHtml(ticketCode)}</strong> for
      future communication about this request.
    </p>`;

  const text = [
    `Hi ${creatorName},`,
    "",
    "Cloutflow Creator Support has logged your request. Our team will review it and follow up as soon as possible.",
    "",
    ...detailRows.map((row) => `${row.label}: ${row.value}`),
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
