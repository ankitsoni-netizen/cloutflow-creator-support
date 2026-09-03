import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  extractSqlFunction,
  PGLITE_OUTBOX_SCHEMA,
} from "@/lib/meta/__tests__/instagram-outbox-sql";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WATI_CLAIM_MIGRATION = resolve(
  __dirname,
  "../../../supabase/migrations/20260903180000_wati_outbox_claim.sql",
);

function readWatiClaimSql(): string {
  return readFileSync(WATI_CLAIM_MIGRATION, "utf8");
}

const CONVERSATION = "11111111-1111-1111-1111-111111111111";
const MESSAGE = "22222222-2222-2222-2222-222222222222";
const WA_ID = "16315551181";

async function createOutboxDatabase() {
  const db = new PGlite();
  await db.exec(PGLITE_OUTBOX_SCHEMA);
  await db.exec(extractSqlFunction(readWatiClaimSql(), "claim_wati_outbound_send"));
  return db;
}

describe("claim_wati_outbound_send delivery lease (PGlite)", () => {
  it("skips a second worker after the first claim transaction commits", async () => {
    const db = await createOutboxDatabase();
    await db.query(
      `INSERT INTO public.channel_conversations (id) VALUES ($1)`,
      [CONVERSATION],
    );
    await db.query(
      `INSERT INTO public.channel_messages (
         id, conversation_id, channel, direction, purpose, delivery_status,
         delivery_attempt_count, message_body, recipient_external_id
       ) VALUES (
         $1, $2, 'whatsapp', 'outbound', 'awaiting_persona', 'pending',
         0, 'How can I help?', $3
       )`,
      [MESSAGE, CONVERSATION, WA_ID],
    );

    const now = "2026-09-03T10:00:00.000Z";
    const workerA = await db.query<{ claim_wati_outbound_send: Record<string, unknown> }>(
      `SELECT public.claim_wati_outbound_send($1::uuid, $2::timestamptz, 5)`,
      [MESSAGE, now],
    );
    expect(workerA.rows[0]?.claim_wati_outbound_send).toMatchObject({
      outcome: "claimed",
      attempt_count: 1,
    });

    const leased = await db.query<{
      delivery_attempt_count: number;
      next_attempt_at: string;
      delivery_status: string;
    }>(
      `SELECT delivery_attempt_count, next_attempt_at, delivery_status
       FROM public.channel_messages
       WHERE id = $1`,
      [MESSAGE],
    );
    expect(leased.rows[0]?.delivery_status).toBe("pending");
    expect(leased.rows[0]?.delivery_attempt_count).toBe(1);
    expect(Date.parse(String(leased.rows[0]?.next_attempt_at))).toBe(
      Date.parse(now) + 60_000,
    );

    const workerB = await db.query<{ claim_wati_outbound_send: Record<string, unknown> }>(
      `SELECT public.claim_wati_outbound_send($1::uuid, $2::timestamptz, 5)`,
      [MESSAGE, now],
    );
    expect(workerB.rows[0]?.claim_wati_outbound_send).toMatchObject({
      outcome: "skipped",
    });

    const sameLease = await Promise.all([
      db.query<{ claim_wati_outbound_send: Record<string, unknown> }>(
        `SELECT public.claim_wati_outbound_send($1::uuid, $2::timestamptz, 5)`,
        [MESSAGE, now],
      ),
      db.query<{ claim_wati_outbound_send: Record<string, unknown> }>(
        `SELECT public.claim_wati_outbound_send($1::uuid, $2::timestamptz, 5)`,
        [MESSAGE, now],
      ),
    ]);
    expect(
      sameLease.map((result) => result.rows[0]?.claim_wati_outbound_send.outcome),
    ).toEqual(["skipped", "skipped"]);

    const afterExpiry = await db.query<{
      claim_wati_outbound_send: Record<string, unknown>;
    }>(
      `SELECT public.claim_wati_outbound_send($1::uuid, $2::timestamptz, 5)`,
      [MESSAGE, "2026-09-03T10:01:00.000Z"],
    );
    expect(afterExpiry.rows[0]?.claim_wati_outbound_send).toMatchObject({
      outcome: "claimed",
      attempt_count: 2,
    });
    await db.close();
  });

  it("does not reclaim sent, staff, terminal, or exhausted rows", async () => {
    const db = await createOutboxDatabase();
    await db.query(
      `INSERT INTO public.channel_conversations (id) VALUES ($1)`,
      [CONVERSATION],
    );
    await db.query(
      `INSERT INTO public.channel_messages (
         id, conversation_id, channel, direction, purpose, delivery_status,
         delivery_attempt_count, delivery_error_code, message_body
       ) VALUES
         ('33333333-3333-3333-3333-333333333333', $1, 'whatsapp', 'outbound',
          'awaiting_persona', 'sent', 1, NULL, 'Sent already'),
         ('44444444-4444-4444-4444-444444444444', $1, 'whatsapp', 'outbound',
          'staff_reply', 'failed', 0, 'http_5xx', 'Staff'),
         ('55555555-5555-5555-5555-555555555555', $1, 'whatsapp', 'outbound',
          'awaiting_persona', 'failed', 1, 'http_401', 'Auth'),
         ('66666666-6666-6666-6666-666666666666', $1, 'whatsapp', 'outbound',
          'awaiting_persona', 'failed', 5, 'outbound_attempts_exhausted', 'Done')`,
      [CONVERSATION],
    );

    const now = "2026-09-03T10:10:00.000Z";
    for (const id of [
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
      "55555555-5555-5555-5555-555555555555",
      "66666666-6666-6666-6666-666666666666",
    ]) {
      const claimed = await db.query<{ claim_wati_outbound_send: Record<string, unknown> }>(
        `SELECT public.claim_wati_outbound_send($1::uuid, $2::timestamptz, 5)`,
        [id, now],
      );
      expect(claimed.rows[0]?.claim_wati_outbound_send).toEqual({
        outcome: "skipped",
      });
    }
    await db.close();
  });
});
