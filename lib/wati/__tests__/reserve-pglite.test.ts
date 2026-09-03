import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  extractSqlFunction,
  PGLITE_OUTBOX_SCHEMA,
} from "@/lib/meta/__tests__/instagram-outbox-sql";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RESERVE_SQL = resolve(
  __dirname,
  "../../../supabase/migrations/20260903180200_wati_reserve_outbound_and_snapshot.sql",
);

const CONVERSATION = "11111111-1111-1111-1111-111111111111";
const WA_ID = "16315551181";
const CHANNEL = "919999999999";
const PERSONA_PAYLOAD = {
  text: "Who are you messaging as?",
  quick_replies: [
    { content_type: "text", title: "I'm a creator", payload: "PERSONA_CREATOR" },
    { content_type: "text", title: "I'm a brand", payload: "PERSONA_BRAND" },
    { content_type: "text", title: "I'm an agency", payload: "PERSONA_AGENCY" },
    { content_type: "text", title: "Something else", payload: "PERSONA_OTHER" },
  ],
};

function readReserveSql(): string {
  return readFileSync(RESERVE_SQL, "utf8");
}

async function createReserveDatabase() {
  const db = new PGlite();
  await db.exec(PGLITE_OUTBOX_SCHEMA);
  await db.exec(`
    ALTER TABLE public.channel_conversations ADD COLUMN IF NOT EXISTS channel text;
    ALTER TABLE public.channel_conversations ADD COLUMN IF NOT EXISTS provider text;
  `);
  const sql = readReserveSql();
  await db.exec(extractSqlFunction(sql, "sanitize_wati_outbound_raw_payload"));
  await db.exec(extractSqlFunction(sql, "reserve_wati_outbound_and_snapshot"));
  return db;
}

async function seedConversation(
  db: PGlite,
  overrides: { lastProcessed?: string | null; ticketId?: string | null } = {},
) {
  await db.query(
    `INSERT INTO public.channel_conversations (
       id, channel, provider, last_processed_external_message_id, ticket_id, state
     ) VALUES ($1, 'whatsapp', 'wati', $2, $3, 'awaiting_persona')`,
    [CONVERSATION, overrides.lastProcessed ?? null, overrides.ticketId ?? null],
  );
}

function reserveArgs(overrides: Record<string, unknown> = {}) {
  return {
    state: "awaiting_creator_reason",
    lastProcessed: "wamid.next",
    expected: null as string | null,
    ticketId: null as string | null,
    outbounds: [
      {
        channel: "whatsapp",
        sender_address: CHANNEL,
        recipient_external_id: WA_ID,
        message_body: PERSONA_PAYLOAD.text,
        idempotency_key: "wa:convo:v0:awaiting_persona",
        purpose: "awaiting_persona",
        routing_kind: "support",
        ticket_id: null,
        raw_payload: PERSONA_PAYLOAD,
      },
    ],
    ...overrides,
  };
}

async function reserve(db: PGlite, args = reserveArgs()) {
  return db.query<{ reserve_wati_outbound_and_snapshot: Record<string, unknown> }>(
    `SELECT public.reserve_wati_outbound_and_snapshot(
       $1::uuid, $2, NULL, NULL, 'awaiting_persona',
       '2026-09-03T10:00:00Z'::timestamptz, $3, $4, '{}'::jsonb,
       $5::uuid, 0, '2026-09-03T10:00:00Z'::timestamptz, NULL,
       $6::jsonb
     )`,
    [
      CONVERSATION,
      args.state,
      args.lastProcessed,
      args.expected,
      args.ticketId,
      JSON.stringify(args.outbounds),
    ],
  );
}

describe("reserve_wati_outbound_and_snapshot (PGlite)", () => {
  it("commits snapshot and outbound together", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    const result = await reserve(db);
    expect(result.rows[0]?.reserve_wati_outbound_and_snapshot.outcome).toBe("reserved");
    const convo = await db.query<{
      state: string;
      last_processed_external_message_id: string;
    }>(
      `SELECT state, last_processed_external_message_id FROM public.channel_conversations WHERE id = $1`,
      [CONVERSATION],
    );
    expect(convo.rows[0]?.state).toBe("awaiting_creator_reason");
    expect(convo.rows[0]?.last_processed_external_message_id).toBe("wamid.next");
    const messages = await db.query<{ delivery_status: string; raw_payload: unknown }>(
      `SELECT delivery_status, raw_payload FROM public.channel_messages WHERE conversation_id = $1`,
      [CONVERSATION],
    );
    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0]?.delivery_status).toBe("pending");
    expect(messages.rows[0]?.raw_payload).toEqual(PERSONA_PAYLOAD);
    await db.close();
  });

  it("rolls back snapshot when outbound insert fails", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    await db.exec(`
      CREATE FUNCTION public.reject_wati_outbound() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'forced_outbound_insert_failure';
      END;
      $fn$;
      CREATE TRIGGER reject_wati_outbound
        BEFORE INSERT ON public.channel_messages
        FOR EACH ROW EXECUTE FUNCTION public.reject_wati_outbound();
    `);
    await expect(reserve(db)).rejects.toThrow(/forced_outbound_insert_failure/);
    const convo = await db.query<{
      state: string;
      last_processed_external_message_id: string | null;
      ticket_id: string | null;
    }>(
      `SELECT state, last_processed_external_message_id, ticket_id
       FROM public.channel_conversations WHERE id = $1`,
      [CONVERSATION],
    );
    expect(convo.rows[0]?.state).toBe("awaiting_persona");
    expect(convo.rows[0]?.last_processed_external_message_id).toBeNull();
    expect(convo.rows[0]?.ticket_id).toBeNull();
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.channel_messages`,
    );
    expect(count.rows[0]?.n).toBe(0);
    await db.close();
  });

  it("inserts no outbound on OCC conflict", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db, { lastProcessed: "wamid.old" });
    await expect(reserve(db, reserveArgs({ expected: null }))).rejects.toThrow(
      /conversation_state_conflict/,
    );
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.channel_messages`,
    );
    expect(count.rows[0]?.n).toBe(0);
    const convo = await db.query<{ last_processed_external_message_id: string }>(
      `SELECT last_processed_external_message_id FROM public.channel_conversations WHERE id = $1`,
      [CONVERSATION],
    );
    expect(convo.rows[0]?.last_processed_external_message_id).toBe("wamid.old");
    await db.close();
  });

  it("leaves a drainable pending outbound after a successful RPC", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    await reserve(db);
    const due = await db.query<{ id: string }>(
      `SELECT id FROM public.channel_messages
       WHERE channel = 'whatsapp' AND direction = 'outbound'
         AND delivery_status IN ('pending', 'failed')
         AND purpose IS DISTINCT FROM 'staff_reply'
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
    );
    expect(due.rows).toHaveLength(1);
    await db.close();
  });

  it("returns the existing reservation for a duplicate same event", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    const first = await reserve(db);
    expect(first.rows[0]?.reserve_wati_outbound_and_snapshot.outcome).toBe("reserved");
    const second = await reserve(
      db,
      reserveArgs({ expected: "wamid.next", lastProcessed: "wamid.next" }),
    );
    expect(second.rows[0]?.reserve_wati_outbound_and_snapshot.outcome).toBe("existing");
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.channel_messages`,
    );
    expect(count.rows[0]?.n).toBe(1);
    await db.close();
  });

  it("concurrent same event produces one outbound", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    const results = await Promise.allSettled([reserve(db), reserve(db)]);
    const accepted = results.filter((row) => row.status === "fulfilled");
    const rejected = results.filter((row) => row.status === "rejected");
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.channel_messages`,
    );
    expect(count.rows[0]?.n).toBe(1);
    await db.close();
  });

  it("concurrent different events cannot duplicate the same logical prompt", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    await reserve(db);
    await expect(
      reserve(
        db,
        reserveArgs({
          expected: "wamid.next",
          lastProcessed: "wamid.other",
          outbounds: [
            {
              ...reserveArgs().outbounds[0],
              message_body: "Changed body",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/outbound_idempotency_conflict/);
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.channel_messages`,
    );
    expect(count.rows[0]?.n).toBe(1);
    const convo = await db.query<{ last_processed_external_message_id: string }>(
      `SELECT last_processed_external_message_id FROM public.channel_conversations WHERE id = $1`,
      [CONVERSATION],
    );
    expect(convo.rows[0]?.last_processed_external_message_id).toBe("wamid.next");
    await db.close();
  });

  it("reconstructs text, buttons, and lists without secrets", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db);
    const leaked = {
      text: "Pick one",
      access_token: "secret-token",
      Authorization: "Bearer abc",
      endpoint: "https://live-mt-server.wati.io/send",
      quick_replies: [
        { content_type: "text", title: "Yes", payload: "CAMPAIGN_MONTH_YES" },
        { content_type: "text", title: "No", payload: "CAMPAIGN_MONTH_NO" },
      ],
    };
    await reserve(
      db,
      reserveArgs({
        outbounds: [
          {
            channel: "whatsapp",
            sender_address: CHANNEL,
            recipient_external_id: WA_ID,
            message_body: "Pick one",
            idempotency_key: "wa:convo:v0:month",
            purpose: "prompt",
            routing_kind: "support",
            ticket_id: null,
            raw_payload: leaked,
          },
        ],
      }),
    );
    const stored = await db.query<{ raw_payload: unknown; message_body: string }>(
      `SELECT raw_payload, message_body FROM public.channel_messages`,
    );
    expect(stored.rows[0]?.message_body).toBe("Pick one");
    expect(stored.rows[0]?.raw_payload).toEqual({
      text: "Pick one",
      quick_replies: leaked.quick_replies,
    });
    expect(JSON.stringify(stored.rows[0]?.raw_payload)).not.toContain("secret-token");
    expect(JSON.stringify(stored.rows[0]?.raw_payload)).not.toContain("Authorization");
    expect(JSON.stringify(stored.rows[0]?.raw_payload)).not.toContain("wati.io");
    const returned = JSON.stringify(
      (
        await db.query(
          `SELECT public.reserve_wati_outbound_and_snapshot(
             $1::uuid, 'awaiting_creator_reason', NULL, NULL, 'awaiting_persona',
             '2026-09-03T10:00:01Z'::timestamptz, 'wamid.next', 'wamid.next', '{}'::jsonb,
             NULL, 0, '2026-09-03T10:00:01Z'::timestamptz, NULL, '[]'::jsonb
           )`,
          [CONVERSATION],
        )
      ).rows[0],
    );
    expect(returned).not.toContain(WA_ID);
    expect(returned.toLowerCase()).not.toContain("bearer");
    await db.close();
  });

  it("keeps ticket link, post-completion state, and closing reservation consistent", async () => {
    const db = await createReserveDatabase();
    const ticketId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await db.query(`INSERT INTO public.tickets (id, source_channel, status) VALUES ($1, 'whatsapp', 'open')`, [
      ticketId,
    ]);
    await seedConversation(db);
    await reserve(
      db,
      reserveArgs({
        state: "awaiting_post_completion",
        ticketId,
        outbounds: [
          {
            channel: "whatsapp",
            sender_address: CHANNEL,
            recipient_external_id: WA_ID,
            message_body: "Ticket ID: CF-TEST",
            idempotency_key: `wa:convo:v0:ticket_created:${ticketId}`,
            purpose: "ticket_created",
            routing_kind: "support",
            ticket_id: ticketId,
            raw_payload: {
              text: "Ticket ID: CF-TEST",
              quick_replies: [
                { content_type: "text", title: "Main menu", payload: "POST_MAIN_MENU" },
                { content_type: "text", title: "I'm done", payload: "POST_DONE" },
              ],
            },
          },
        ],
      }),
    );
    const convo = await db.query<{ state: string; ticket_id: string }>(
      `SELECT state, ticket_id FROM public.channel_conversations WHERE id = $1`,
      [CONVERSATION],
    );
    expect(convo.rows[0]?.state).toBe("awaiting_post_completion");
    expect(convo.rows[0]?.ticket_id).toBe(ticketId);
    const outbound = await db.query<{ ticket_id: string; delivery_status: string }>(
      `SELECT ticket_id, delivery_status FROM public.channel_messages`,
    );
    expect(outbound.rows[0]?.ticket_id).toBe(ticketId);
    expect(outbound.rows[0]?.delivery_status).toBe("pending");
    await db.close();
  });

  it("does not reclaim sent/delivered/read closing rows", async () => {
    const db = await createReserveDatabase();
    await seedConversation(db, { lastProcessed: "wamid.old" });
    await db.query(
      `INSERT INTO public.channel_messages (
         conversation_id, channel, direction, purpose, delivery_status,
         message_body, idempotency_key, recipient_external_id, routing_kind
       ) VALUES (
         $1, 'whatsapp', 'outbound', 'ticket_created', 'delivered',
         'Ticket ID: CF-TEST', 'wa:convo:v0:ticket_created', $2, NULL
       )`,
      [CONVERSATION, WA_ID],
    );
    const result = await reserve(
      db,
      reserveArgs({
        expected: "wamid.old",
        lastProcessed: "wamid.next",
        state: "awaiting_post_completion",
        outbounds: [
          {
            channel: "whatsapp",
            sender_address: CHANNEL,
            recipient_external_id: WA_ID,
            message_body: "Ticket ID: CF-TEST",
            idempotency_key: "wa:convo:v0:ticket_created",
            purpose: "ticket_created",
            routing_kind: "support",
            ticket_id: null,
            raw_payload: null,
          },
        ],
      }),
    );
    const payload = result.rows[0]?.reserve_wati_outbound_and_snapshot;
    expect(payload?.outcome).toBe("existing");
    const rows = payload?.outbounds as Array<{ claimed: boolean; delivery_status: string }>;
    expect(rows[0]?.claimed).toBe(false);
    expect(rows[0]?.delivery_status).toBe("delivered");
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.channel_messages`,
    );
    expect(count.rows[0]?.n).toBe(1);
    await db.close();
  });

  it("reruns the function definition safely", async () => {
    const db = await createReserveDatabase();
    const sql = readReserveSql();
    await db.exec(extractSqlFunction(sql, "sanitize_wati_outbound_raw_payload"));
    await db.exec(extractSqlFunction(sql, "reserve_wati_outbound_and_snapshot"));
    await seedConversation(db);
    const result = await reserve(db);
    expect(result.rows[0]?.reserve_wati_outbound_and_snapshot.outcome).toBe("reserved");
    await db.close();
  });
});
