import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const RESERVE_SQL = resolve(
  ROOT,
  "supabase/migrations/20260903180200_wati_reserve_outbound_and_snapshot.sql",
);

describe("WATI reserve-and-snapshot SQL", () => {
  it("is SECURITY DEFINER, service_role-only, and never embeds secrets", () => {
    const sql = readFileSync(RESERVE_SQL, "utf8");
    expect(sql).toContain("reserve_wati_outbound_and_snapshot");
    expect(sql).toContain("sanitize_wati_outbound_raw_payload");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("channel = 'whatsapp'");
    expect(sql).toContain("provider IS DISTINCT FROM 'wati'");
    expect(sql).toContain("missing_idempotency_key");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.reserve_wati_outbound_and_snapshot");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.reserve_wati_outbound_and_snapshot");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION");
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN\s+others/i);
    expect(sql).not.toContain("IGQW");
    expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9_\-]{12,}/);
    expect(sql.toLowerCase()).not.toContain("access_token=");
    expect(sql).not.toContain("NEXT_PUBLIC_");
  });
});
