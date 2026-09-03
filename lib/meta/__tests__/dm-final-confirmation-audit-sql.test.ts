import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

export const DM_FINAL_CONFIRMATION_AUDIT_SQL_PATH = resolve(
  __dirname,
  "../../../supabase/incident/20260903_dm_final_confirmation_recovery_audit.sql",
);

export function readDmFinalConfirmationAuditSql(): string {
  return readFileSync(DM_FINAL_CONFIRMATION_AUDIT_SQL_PATH, "utf8");
}

describe("DM final-confirmation recovery audit SQL", () => {
  it("is SELECT-only and does not project PII columns", () => {
    const sql = readDmFinalConfirmationAuditSql();
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments).toMatch(/SELECT/i);
    expect(withoutComments).not.toMatch(
      /\b(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|CREATE|DROP|DO)\b/i,
    );
    expect(withoutComments).not.toMatch(
      /\b(creator_email|message_body|raw_payload|payload|access_token|phone|wa_id)\b/i,
    );
    expect(withoutComments).toContain("whatsapp-ticket-confirmation");
    expect(withoutComments).toContain("awaiting_post_completion");
    expect(withoutComments).toContain("identity_status");
  });
});
