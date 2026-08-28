import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  PGLITE_RESOLUTION_SCHEMA,
  readResolutionOutboxMigrationSql,
} from "@/lib/tickets/__tests__/resolve-ticket-sql";

const STAFF = "00000000-0000-0000-0000-000000000001";
const TICKET = "00000000-0000-0000-0000-0000000000aa";

type ResolvePayload = {
  already_resolved: boolean;
  comment_id: string;
  job_id: string;
  event_id: string;
  ticket: {
    id: string;
    status: string;
    resolution_summary: string | null;
    resolved_at: string | null;
    assigned_executive_id: string | null;
  };
};

async function createDatabase() {
  const db = new PGlite();
  await db.exec(PGLITE_RESOLUTION_SCHEMA);
  await db.exec(readResolutionOutboxMigrationSql());
  await db.query(
    `INSERT INTO public.staff_profiles (user_id, full_name, role, team, is_active)
     VALUES ($1, 'Priya Sharma', 'executive', 'Creator Support', true)`,
    [STAFF],
  );
  await db.query(
    `INSERT INTO public.tickets (
       id, ticket_code, source_channel, status, assigned_executive_id, assigned_executive_name
     ) VALUES ($1, 'CF-2026-00001', 'website', 'open', $2, 'Rahul Mehta')`,
    [TICKET, "00000000-0000-0000-0000-000000000002"],
  );
  return db;
}

describe("resolve_creator_support_ticket SQL", { timeout: 20_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createDatabase();
  }, 20_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates exactly one resolution audit event across retries", async () => {
    const first = await db.query<{ resolve_creator_support_ticket: ResolvePayload }>(
      `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5) AS resolve_creator_support_ticket`,
      [TICKET, "Paid today", STAFF, "Priya Sharma", `ticket-resolution:${TICKET}`],
    );
    const second = await db.query<{ resolve_creator_support_ticket: ResolvePayload }>(
      `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5) AS resolve_creator_support_ticket`,
      [TICKET, "Paid today", STAFF, "Priya Sharma", `ticket-resolution:${TICKET}`],
    );

    const events = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.ticket_events
       WHERE ticket_id = $1
         AND to_status = 'resolved'`,
      [TICKET],
    );
    const comments = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_comments WHERE ticket_id = $1`,
      [TICKET],
    );
    const jobs = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.ticket_resolution_jobs WHERE ticket_id = $1`,
      [TICKET],
    );
    const ticket = await db.query<{
      status: string;
      resolved_at: string | null;
      assigned_executive_id: string | null;
    }>(
      `SELECT status, resolved_at, assigned_executive_id FROM public.tickets WHERE id = $1`,
      [TICKET],
    );

    expect(first.rows[0]?.resolve_creator_support_ticket.already_resolved).toBe(false);
    expect(second.rows[0]?.resolve_creator_support_ticket.already_resolved).toBe(true);
    expect(events.rows[0]?.count).toBe("1");
    expect(comments.rows[0]?.count).toBe("1");
    expect(jobs.rows[0]?.count).toBe("1");
    expect(ticket.rows[0]?.status).toBe("resolved");
    expect(ticket.rows[0]?.resolved_at).toBeTruthy();
    expect(ticket.rows[0]?.assigned_executive_id).toBe(
      "00000000-0000-0000-0000-000000000002",
    );
  });

  it("leases a due job without changing ticket status on claim failure paths", async () => {
    const job = await db.query<{ id: string }>(
      `SELECT id FROM public.ticket_resolution_jobs WHERE ticket_id = $1`,
      [TICKET],
    );
    const claimed = await db.query<{ claim_ticket_resolution_job: { outcome: string } }>(
      `SELECT public.claim_ticket_resolution_job($1, now(), 5) AS claim_ticket_resolution_job`,
      [job.rows[0]?.id],
    );
    const skipped = await db.query<{ claim_ticket_resolution_job: { outcome: string } }>(
      `SELECT public.claim_ticket_resolution_job($1, now(), 5) AS claim_ticket_resolution_job`,
      [job.rows[0]?.id],
    );
    const ticket = await db.query<{ status: string }>(
      `SELECT status FROM public.tickets WHERE id = $1`,
      [TICKET],
    );
    expect(claimed.rows[0]?.claim_ticket_resolution_job.outcome).toBe("claimed");
    expect(skipped.rows[0]?.claim_ticket_resolution_job.outcome).toBe("skipped");
    expect(ticket.rows[0]?.status).toBe("resolved");
  });
});

describe("resolve_creator_support_ticket transaction proofs", { timeout: 20_000 }, () => {
  it("rejects unauthorized actors without mutating the ticket", async () => {
    const db = await createDatabase();
    try {
      await expect(
        db.query(
          `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5)`,
          [
            TICKET,
            "Paid today",
            "00000000-0000-0000-0000-000000000099",
            "Unknown",
            `ticket-resolution:${TICKET}`,
          ],
        ),
      ).rejects.toThrow(/not_authorized/);
      const ticket = await db.query<{ status: string }>(
        `SELECT status FROM public.tickets WHERE id = $1`,
        [TICKET],
      );
      expect(ticket.rows[0]?.status).toBe("open");
    } finally {
      await db.close();
    }
  });

  it("rolls back the resolution when job enqueue fails", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.reject_resolution_jobs()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'forced_job_failure';
        END;
        $$;
        CREATE TRIGGER reject_resolution_jobs_trg
          BEFORE INSERT ON public.ticket_resolution_jobs
          FOR EACH ROW
          EXECUTE FUNCTION public.reject_resolution_jobs();
      `);
      await expect(
        db.query(
          `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5)`,
          [TICKET, "Paid today", STAFF, "Priya Sharma", `ticket-resolution:${TICKET}`],
        ),
      ).rejects.toThrow(/forced_job_failure/);
      const ticket = await db.query<{ status: string; resolved_at: string | null }>(
        `SELECT status, resolved_at FROM public.tickets WHERE id = $1`,
        [TICKET],
      );
      const events = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.ticket_events WHERE ticket_id = $1`,
        [TICKET],
      );
      const jobs = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.ticket_resolution_jobs WHERE ticket_id = $1`,
        [TICKET],
      );
      expect(ticket.rows[0]?.status).toBe("open");
      expect(ticket.rows[0]?.resolved_at).toBeNull();
      expect(events.rows[0]?.count).toBe("0");
      expect(jobs.rows[0]?.count).toBe("0");
    } finally {
      await db.close();
    }
  });

  it("uses database clock_timestamp for resolved_at", async () => {
    const db = await createDatabase();
    try {
      const before = await db.query<{ t: string }>(`SELECT clock_timestamp()::text AS t`);
      await db.query(
        `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5)`,
        [TICKET, "Paid today", STAFF, "Priya Sharma", `ticket-resolution:${TICKET}`],
      );
      const after = await db.query<{ t: string }>(`SELECT clock_timestamp()::text AS t`);
      const ticket = await db.query<{ resolved_at: string }>(
        `SELECT resolved_at::text AS resolved_at FROM public.tickets WHERE id = $1`,
        [TICKET],
      );
      const resolvedAt = Date.parse(ticket.rows[0]?.resolved_at ?? "");
      expect(resolvedAt).toBeGreaterThanOrEqual(Date.parse(before.rows[0]?.t ?? ""));
      expect(resolvedAt).toBeLessThanOrEqual(Date.parse(after.rows[0]?.t ?? ""));
    } finally {
      await db.close();
    }
  });

  it("keeps one resolution audit event when an existing status trigger also writes", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE OR REPLACE FUNCTION public.tickets_status_audit()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.status IS DISTINCT FROM OLD.status THEN
            INSERT INTO public.ticket_events (
              ticket_id, event_type, from_status, to_status, actor_name
            ) VALUES (
              NEW.id, 'status_changed', OLD.status, NEW.status, 'status-trigger'
            );
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER tickets_status_audit_trigger
          AFTER UPDATE OF status ON public.tickets
          FOR EACH ROW
          EXECUTE FUNCTION public.tickets_status_audit();
      `);
      await db.query(
        `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5)`,
        [TICKET, "Paid today", STAFF, "Priya Sharma", `ticket-resolution:${TICKET}`],
      );
      await db.query(
        `SELECT public.resolve_creator_support_ticket($1, $2, $3, $4, $5)`,
        [TICKET, "Paid today", STAFF, "Priya Sharma", `ticket-resolution:${TICKET}`],
      );
      const events = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM public.ticket_events
         WHERE ticket_id = $1
           AND to_status = 'resolved'`,
        [TICKET],
      );
      const jobs = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.ticket_resolution_jobs WHERE ticket_id = $1`,
        [TICKET],
      );
      expect(events.rows[0]?.count).toBe("1");
      expect(jobs.rows[0]?.count).toBe("1");
    } finally {
      await db.close();
    }
  });
});
