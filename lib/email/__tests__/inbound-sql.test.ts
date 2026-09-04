import { describe, expect, it } from "vitest";
import {
  inboundEmailSqlFunction,
  readInboundEmailMigrationSql,
} from "@/lib/email/__tests__/inbound-sql";

describe("inbound email SQL migration", () => {
  const sql = readInboundEmailMigrationSql();
  const ingest = inboundEmailSqlFunction("ingest_brevo_inbound_email");
  const ensure = inboundEmailSqlFunction("ensure_ticket_email_reply_alias");

  it("allocates opaque aliases from random bytes, never ticket identity", () => {
    expect(ensure).toContain("encode(gen_random_bytes(16), 'hex')");
    expect(ensure).toContain("'t-' ||");
    expect(ensure).not.toContain("ticket_code");
    expect(ensure).not.toContain("creator_email");
    expect(ensure).not.toContain("external_contact_id");
    expect(sql).toContain("CHECK (local_part ~ '^t-[0-9a-f]{32}$')");
  });

  it("is service_role-only and does not grant anon or authenticated", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.ticket_email_reply_aliases FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.ingest_brevo_inbound_email(text, text, text, text, text, jsonb)",
    );
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ingest_brevo_inbound_email[\s\S]*TO (anon|authenticated)/,
    );
  });

  it("resolves inbound mail only by exact alias local part", () => {
    expect(ingest).toContain("WHERE a.local_part = p_alias_local_part");
    expect(ingest).not.toContain("ticket_code");
    expect(ingest).not.toContain("subject");
    expect(ingest).not.toContain("creator_name");
    expect(ingest).not.toContain("social_handle");
    expect(ingest).not.toContain("creator_phone");
    expect(ingest).not.toContain("campaign_name");
  });

  it("verifies the bound creator email exactly after alias resolution", () => {
    expect(ingest).toContain("lower(btrim(COALESCE(ticket_row.creator_email, '')))");
    expect(ingest).toContain("sender_mismatch");
    expect(ingest).not.toContain("replace(");
    expect(ingest).not.toContain("split_part");
  });

  it("reserves MessageId uniquely via ON CONFLICT and does not swallow unrelated unique violations", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_events_message_id_uidx");
    expect(ingest).toContain("ON CONFLICT (message_id) DO NOTHING");
    expect(ingest).toContain("'outcome', 'duplicate'");
    expect(ingest).not.toContain("WHEN unique_violation");
    expect(ingest).not.toContain("WHEN others");
  });

  it("reopens resolved tickets through status_changed without rewriting identity", () => {
    expect(ingest).toContain("status = 'open'");
    expect(ingest).toContain("'status_changed'");
    expect(ingest).toContain("'Email inbound'");
    expect(ingest).toContain("AND source_channel IS NOT DISTINCT FROM ticket_row.source_channel");
    expect(ingest).toContain(
      "AND external_contact_id IS NOT DISTINCT FROM ticket_row.external_contact_id",
    );
    expect(ingest).toContain(
      "AND external_conversation_id IS NOT DISTINCT FROM ticket_row.external_conversation_id",
    );
    expect(ingest).toContain(
      "AND recipient_account_id IS NOT DISTINCT FROM ticket_row.recipient_account_id",
    );
    expect(ingest).toContain(
      "AND identity_status IS NOT DISTINCT FROM ticket_row.identity_status",
    );
    expect(ingest).not.toContain("INSERT INTO public.tickets");
  });

  it("never stores Brevo download tokens or raw payloads", () => {
    expect(sql.toLowerCase()).not.toContain("downloadtoken");
    expect(sql.toLowerCase()).not.toContain("download_token");
    expect(ingest).not.toContain("raw_payload");
    expect(ingest).toContain("storage_path");
    expect(ingest).toContain("NULL");
  });
});
