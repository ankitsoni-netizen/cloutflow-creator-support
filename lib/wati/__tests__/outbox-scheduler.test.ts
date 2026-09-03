import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

describe("WATI outbox scheduler SQL", () => {
  it("references Vault secret names and never embeds a drain secret", () => {
    const sql = readFileSync(
      resolve(ROOT, "supabase/migrations/20260903180300_wati_outbox_pg_cron_drain.sql"),
      "utf8",
    );
    expect(sql).toContain("wati_outbox_drain_url");
    expect(sql).toContain("wati_outbox_drain_secret");
    expect(sql).toContain("vault.decrypted_secrets");
    expect(sql).toContain("wati-outbox-drain");
    expect(sql).toContain("cron.schedule");
    expect(sql).toContain("cron.unschedule");
    expect(sql).toContain("* * * * *");
    expect(sql).toContain("nullif(btrim(secrets.drain_url), '') IS NOT NULL");
    expect(sql).toContain("nullif(btrim(secrets.drain_secret), '') IS NOT NULL");
    expect(sql).toContain("timeout_milliseconds := 45000");
    expect(sql).toContain("YOUR_VERCEL_HOST");
    expect(sql).toContain("YOUR_WATI_OUTBOX_DRAIN_SECRET");
    expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9_\-]{12,}/);
    expect(sql).not.toContain("NEXT_PUBLIC_");
    expect(sql.toLowerCase()).not.toContain("access_token=");
  });

  it("claims with a durable 60s lease and service_role-only execute", () => {
    const sql = readFileSync(
      resolve(ROOT, "supabase/migrations/20260903180000_wati_outbox_claim.sql"),
      "utf8",
    );
    expect(sql).toContain("claim_wati_outbound_send");
    expect(sql).toContain("p_now + interval '60 seconds'");
    expect(sql).toContain("RETURNING delivery_attempt_count INTO claimed_attempts");
    expect(sql).toContain("channel = 'whatsapp'");
    expect(sql).toContain("purpose IS DISTINCT FROM 'staff_reply'");
    expect(sql).toContain("channel_messages_wati_outbox_due_idx");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.claim_wati_outbound_send");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.claim_wati_outbound_send");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN\s+others/i);
    expect(sql).not.toMatch(/FOR UPDATE/i);
  });
});
