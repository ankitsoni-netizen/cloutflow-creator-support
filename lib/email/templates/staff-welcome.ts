import { escapeHtml } from "@/lib/email/html";

export interface StaffWelcomeEmailContent {
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
  logoUrl: string;
}

export function buildStaffWelcomeEmail(
  input: StaffWelcomeEmailContent,
): { subject: string; html: string; text: string } {
  const fullName = input.fullName.trim() || "there";
  const email = input.email.trim();
  const password = input.password;
  const loginUrl = input.loginUrl.trim();
  const logoUrl = input.logoUrl.trim();

  const subject = "Welcome to Cloutflow CRM";

  const bodyHtml = `
    <p style="margin:0 0 12px;">
      Hi ${escapeHtml(fullName)},
    </p>
    <p style="margin:0 0 12px;">
      Welcome to Cloutflow CRM. Your Creator Support account is ready.
      Use the credentials below to sign in.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee8f6;font-size:13px;color:#6b6575;width:38%;vertical-align:top;">
          Email
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee8f6;font-size:14px;color:#1f1630;vertical-align:top;">
          ${escapeHtml(email)}
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee8f6;font-size:13px;color:#6b6575;width:38%;vertical-align:top;">
          Password
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee8f6;font-size:14px;color:#1f1630;vertical-align:top;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">
          ${escapeHtml(password)}
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;">
      <a href="${escapeHtml(loginUrl)}" style="color:#6b4eff;font-weight:600;text-decoration:none;">
        Sign in to Cloutflow CRM
      </a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b6575;">
      For security, change your password after your first login if your team requires it.
    </p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f0fb;font-family:Arial,Helvetica,sans-serif;color:#1f1630;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Welcome to Cloutflow CRM — your login details are inside.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e0f2;border-radius:12px;">
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <img
                  src="${escapeHtml(logoUrl)}"
                  alt="Cloutflow"
                  width="140"
                  style="display:block;max-width:140px;height:auto;margin:0 0 16px 0;border:0;"
                />
                <h1 style="margin:0;font-size:22px;line-height:1.35;color:#1f1630;">
                  Welcome to Cloutflow CRM
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px 28px;font-size:15px;line-height:1.6;color:#1f1630;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b6575;max-width:560px;">
            This message was sent by Cloutflow Creator Support.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    "Welcome to Cloutflow CRM. Your Creator Support account is ready.",
    "Use the credentials below to sign in.",
    "",
    `Email: ${email}`,
    `Password: ${password}`,
    "",
    `Sign in: ${loginUrl}`,
    "",
    "For security, change your password after your first login if your team requires it.",
  ].join("\n");

  return { subject, html, text };
}
