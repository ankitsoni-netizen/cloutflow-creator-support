import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

describe("instagram outbox scheduler SQL", () => {
  it("references Vault secret names and never embeds a drain secret", () => {
    const sql = readFileSync(
      resolve(ROOT, "supabase/migrations/20260826130000_instagram_outbox_pg_cron_drain.sql"),
      "utf8",
    );
    expect(sql).toContain("instagram_outbox_drain_url");
    expect(sql).toContain("instagram_outbox_drain_secret");
    expect(sql).toContain("vault.decrypted_secrets");
    expect(sql).toContain("instagram-outbox-drain");
    expect(sql).toContain("cron.schedule");
    expect(sql).toContain("cron.unschedule");
    expect(sql).toContain("* * * * *");
    expect(sql).toContain("nullif(btrim(secrets.drain_url), '') IS NOT NULL");
    expect(sql).toContain("nullif(btrim(secrets.drain_secret), '') IS NOT NULL");
    expect(sql).toContain("timeout_milliseconds := 45000");
    expect(sql).toContain("YOUR_VERCEL_HOST");
    expect(sql).toContain("YOUR_INSTAGRAM_OUTBOX_DRAIN_SECRET");
    expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9_\-]{12,}/);
    expect(sql).not.toContain("IGQW");
    expect(sql).not.toContain("NEXT_PUBLIC_");
    expect(sql.toLowerCase()).not.toContain("access_token=");
  });

  it("persists sanitized raw_payload in the reserve migration", () => {
    const sql = readFileSync(
      resolve(
        ROOT,
        "supabase/migrations/20260826120000_instagram_outbox_and_active_ticket_unique.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS raw_payload jsonb");
    expect(sql).toContain("sanitize_instagram_outbound_raw_payload");
    expect(sql).toContain("p_now + interval '60 seconds'");
    expect(sql).toContain("RETURNING delivery_attempt_count INTO claimed_attempts");
    expect(sql).toContain("duplicate_active_instagram_tickets");
    expect(sql).toContain("delivery_attempt_count_nulls_remain");
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN\s+others/i);
    expect(sql).not.toMatch(/FOR UPDATE/i);
    expect(sql).toContain("next_attempt_at NULLS FIRST, created_at");
    expect(sql).toContain("existing_sender_address IS DISTINCT FROM outbound_sender");
    expect(sql).toContain("AND sender_address IS NOT DISTINCT FROM outbound_sender");
    expect(sql).toContain("AND conversation_id IS NOT DISTINCT FROM p_conversation_id");
    expect(sql).toContain("AND raw_payload IS NULL");
    expect(sql).not.toContain("IGQW");
    expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9_\-]{12,}/);
  });
});
