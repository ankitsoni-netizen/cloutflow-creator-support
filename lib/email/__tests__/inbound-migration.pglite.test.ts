import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  INBOUND_EMAIL_ROLLBACK_SQL,
  PGLITE_PRODUCTION_SHAPED_TICKET_SCHEMA,
  readInboundEmailMigrationSql,
} from "@/lib/email/__tests__/inbound-sql";

const TICKET = "00000000-0000-0000-0000-0000000000aa";

describe("inbound email migration against a Production-shaped schema", {
  timeout: 20_000,
}, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(PGLITE_PRODUCTION_SHAPED_TICKET_SCHEMA);
    await db.query(
      `INSERT INTO public.tickets (
         id, ticket_code, creator_email, source_channel, status,
         external_contact_id, identity_status
       ) VALUES ($1, 'CF-2026-00001', 'riya@example.com', 'instagram', 'open',
         '12334', 'unambiguous')`,
      [TICKET],
    );
  }, 20_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies once, reruns safely, and rolls back without touching unrelated ticket objects", async () => {
    const sql = readInboundEmailMigrationSql();
    await db.exec(sql);
    await db.exec(sql);

    const tables = await db.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relname IN (
         'ticket_email_reply_aliases',
         'inbound_email_events',
         'inbound_email_attachments',
         'tickets'
       )
       ORDER BY relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "inbound_email_attachments",
      "inbound_email_events",
      "ticket_email_reply_aliases",
      "tickets",
    ]);

    const unrelated = await db.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'public.tickets'::regclass
         AND NOT tgisinternal
       ORDER BY tgname`,
    );
    expect(unrelated.rows.map((row) => row.tgname)).toEqual([
      "tickets_ensure_email_reply_alias_trg",
      "tickets_set_updated_at_trg",
    ]);

    const identity = await db.query<{
      source_channel: string;
      external_contact_id: string | null;
      identity_status: string | null;
    }>(
      `SELECT source_channel, external_contact_id, identity_status
       FROM public.tickets WHERE id = $1`,
      [TICKET],
    );
    expect(identity.rows[0]).toMatchObject({
      source_channel: "instagram",
      external_contact_id: "12334",
      identity_status: "unambiguous",
    });

    const grants = await db.query<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc AS p
       JOIN pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'ensure_ticket_email_reply_alias',
           'ingest_brevo_inbound_email'
         )
       ORDER BY p.proname`,
    );
    expect(grants.rows.map((row) => row.proname)).toEqual([
      "ensure_ticket_email_reply_alias",
      "ingest_brevo_inbound_email",
    ]);

    await db.exec(INBOUND_EMAIL_ROLLBACK_SQL);

    const remaining = await db.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relname IN (
         'ticket_email_reply_aliases',
         'inbound_email_events',
         'inbound_email_attachments'
       )`,
    );
    expect(remaining.rows).toEqual([]);

    const afterRollback = await db.query<{
      source_channel: string;
      tgname: string;
    }>(
      `SELECT t.source_channel, tr.tgname
       FROM public.tickets AS t
       JOIN pg_trigger AS tr
         ON tr.tgrelid = 'public.tickets'::regclass
        AND NOT tr.tgisinternal
       WHERE t.id = $1`,
      [TICKET],
    );
    expect(afterRollback.rows).toEqual([
      { source_channel: "instagram", tgname: "tickets_set_updated_at_trg" },
    ]);
  });
});
