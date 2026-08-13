import { displayOrDash, escapeHtml } from "@/lib/email/html";
import {
  renderDetailRows,
  renderEmailLayout,
} from "@/lib/email/templates/layout";

export interface WebsiteInternalNotificationDetailRow {
  label: string;
  value: string;
}

export interface WebsiteInternalNotificationContent {
  ticketCode: string;
  /** Desk / product label used in the subject line (e.g. Creator Support). */
  deskLabel: string;
  requesterName: string;
  enquiryCategory: string;
  detailRows: WebsiteInternalNotificationDetailRow[];
  enquiryMessage: string;
}

export function buildWebsiteInternalNotificationEmail(
  input: WebsiteInternalNotificationContent,
): { subject: string; html: string; text: string } {
  const ticketCode = displayOrDash(input.ticketCode);
  const deskLabel = displayOrDash(input.deskLabel);
  const requesterName = displayOrDash(input.requesterName);
  const enquiryCategory = displayOrDash(input.enquiryCategory);
  const enquiryMessage = input.enquiryMessage.trim() || "—";

  const detailRows = [
    { label: "Ticket code", value: ticketCode },
    { label: "Enquiry category", value: enquiryCategory },
    { label: "Requester name", value: requesterName },
    ...input.detailRows
      .map((row) => ({
        label: row.label.trim(),
        value: row.value.trim(),
      }))
      .filter((row) => row.label && row.value),
  ];

  const subject = `New website enquiry [${ticketCode}] — ${deskLabel} — ${requesterName}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;">
      A new website enquiry was submitted and logged in Creator Support.
    </p>
    ${renderDetailRows(detailRows)}
    <div style="margin:16px 0;padding:14px 16px;border-radius:8px;background:#f4f0fb;border:1px solid #e7e0f2;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#6b4eff;font-weight:700;">
        Enquiry message
      </p>
      <p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.6;">
        ${escapeHtml(enquiryMessage)}
      </p>
    </div>
    <p style="margin:0;">
      Reply to this email to contact the requester directly.
    </p>`;

  const text = [
    "A new website enquiry was submitted and logged in Creator Support.",
    "",
    ...detailRows.map((row) => `${row.label}: ${row.value}`),
    "",
    "Enquiry message:",
    enquiryMessage,
    "",
    "Reply to this email to contact the requester directly.",
  ].join("\n");

  return {
    subject,
    html: renderEmailLayout({
      preheader: `New website enquiry ${ticketCode}`,
      title: "New website enquiry",
      bodyHtml,
    }),
    text,
  };
}
