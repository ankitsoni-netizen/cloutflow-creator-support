import { escapeHtml } from "@/lib/email/html";

export interface EmailLayoutInput {
  preheader: string;
  title: string;
  bodyHtml: string;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const preheader = escapeHtml(input.preheader);
  const title = escapeHtml(input.title);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f0fb;font-family:Arial,Helvetica,sans-serif;color:#1f1630;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${preheader}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e0f2;border-radius:12px;">
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b4eff;font-weight:700;">
                  Cloutflow Creator Support
                </p>
                <h1 style="margin:0;font-size:22px;line-height:1.35;color:#1f1630;">
                  ${title}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px 28px;font-size:15px;line-height:1.6;color:#1f1630;">
                ${input.bodyHtml}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b6575;max-width:560px;">
            You can reply to this email if you need further assistance from Cloutflow Creator Support.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderDetailRows(
  rows: Array<{ label: string; value: string }>,
): string {
  const items = rows
    .map(
      (row) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee8f6;font-size:13px;color:#6b6575;width:38%;vertical-align:top;">
          ${escapeHtml(row.label)}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee8f6;font-size:14px;color:#1f1630;vertical-align:top;">
          ${escapeHtml(row.value)}
        </td>
      </tr>`,
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;border-collapse:collapse;">
      ${items}
    </table>`;
}
