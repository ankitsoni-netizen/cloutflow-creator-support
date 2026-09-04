import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  inboundEmailSqlFunction,
  PGLITE_INBOUND_EMAIL_SCHEMA,
} from "@/lib/email/__tests__/inbound-sql";

const TICKET_A = "00000000-0000-0000-0000-0000000000aa";
const TICKET_B = "00000000-0000-0000-0000-0000000000bb";
const ALIAS_A = "t-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ALIAS_B = "t-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type IngestPayload = {
  outcome: string;
  error_code: string | null;
  reopened: boolean;
  comment_id: string | null;
};

async function ingest(
  db: PGlite,
  input: {
    messageId: string;
    alias?: string | null;
    sender?: string | null;
    body?: string;
    ignore?: string | null;
    attachments?: unknown;
  },
) {
  const result = await db.query<{ ingest_brevo_inbound_email: IngestPayload }>(
    `SELECT public.ingest_brevo_inbound_email($1, $2, $3, $4, $5, $6::jsonb)
       AS ingest_brevo_inbound_email`,
    [
      input.messageId,
      input.alias === undefined ? ALIAS_A : input.alias,
      input.sender === undefined ? "riya@example.com" : input.sender,
      input.body ?? "Need an update",
      input.ignore ?? null,
      JSON.stringify(input.attachments ?? []),
    ],
  );
  return result.rows[0]?.ingest_brevo_inbound_email;
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(PGLITE_INBOUND_EMAIL_SCHEMA);
  await db.exec(inboundEmailSqlFunction("ensure_ticket_email_reply_alias"));
  await db.exec(inboundEmailSqlFunction("tickets_ensure_email_reply_alias"));
  await db.exec(inboundEmailSqlFunction("ingest_brevo_inbound_email"));
  await db.exec(`
    DROP TRIGGER IF EXISTS tickets_ensure_email_reply_alias_trg ON public.tickets;
    CREATE TRIGGER tickets_ensure_email_reply_alias_trg
      AFTER INSERT ON public.tickets
      FOR EACH ROW
      EXECUTE FUNCTION public.tickets_ensure_email_reply_alias();
  `);
  await db.query(
    `INSERT INTO public.tickets (
       id, ticket_code, creator_email, creator_name, source_channel, status,
       external_contact_id, external_conversation_id, recipient_account_id, identity_status
     ) VALUES
       ($1, 'CF-2026-00001', 'riya@example.com', 'Riya Sharma', 'website', 'open',
        NULL, NULL, NULL, NULL),
       ($2, 'CF-2026-00002', 'riya@example.com', 'Riya Sharma', 'instagram', 'open',
        '12334', '178414:12334', '178414', 'unambiguous')`,
    [TICKET_A, TICKET_B],
  );
  await db.query(
    `UPDATE public.ticket_email_reply_aliases SET local_part = $2 WHERE ticket_id = $1`,
    [TICKET_A, ALIAS_A],
  );
  await db.query(
    `UPDATE public.ticket_email_reply_aliases SET local_part = $2 WHERE ticket_id = $1`,
    [TICKET_B, ALIAS_B],
  );
  return db;
}

describe("ingest_brevo_inbound_email SQL", { timeout: 20_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createDatabase();
  }, 20_000);

  afterAll(async () => {
    await db.close();
  });

  it("appends a website ticket reply without changing channel identity", async () => {
    const result = await ingest(db, { messageId: "mid-website-1" });
    expect(result?.outcome).toBe("appended");
    const ticket = await db.query<{
      status: string;
      source_channel: string;
      external_contact_id: string | null;
    }>(
      `SELECT status, source_channel, external_contact_id FROM public.tickets WHERE id = $1`,
      [TICKET_A],
    );
    expect(ticket.rows[0]).toMatchObject({
      status: "open",
      source_channel: "website",
      external_contact_id: null,
    });
    const comments = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET_A],
    );
    expect(comments.rows[0]?.count).toBe("1");
  });

  it("maps Instagram-origin mail only through its alias and leaves identity frozen", async () => {
    const result = await ingest(db, {
      messageId: "mid-ig-1",
      alias: ALIAS_B,
    });
    expect(result?.outcome).toBe("appended");
    const ticket = await db.query<{
      source_channel: string;
      external_contact_id: string | null;
      external_conversation_id: string | null;
      recipient_account_id: string | null;
      identity_status: string | null;
      status: string;
    }>(
      `SELECT source_channel, external_contact_id, external_conversation_id,
              recipient_account_id, identity_status, status
       FROM public.tickets WHERE id = $1`,
      [TICKET_B],
    );
    expect(ticket.rows[0]).toMatchObject({
      source_channel: "instagram",
      external_contact_id: "12334",
      external_conversation_id: "178414:12334",
      recipient_account_id: "178414",
      identity_status: "unambiguous",
      status: "open",
    });
  });

  it("cannot attach ticket A's reply to ticket B via the same creator email", async () => {
    const before = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET_B],
    );
    const result = await ingest(db, {
      messageId: "mid-cross-1",
      alias: ALIAS_A,
    });
    expect(result?.outcome).toBe("appended");
    const afterA = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET_A],
    );
    const afterB = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET_B],
    );
    expect(Number(afterA.rows[0]?.count)).toBeGreaterThan(0);
    expect(afterB.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("rejects a guessed ticket-code local part and unknown aliases", async () => {
    const guessed = await ingest(db, {
      messageId: "mid-guess",
      alias: "cf-2026-00001",
    });
    expect(guessed).toMatchObject({ outcome: "rejected", error_code: "alias_invalid" });
    const unknown = await ingest(db, {
      messageId: "mid-unknown",
      alias: "t-cccccccccccccccccccccccccccccccc",
    });
    expect(unknown).toMatchObject({ outcome: "rejected", error_code: "alias_unknown" });
  });

  it("fails closed on sender mismatch", async () => {
    const result = await ingest(db, {
      messageId: "mid-mismatch",
      sender: "forwarder@agency.test",
    });
    expect(result).toMatchObject({ outcome: "rejected", error_code: "sender_mismatch" });
  });

  it("returns duplicate for a repeated MessageId without a second comment", async () => {
    const first = await ingest(db, { messageId: "mid-dup" });
    const commentsBefore = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET_A],
    );
    const second = await ingest(db, { messageId: "mid-dup" });
    const commentsAfter = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET_A],
    );
    expect(first?.outcome).toBe("appended");
    expect(second?.outcome).toBe("duplicate");
    expect(commentsAfter.rows[0]?.count).toBe(commentsBefore.rows[0]?.count);
  });

  it("creates one comment when the same MessageId arrives concurrently", async () => {
    const [left, right] = await Promise.all([
      ingest(db, { messageId: "mid-race" }),
      ingest(db, { messageId: "mid-race" }),
    ]);
    const outcomes = [left?.outcome, right?.outcome].sort();
    expect(outcomes).toEqual(["appended", "duplicate"]);
    const events = await db.query<{ comment_id: string | null }>(
      `SELECT comment_id FROM public.inbound_email_events WHERE message_id = 'mid-race'`,
    );
    expect(events.rows).toHaveLength(1);
    const comments = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.ticket_comments
       WHERE id = $1`,
      [events.rows[0]?.comment_id],
    );
    expect(comments.rows[0]?.count).toBe("1");
  });

  it("reopens a resolved ticket exactly once and does not insert a replacement ticket", async () => {
    const ticketC = "00000000-0000-0000-0000-0000000000cc";
    const aliasC = "t-cccccccccccccccccccccccccccccccc";
    await db.query(
      `INSERT INTO public.tickets (
         id, ticket_code, creator_email, source_channel, status, resolved_at,
         external_contact_id, identity_status
       ) VALUES ($1, 'CF-2026-00003', 'riya@example.com', 'whatsapp', 'resolved', now(),
         '16315551181', 'unambiguous')`,
      [ticketC],
    );
    await db.query(
      `UPDATE public.ticket_email_reply_aliases SET local_part = $2 WHERE ticket_id = $1`,
      [ticketC, aliasC],
    );
    const first = await ingest(db, {
      messageId: "mid-reopen-1",
      alias: aliasC,
    });
    const second = await ingest(db, {
      messageId: "mid-reopen-2",
      alias: aliasC,
    });
    expect(first?.reopened).toBe(true);
    expect(second?.reopened).toBe(false);
    const ticket = await db.query<{
      status: string;
      source_channel: string;
      external_contact_id: string | null;
    }>(
      `SELECT status, source_channel, external_contact_id FROM public.tickets WHERE id = $1`,
      [ticketC],
    );
    expect(ticket.rows[0]).toMatchObject({
      status: "open",
      source_channel: "whatsapp",
      external_contact_id: "16315551181",
    });
    const audits = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.ticket_events
       WHERE ticket_id = $1 AND event_type = 'status_changed' AND to_status = 'open'`,
      [ticketC],
    );
    const tickets = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.tickets`,
    );
    expect(audits.rows[0]?.count).toBe("1");
    expect(tickets.rows[0]?.count).toBe("3");

    const dup = await ingest(db, {
      messageId: "mid-reopen-1",
      alias: aliasC,
    });
    expect(dup?.outcome).toBe("duplicate");
    const auditsAfterDup = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.ticket_events
       WHERE ticket_id = $1 AND event_type = 'status_changed' AND to_status = 'open'`,
      [ticketC],
    );
    expect(auditsAfterDup.rows[0]?.count).toBe("1");
  });

  it("ignores classified noise without writing a comment", async () => {
    const result = await ingest(db, {
      messageId: "mid-bounce",
      ignore: "bounce",
    });
    expect(result).toMatchObject({ outcome: "ignored", error_code: "bounce" });
    const comments = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments
       WHERE comment_text = 'Need an update' AND ticket_id = $1`,
      [TICKET_A],
    );
    void comments;
    const event = await db.query<{ outcome: string }>(
      `SELECT outcome FROM public.inbound_email_events WHERE message_id = 'mid-bounce'`,
    );
    expect(event.rows[0]?.outcome).toBe("ignored");
  });

  it("stores sanitized attachment metadata without a storage path", async () => {
    const result = await ingest(db, {
      messageId: "mid-attach",
      attachments: [
        {
          filename: "invoice.pdf",
          content_type: "application/pdf",
          byte_size: 1200,
          status: "accepted_metadata",
        },
        {
          filename: "payload.exe",
          content_type: "application/x-msdownload",
          byte_size: 12,
          status: "rejected_type",
        },
      ],
    });
    expect(result?.outcome).toBe("appended");
    const rows = await db.query<{
      filename: string;
      status: string;
      storage_path: string | null;
    }>(
      `SELECT a.filename, a.status, a.storage_path
       FROM public.inbound_email_attachments AS a
       JOIN public.inbound_email_events AS e ON e.id = a.event_id
       WHERE e.message_id = 'mid-attach'
       ORDER BY a.filename`,
    );
    expect(rows.rows).toEqual([
      { filename: "invoice.pdf", status: "accepted_metadata", storage_path: null },
      { filename: "payload.exe", status: "rejected_type", storage_path: null },
    ]);
  });

  it("does not return PII from the RPC", async () => {
    const result = await ingest(db, {
      messageId: "mid-pii",
      sender: "forwarder@agency.test",
    });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("forwarder@agency.test");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("riya@example.com");
    expect(JSON.stringify(result)).not.toContain(ALIAS_A);
  });

  it("skips alias allocation on insert when creator email is missing, then allocates lazily", async () => {
    const ticketD = "00000000-0000-0000-0000-0000000000dd";
    await db.query(
      `INSERT INTO public.tickets (id, ticket_code, creator_email, source_channel, status)
       VALUES ($1, 'CF-2026-00004', NULL, 'website', 'open')`,
      [ticketD],
    );
    const before = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_email_reply_aliases WHERE ticket_id = $1`,
      [ticketD],
    );
    expect(before.rows[0]?.count).toBe("0");
    const allocated = await db.query<{ ensure_ticket_email_reply_alias: string }>(
      `SELECT public.ensure_ticket_email_reply_alias($1) AS ensure_ticket_email_reply_alias`,
      [ticketD],
    );
    expect(allocated.rows[0]?.ensure_ticket_email_reply_alias).toMatch(
      /^t-[0-9a-f]{32}@reply\.cloutflow\.com$/,
    );
  });

  it("ignores empty replies and revoked aliases without reopening", async () => {
    const empty = await ingest(db, {
      messageId: "mid-empty",
      body: "   ",
    });
    expect(empty).toMatchObject({ outcome: "ignored", error_code: "empty_reply" });

    await db.query(
      `UPDATE public.ticket_email_reply_aliases SET revoked_at = now() WHERE local_part = $1`,
      [ALIAS_A],
    );
    const revoked = await ingest(db, { messageId: "mid-revoked" });
    expect(revoked).toMatchObject({ outcome: "rejected", error_code: "alias_revoked" });
    await db.query(
      `UPDATE public.ticket_email_reply_aliases SET revoked_at = NULL WHERE local_part = $1`,
      [ALIAS_A],
    );
  });
});
