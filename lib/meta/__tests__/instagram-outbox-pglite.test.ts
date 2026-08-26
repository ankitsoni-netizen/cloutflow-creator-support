import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  extractSqlFunction,
  PGLITE_OUTBOX_SCHEMA,
  readInstagramOutboxMigrationSql,
} from "@/lib/meta/__tests__/instagram-outbox-sql";

const ACCOUNT = "17841400008460000";
const CREATOR = "12334";
const PERSONA_PAYLOAD = {
  text: "How can I help?",
  quick_replies: [
    { content_type: "text", title: "I'm a creator", payload: "PERSONA_CREATOR" },
    { content_type: "text", title: "I'm a brand", payload: "PERSONA_BRAND" },
  ],
};

async function createOutboxDatabase() {
  const db = new PGlite();
  const migration = readInstagramOutboxMigrationSql();
  await db.exec(PGLITE_OUTBOX_SCHEMA);
  await db.exec(extractSqlFunction(migration, "sanitize_instagram_outbound_raw_payload"));
  await db.exec(extractSqlFunction(migration, "claim_instagram_outbound_send"));
  await db.exec(extractSqlFunction(migration, "reserve_instagram_outbound_and_snapshot"));
  return db;
}

describe("claim_instagram_outbound_send delivery lease (PGlite)", () => {
  it("skips a second worker after the first claim transaction commits", async () => {
    const db = await createOutboxDatabase();
    await db.query(
      `INSERT INTO public.channel_conversations (id) VALUES ('11111111-1111-1111-1111-111111111111')`,
    );
    await db.query(
      `INSERT INTO public.channel_messages (
         id, conversation_id, channel, direction, purpose, delivery_status,
         delivery_attempt_count, message_body, recipient_external_id
       ) VALUES (
         '22222222-2222-2222-2222-222222222222',
         '11111111-1111-1111-1111-111111111111',
         'instagram', 'outbound', 'awaiting_persona', 'pending',
         0, 'How can I help?', $1
       )`,
      [CREATOR],
    );

    const now = "2026-08-26T10:00:00.000Z";
    const workerA = await db.query<{ claim_instagram_outbound_send: Record<string, unknown> }>(
      `SELECT public.claim_instagram_outbound_send(
         '22222222-2222-2222-2222-222222222222'::uuid,
         $1::timestamptz,
         5
       )`,
      [now],
    );
    expect(workerA.rows[0]?.claim_instagram_outbound_send).toMatchObject({
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
       WHERE id = '22222222-2222-2222-2222-222222222222'`,
    );
    expect(leased.rows[0]?.delivery_status).toBe("pending");
    expect(leased.rows[0]?.delivery_attempt_count).toBe(1);
    expect(Date.parse(String(leased.rows[0]?.next_attempt_at))).toBe(
      Date.parse(now) + 60_000,
    );

    const workerB = await db.query<{ claim_instagram_outbound_send: Record<string, unknown> }>(
      `SELECT public.claim_instagram_outbound_send(
         '22222222-2222-2222-2222-222222222222'::uuid,
         $1::timestamptz,
         5
       )`,
      [now],
    );
    expect(workerB.rows[0]?.claim_instagram_outbound_send).toMatchObject({
      outcome: "skipped",
    });

    const sameLease = await Promise.all([
      db.query<{ claim_instagram_outbound_send: Record<string, unknown> }>(
        `SELECT public.claim_instagram_outbound_send(
           '22222222-2222-2222-2222-222222222222'::uuid,
           $1::timestamptz,
           5
         )`,
        [now],
      ),
      db.query<{ claim_instagram_outbound_send: Record<string, unknown> }>(
        `SELECT public.claim_instagram_outbound_send(
           '22222222-2222-2222-2222-222222222222'::uuid,
           $1::timestamptz,
           5
         )`,
        [now],
      ),
    ]);
    expect(
      sameLease.map((result) => result.rows[0]?.claim_instagram_outbound_send.outcome),
    ).toEqual(["skipped", "skipped"]);

    const afterExpiry = await db.query<{
      claim_instagram_outbound_send: Record<string, unknown>;
    }>(
      `SELECT public.claim_instagram_outbound_send(
         '22222222-2222-2222-2222-222222222222'::uuid,
         $1::timestamptz,
         5
       )`,
      ["2026-08-26T10:01:00.000Z"],
    );
    expect(afterExpiry.rows[0]?.claim_instagram_outbound_send).toMatchObject({
      outcome: "claimed",
      attempt_count: 2,
    });
    await db.close();
  });

  it("does not reclaim exhausted or terminal rows after lease expiry", async () => {
    const db = await createOutboxDatabase();
    await db.query(
      `INSERT INTO public.channel_conversations (id) VALUES ('11111111-1111-1111-1111-111111111111')`,
    );
    await db.query(
      `INSERT INTO public.channel_messages (
         id, conversation_id, channel, direction, purpose, delivery_status,
         delivery_attempt_count, delivery_error_code, message_body
       ) VALUES (
         '33333333-3333-3333-3333-333333333333',
         '11111111-1111-1111-1111-111111111111',
         'instagram', 'outbound', 'awaiting_persona', 'failed',
         5, 'outbound_attempts_exhausted', 'How can I help?'
       )`,
    );
    const claimed = await db.query<{ claim_instagram_outbound_send: Record<string, unknown> }>(
      `SELECT public.claim_instagram_outbound_send(
         '33333333-3333-3333-3333-333333333333'::uuid,
         '2026-08-26T10:10:00.000Z'::timestamptz,
         5
       )`,
    );
    expect(claimed.rows[0]?.claim_instagram_outbound_send).toEqual({
      outcome: "skipped",
    });
    await db.close();
  });
});

describe("reserve raw_payload SQL (PGlite)", () => {
  it("stores identical quick replies, rejects mismatches, and backfills a scoped legacy null", async () => {
    const db = await createOutboxDatabase();
    const conversationId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await db.query(
      `INSERT INTO public.channel_conversations (id, last_processed_external_message_id)
       VALUES ($1, NULL)`,
      [conversationId],
    );

    const reserved = await db.query<{
      reserve_instagram_outbound_and_snapshot: { outbounds: Array<{ claimed: boolean }> };
    }>(
      `SELECT public.reserve_instagram_outbound_and_snapshot(
         $1::uuid, 'awaiting_persona', NULL, NULL, 'awaiting_persona',
         '2026-08-26T10:00:00Z'::timestamptz, 'mid.a', NULL, '{}'::jsonb,
         NULL, 0, '2026-08-26T10:00:00Z'::timestamptz, NULL,
         $2::jsonb
       )`,
      [
        conversationId,
        JSON.stringify([
          {
            channel: "instagram",
            sender_address: ACCOUNT,
            recipient_external_id: CREATOR,
            message_body: "How can I help?",
            idempotency_key: "ig:convo:v0:awaiting_persona",
            purpose: "awaiting_persona",
            routing_kind: "support",
            ticket_id: null,
            raw_payload: {
              ...PERSONA_PAYLOAD,
              access_token: "IGQW-secret",
              Authorization: "Bearer abc",
            },
          },
        ]),
      ],
    );
    expect(reserved.rows[0]?.reserve_instagram_outbound_and_snapshot.outbounds[0]?.claimed).toBe(
      true,
    );

    const stored = await db.query<{ raw_payload: unknown }>(
      `SELECT raw_payload FROM public.channel_messages WHERE idempotency_key = 'ig:convo:v0:awaiting_persona'`,
    );
    expect(stored.rows[0]?.raw_payload).toEqual(PERSONA_PAYLOAD);
    expect(JSON.stringify(stored.rows[0]?.raw_payload)).not.toContain("IGQW");
    expect(JSON.stringify(stored.rows[0]?.raw_payload)).not.toContain("Authorization");
    expect(JSON.stringify(stored.rows[0]?.raw_payload)).not.toContain("Bearer");

    const recovered = await db.query<{
      reserve_instagram_outbound_and_snapshot: { outbounds: Array<{ claimed: boolean }> };
    }>(
      `SELECT public.reserve_instagram_outbound_and_snapshot(
         $1::uuid, 'awaiting_persona', NULL, NULL, 'awaiting_persona',
         '2026-08-26T10:00:01Z'::timestamptz, 'mid.a', 'mid.a', '{}'::jsonb,
         NULL, 0, '2026-08-26T10:00:01Z'::timestamptz, NULL,
         $2::jsonb
       )`,
      [
        conversationId,
        JSON.stringify([
          {
            channel: "instagram",
            sender_address: ACCOUNT,
            recipient_external_id: CREATOR,
            message_body: "How can I help?",
            idempotency_key: "ig:convo:v0:awaiting_persona",
            purpose: "awaiting_persona",
            routing_kind: "support",
            raw_payload: PERSONA_PAYLOAD,
          },
        ]),
      ],
    );
    expect(recovered.rows[0]?.reserve_instagram_outbound_and_snapshot.outbounds[0]?.claimed).toBe(
      false,
    );

    await expect(
      db.query(
        `SELECT public.reserve_instagram_outbound_and_snapshot(
           $1::uuid, 'awaiting_persona', NULL, NULL, 'awaiting_persona',
           '2026-08-26T10:00:02Z'::timestamptz, 'mid.a', 'mid.a', '{}'::jsonb,
           NULL, 0, '2026-08-26T10:00:02Z'::timestamptz, NULL,
           $2::jsonb
         )`,
        [
          conversationId,
          JSON.stringify([
            {
              channel: "instagram",
              sender_address: ACCOUNT,
              recipient_external_id: CREATOR,
              message_body: "How can I help?",
              idempotency_key: "ig:convo:v0:awaiting_persona",
              purpose: "awaiting_persona",
              routing_kind: "support",
              raw_payload: {
                text: "How can I help?",
                quick_replies: [
                  { content_type: "text", title: "I'm a brand", payload: "PERSONA_BRAND" },
                ],
              },
            },
          ]),
        ],
      ),
    ).rejects.toThrow(/outbound_idempotency_conflict/);

    await db.query(
      `INSERT INTO public.channel_messages (
         conversation_id, channel, direction, sender_address, recipient_external_id,
         message_body, delivery_status, idempotency_key, purpose, routing_kind, raw_payload
       ) VALUES (
         $1, 'instagram', 'outbound', $2, $3, 'Legacy text', 'pending',
         'ig:legacy:plain', 'awaiting_persona', 'support', NULL
       )`,
      [conversationId, ACCOUNT, CREATOR],
    );
    const backfill = await db.query<{
      reserve_instagram_outbound_and_snapshot: { outbounds: Array<{ claimed: boolean }> };
    }>(
      `SELECT public.reserve_instagram_outbound_and_snapshot(
         $1::uuid, 'awaiting_persona', NULL, NULL, 'awaiting_persona',
         '2026-08-26T10:00:03Z'::timestamptz, 'mid.a', 'mid.a', '{}'::jsonb,
         NULL, 0, '2026-08-26T10:00:03Z'::timestamptz, NULL,
         $2::jsonb
       )`,
      [
        conversationId,
        JSON.stringify([
          {
            channel: "instagram",
            sender_address: ACCOUNT,
            recipient_external_id: CREATOR,
            message_body: "Legacy text",
            idempotency_key: "ig:legacy:plain",
            purpose: "awaiting_persona",
            routing_kind: "support",
            raw_payload: {
              text: "Legacy text",
              quick_replies: PERSONA_PAYLOAD.quick_replies,
            },
          },
        ]),
      ],
    );
    expect(backfill.rows[0]?.reserve_instagram_outbound_and_snapshot.outbounds[0]?.claimed).toBe(
      false,
    );
    const filled = await db.query<{ raw_payload: unknown }>(
      `SELECT raw_payload FROM public.channel_messages WHERE idempotency_key = 'ig:legacy:plain'`,
    );
    expect(filled.rows[0]?.raw_payload).toEqual({
      text: "Legacy text",
      quick_replies: PERSONA_PAYLOAD.quick_replies,
    });
    await db.close();
  });

  it("rejects idempotency reuse when sender_address differs", async () => {
    const db = await createOutboxDatabase();
    const conversationId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await db.query(
      `INSERT INTO public.channel_conversations (id, last_processed_external_message_id)
       VALUES ($1, 'mid.a')`,
      [conversationId],
    );
    await db.query(
      `INSERT INTO public.channel_messages (
         conversation_id, channel, direction, sender_address, recipient_external_id,
         message_body, delivery_status, idempotency_key, purpose, routing_kind, raw_payload
       ) VALUES (
         $1, 'instagram', 'outbound', $2, $3, 'How can I help?', 'pending',
         'ig:sender:mismatch', 'awaiting_persona', 'support', NULL
       )`,
      [conversationId, ACCOUNT, CREATOR],
    );
    await expect(
      db.query(
        `SELECT public.reserve_instagram_outbound_and_snapshot(
           $1::uuid, 'awaiting_persona', NULL, NULL, 'awaiting_persona',
           '2026-08-26T10:00:03Z'::timestamptz, 'mid.a', 'mid.a', '{}'::jsonb,
           NULL, 0, '2026-08-26T10:00:03Z'::timestamptz, NULL,
           $2::jsonb
         )`,
        [
          conversationId,
          JSON.stringify([
            {
              channel: "instagram",
              sender_address: "99999999999999999",
              recipient_external_id: CREATOR,
              message_body: "How can I help?",
              idempotency_key: "ig:sender:mismatch",
              purpose: "awaiting_persona",
              routing_kind: "support",
              raw_payload: PERSONA_PAYLOAD,
            },
          ]),
        ],
      ),
    ).rejects.toThrow(/outbound_idempotency_conflict/);
    await db.close();
  });

  it("drops media URLs and secrets from raw_payload", async () => {
    const db = await createOutboxDatabase();
    const sanitized = await db.query<{ sanitize_instagram_outbound_raw_payload: unknown }>(
      `SELECT public.sanitize_instagram_outbound_raw_payload(
         'Pick one',
         $1::jsonb
       )`,
      [
        JSON.stringify({
          text: "Pick one",
          access_token: "IGQW-secret",
          Authorization: "Bearer abc",
          quick_replies: [
            {
              content_type: "text",
              title: "Open",
              payload: "https://lookaside.fbsbx.com/ig/media",
            },
            { content_type: "text", title: "Creator", payload: "PERSONA_CREATOR" },
          ],
        }),
      ],
    );
    expect(sanitized.rows[0]?.sanitize_instagram_outbound_raw_payload).toEqual({
      text: "Pick one",
      quick_replies: [
        { content_type: "text", title: "Creator", payload: "PERSONA_CREATOR" },
      ],
    });
    const plain = await db.query<{ sanitize_instagram_outbound_raw_payload: unknown }>(
      `SELECT public.sanitize_instagram_outbound_raw_payload('Thanks', NULL)`,
    );
    expect(plain.rows[0]?.sanitize_instagram_outbound_raw_payload).toBeNull();
    await db.close();
  });
});

describe("active Instagram ticket duplicate abort (PGlite)", () => {
  it("raises a sanitized error instead of creating the unique index", async () => {
    const db = new PGlite();
    await db.exec(PGLITE_OUTBOX_SCHEMA);
    await db.exec(`
      INSERT INTO public.tickets (source_channel, external_conversation_id, status)
      VALUES
        ('instagram', 'conv-dup', 'open'),
        ('instagram', 'conv-dup', 'waiting')
    `);
    await expect(
      db.exec(`
        DO $$
        DECLARE
          duplicate_groups integer := 0;
        BEGIN
          SELECT count(*)
          INTO duplicate_groups
          FROM (
            SELECT 1
            FROM public.tickets
            WHERE source_channel = 'instagram'
              AND external_conversation_id IS NOT NULL
              AND status IN ('open', 'in_progress', 'waiting')
            GROUP BY source_channel, external_conversation_id
            HAVING count(*) > 1
          ) duplicates;

          IF duplicate_groups > 0 THEN
            RAISE EXCEPTION 'duplicate_active_instagram_tickets'
              USING HINT = 'Resolve duplicate active Instagram tickets before creating tickets_instagram_one_active_conversation_idx. This migration does not delete, merge, or resolve tickets.';
          END IF;
        END $$;
      `),
    ).rejects.toThrow(/duplicate_active_instagram_tickets/);
    await db.close();
  });
});
