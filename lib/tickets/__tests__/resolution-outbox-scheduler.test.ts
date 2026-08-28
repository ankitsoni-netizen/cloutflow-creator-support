import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

describe("ticket resolution outbox scheduler SQL", () => {
  it("references Vault secret names and never embeds a drain secret", () => {
    const sql = readFileSync(
      resolve(
        ROOT,
        "supabase/migrations/20260827150000_ticket_resolution_outbox_pg_cron_drain.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("ticket_resolution_outbox_drain_url");
    expect(sql).toContain("ticket_resolution_outbox_drain_secret");
    expect(sql).toContain("vault.decrypted_secrets");
    expect(sql).toContain("ticket-resolution-outbox-drain");
    expect(sql).toContain("cron.schedule");
    expect(sql).toContain("cron.unschedule");
    expect(sql).toContain("* * * * *");
    expect(sql).toContain("nullif(btrim(secrets.drain_url), '') IS NOT NULL");
    expect(sql).toContain("nullif(btrim(secrets.drain_secret), '') IS NOT NULL");
    expect(sql).toContain("timeout_milliseconds := 45000");
    expect(sql).toContain("YOUR_VERCEL_HOST");
    expect(sql).toContain("YOUR_TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET");
    expect(sql).toContain("/api/internal/tickets/resolution-outbox/drain");
    expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9_\-]{12,}/);
    expect(sql).not.toContain("NEXT_PUBLIC_");
    expect(sql.toLowerCase()).not.toContain("access_token=");
  });

  it("keeps the resolve RPC schema-qualified, leased, and off the public Data API", () => {
    const sql = readFileSync(
      resolve(
        ROOT,
        "supabase/migrations/20260827140000_ticket_resolution_outbox.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.resolve_creator_support_ticket");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("REVOKE ALL ON TABLE public.ticket_resolution_jobs FROM PUBLIC");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.ticket_resolution_jobs FROM authenticated",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer) FROM authenticated",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer) TO service_role",
    );
    expect(sql).toContain("v_now + interval '60 seconds'");
    expect(sql).toContain("ticket_events_one_resolved_status_idx");
  });
});
