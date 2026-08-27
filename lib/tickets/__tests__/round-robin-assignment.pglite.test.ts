import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  EXPECTED_ASSIGNMENT_GUC_EXPRESSION,
  PGLITE_ASSIGNMENT_SCHEMA,
  assignmentGucNameFromTicketId,
  extractSqlFunction,
  functionAssignmentGucExpression,
  readRoundRobinMigrationSql,
} from "@/lib/tickets/__tests__/round-robin-assignment-sql";

const E1 = "00000000-0000-0000-0000-000000000001";
const E2 = "00000000-0000-0000-0000-000000000002";
const E3 = "00000000-0000-0000-0000-000000000003";
const ADMIN = "00000000-0000-0000-0000-0000000000aa";
const INACTIVE = "00000000-0000-0000-0000-0000000000ff";
const PREASSIGNED = "00000000-0000-0000-0000-0000000000bb";

type TicketRow = {
  id: string;
  assigned_executive_id: string | null;
  assigned_executive_name: string | null;
  assigned_team: string | null;
  status: string;
};

type EventRow = {
  event_type: string;
  actor_name: string | null;
  event_data: Record<string, unknown>;
};

type CursorRow = {
  last_assigned_user_id: string | null;
};

async function createAssignmentDatabase() {
  const db = new PGlite();
  await db.exec(PGLITE_ASSIGNMENT_SCHEMA);
  await db.exec(readRoundRobinMigrationSql());
  return db;
}

async function insertStaff(
  db: PGlite,
  userId: string,
  options: { name?: string; role?: string; active?: boolean } = {},
) {
  await db.query(
    `INSERT INTO public.staff_profiles (user_id, full_name, role, team, is_active)
     VALUES ($1, $2, $3, 'Creator Support', $4)
     ON CONFLICT (user_id) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         is_active = EXCLUDED.is_active`,
    [
      userId,
      options.name ?? `Executive ${userId.slice(-1)}`,
      options.role ?? "executive",
      options.active ?? true,
    ],
  );
}

async function insertTicket(
  db: PGlite,
  options: {
    sourceChannel?: string;
    conversationId?: string | null;
    contactId?: string | null;
    assignedExecutiveId?: string | null;
    assignedExecutiveName?: string | null;
    assignedTeam?: string;
    status?: string;
  } = {},
) {
  return db.query<TicketRow>(
    `INSERT INTO public.tickets (
       source_channel,
       status,
       assigned_team,
       assigned_executive_id,
       assigned_executive_name,
       external_conversation_id,
       external_contact_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, assigned_executive_id, assigned_executive_name, assigned_team, status`,
    [
      options.sourceChannel ?? "website",
      options.status ?? "open",
      options.assignedTeam ?? "Creator Support",
      options.assignedExecutiveId ?? null,
      options.assignedExecutiveName ?? null,
      options.conversationId ?? null,
      options.contactId ?? null,
    ],
  );
}

async function assignmentEvents(db: PGlite, ticketId: string) {
  const result = await db.query<EventRow>(
    `SELECT event_type, actor_name, event_data
     FROM public.ticket_events
     WHERE ticket_id = $1
     ORDER BY created_at, id`,
    [ticketId],
  );
  return result.rows;
}

async function cursor(db: PGlite) {
  const result = await db.query<CursorRow>(
    `SELECT last_assigned_user_id
     FROM public.ticket_assignment_cursors
     WHERE queue_key = 'creator_support'`,
  );
  return result.rows[0]?.last_assigned_user_id ?? null;
}

describe("Creator Support round-robin assignment (PGlite)", () => {
  it("assigns every new ticket to the only active executive", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1, { name: "Riya Sharma" });

    const first = await insertTicket(db, { sourceChannel: "website" });
    const second = await insertTicket(db, { sourceChannel: "instagram" });

    expect(first.rows[0]?.assigned_executive_id).toBe(E1);
    expect(first.rows[0]?.assigned_executive_name).toBe("Riya Sharma");
    expect(second.rows[0]?.assigned_executive_id).toBe(E1);
    expect(second.rows[0]?.assigned_team).toBe("Creator Support");
    await db.close();
  });

  it("rotates two active executives as E1, E2, E1, E2", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1, { name: "Exec One" });
    await insertStaff(db, E2, { name: "Exec Two" });

    const assigned: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const created = await insertTicket(db);
      assigned.push(created.rows[0]?.assigned_executive_id ?? "");
    }

    expect(assigned).toEqual([E1, E2, E1, E2]);
    await db.close();
  });

  it("rotates three active executives as E1, E2, E3, E1", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);
    await insertStaff(db, E3);

    const assigned: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const created = await insertTicket(db);
      assigned.push(created.rows[0]?.assigned_executive_id ?? "");
    }

    expect(assigned).toEqual([E1, E2, E3, E1]);
    await db.close();
  });

  it("preserves round-robin fairness across concurrent inserts", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);

    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        insertTicket(db, {
          sourceChannel: "website",
          conversationId: `concurrent-${index}`,
        }),
      ),
    );

    const ids = created.map((row) => row.rows[0]?.assigned_executive_id);
    const e1Count = ids.filter((id) => id === E1).length;
    const e2Count = ids.filter((id) => id === E2).length;
    expect(e1Count + e2Count).toBe(8);
    expect(Math.abs(e1Count - e2Count)).toBeLessThanOrEqual(1);
    expect(new Set(ids).size).toBe(2);
    expect(await cursor(db)).toBe(e1Count > e2Count ? E1 : E2);
    await db.close();
  });

  it("excludes inactive executives", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, INACTIVE, { name: "Inactive", active: false });
    await insertStaff(db, E1, { name: "Active Exec" });

    const created = await insertTicket(db);
    expect(created.rows[0]?.assigned_executive_id).toBe(E1);
    expect(created.rows[0]?.assigned_executive_name).toBe("Active Exec");
    await db.close();
  });

  it("excludes non-executive roles including admin", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, ADMIN, { name: "Admin User", role: "admin" });
    await insertStaff(db, E1, { name: "Only Executive" });

    const created = await insertTicket(db);
    expect(created.rows[0]?.assigned_executive_id).toBe(E1);
    await db.close();
  });

  it("lets a newly added active executive enter future rotation", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);

    expect((await insertTicket(db)).rows[0]?.assigned_executive_id).toBe(E1);
    await insertStaff(db, E3, { name: "New Exec" });
    expect((await insertTicket(db)).rows[0]?.assigned_executive_id).toBe(E2);
    expect((await insertTicket(db)).rows[0]?.assigned_executive_id).toBe(E3);
    await db.close();
  });

  it("restarts from the first eligible executive after the last assignee is deactivated", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);
    await insertStaff(db, E3);

    expect((await insertTicket(db)).rows[0]?.assigned_executive_id).toBe(E1);
    expect((await insertTicket(db)).rows[0]?.assigned_executive_id).toBe(E2);
    await db.query(
      `UPDATE public.staff_profiles SET is_active = false WHERE user_id = $1`,
      [E2],
    );
    expect((await insertTicket(db)).rows[0]?.assigned_executive_id).toBe(E1);
    await db.close();
  });

  it("creates the ticket unassigned when no executive is eligible", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, ADMIN, { role: "admin" });
    await insertStaff(db, INACTIVE, { active: false });

    const created = await insertTicket(db, { sourceChannel: "phone_call" });
    expect(created.rows).toHaveLength(1);
    expect(created.rows[0]?.assigned_executive_id).toBeNull();
    expect(created.rows[0]?.assigned_team).toBe("Creator Support");

    const events = await assignmentEvents(db, created.rows[0]!.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("assignment_skipped");
    expect(events[0]?.event_data).toEqual({
      source: "round_robin",
      reason: "no_eligible_executive",
      queue: "creator_support",
    });
    expect(JSON.stringify(events[0]?.event_data)).not.toMatch(/@|user_id|email/i);
    expect(await cursor(db)).toBeNull();
    await db.close();
  });

  it("does not overwrite an explicitly preassigned ticket", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);
    await insertStaff(db, PREASSIGNED, { name: "Preassigned Exec" });

    const created = await insertTicket(db, {
      assignedExecutiveId: PREASSIGNED,
      assignedExecutiveName: "Preassigned Exec",
    });

    expect(created.rows[0]?.assigned_executive_id).toBe(PREASSIGNED);
    expect(created.rows[0]?.assigned_executive_name).toBe("Preassigned Exec");
    expect(await cursor(db)).toBeNull();
    expect(await assignmentEvents(db, created.rows[0]!.id)).toEqual([]);
    await db.close();
  });

  it("does not rewind the cursor on manual reassignment", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);

    const first = await insertTicket(db);
    expect(first.rows[0]?.assigned_executive_id).toBe(E1);
    expect(await cursor(db)).toBe(E1);

    await db.query(
      `UPDATE public.tickets
       SET assigned_executive_id = $1, assigned_executive_name = 'Exec Two'
       WHERE id = $2`,
      [E2, first.rows[0]!.id],
    );

    expect(await cursor(db)).toBe(E1);
    const second = await insertTicket(db);
    expect(second.rows[0]?.assigned_executive_id).toBe(E2);
    await db.close();
  });

  it("does not rewind the cursor when a ticket is resolved", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);

    const first = await insertTicket(db);
    expect(first.rows[0]?.assigned_executive_id).toBe(E1);

    await db.query(
      `UPDATE public.tickets SET status = 'resolved' WHERE id = $1`,
      [first.rows[0]!.id],
    );

    expect(await cursor(db)).toBe(E1);
    const second = await insertTicket(db);
    expect(second.rows[0]?.assigned_executive_id).toBe(E2);
    await db.close();
  });

  it("assigns Instagram, WATI WhatsApp, website, and manual CRM inserts through the same primitive", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);

    const instagram = await insertTicket(db, {
      sourceChannel: "instagram",
      conversationId: "ig-1",
      contactId: "ig-1",
    });
    const wati = await insertTicket(db, {
      sourceChannel: "whatsapp",
      conversationId: "wa-1",
      contactId: "wa-1",
    });
    const website = await insertTicket(db, { sourceChannel: "website" });
    const manual = await insertTicket(db, { sourceChannel: "phone_call" });

    expect([
      instagram.rows[0]?.assigned_executive_id,
      wati.rows[0]?.assigned_executive_id,
      website.rows[0]?.assigned_executive_id,
      manual.rows[0]?.assigned_executive_id,
    ]).toEqual([E1, E2, E1, E2]);
    await db.close();
  });

  it("records exactly one automatic assignment audit event", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1, { name: "Riya Sharma" });

    const created = await insertTicket(db);
    const events = await assignmentEvents(db, created.rows[0]!.id);

    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("assignment_changed");
    expect(events[0]?.actor_name).toBe("System");
    expect(events[0]?.event_data).toMatchObject({
      previous_executive_id: null,
      new_executive_id: E1,
      new_executive_name: "Riya Sharma",
      new_team: "Creator Support",
      source: "round_robin",
    });
    expect(JSON.stringify(events[0]?.event_data)).not.toMatch(/@/);
    await db.close();
  });

  it("does not create another ticket or consume a round-robin slot on duplicate Instagram inserts", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1);
    await insertStaff(db, E2);

    const first = await insertTicket(db, {
      sourceChannel: "instagram",
      conversationId: "conv-dup",
      contactId: "contact-dup",
    });
    expect(first.rows[0]?.assigned_executive_id).toBe(E1);
    expect(await cursor(db)).toBe(E1);

    await expect(
      insertTicket(db, {
        sourceChannel: "instagram",
        conversationId: "conv-dup",
        contactId: "contact-dup",
      }),
    ).rejects.toThrow(/duplicate|unique/i);

    expect(await cursor(db)).toBe(E1);
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tickets WHERE external_conversation_id = 'conv-dup'`,
    );
    expect(count.rows[0]?.n).toBe(1);

    const next = await insertTicket(db, {
      sourceChannel: "instagram",
      conversationId: "conv-other",
    });
    expect(next.rows[0]?.assigned_executive_id).toBe(E2);
    await db.close();
  });

  it("keeps active-ticket uniqueness and does not backfill existing tickets", async () => {
    const db = new PGlite();
    await db.exec(PGLITE_ASSIGNMENT_SCHEMA);
    await insertStaff(db, E1);
    await db.query(
      `INSERT INTO public.tickets (id, source_channel, status, assigned_team, assigned_executive_id)
       VALUES (
         '11111111-1111-1111-1111-111111111111',
         'instagram',
         'open',
         'Creator Support',
         NULL
       )`,
    );
    await db.exec(readRoundRobinMigrationSql());

    const existing = await db.query<TicketRow>(
      `SELECT assigned_executive_id, assigned_executive_name, assigned_team, status
       FROM public.tickets
       WHERE id = '11111111-1111-1111-1111-111111111111'`,
    );
    expect(existing.rows[0]?.assigned_executive_id).toBeNull();

    const created = await insertTicket(db, { sourceChannel: "website" });
    expect(created.rows[0]?.assigned_executive_id).toBe(E1);

    await db.query(
      `INSERT INTO public.tickets (source_channel, external_conversation_id, status, assigned_team)
       VALUES ('instagram', 'already-open', 'open', 'Creator Support')`,
    );
    await expect(
      db.query(
        `INSERT INTO public.tickets (source_channel, external_conversation_id, status, assigned_team)
         VALUES ('instagram', 'already-open', 'waiting', 'Creator Support')`,
      ),
    ).rejects.toThrow(/duplicate|unique/i);
    await db.close();
  });

  it("marks manual reassignment events as manual without changing the cursor", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1, { name: "Exec One" });
    await insertStaff(db, E2, { name: "Exec Two" });

    const created = await insertTicket(db);
    await db.query(
      `UPDATE public.tickets
       SET assigned_executive_id = $1, assigned_executive_name = 'Exec Two'
       WHERE id = $2`,
      [E2, created.rows[0]!.id],
    );

    const events = await assignmentEvents(db, created.rows[0]!.id);
    expect(events.map((event) => event.event_data.source)).toEqual([
      "round_robin",
      "manual",
    ]);
    expect(await cursor(db)).toBe(E1);
    await db.close();
  });

  it("is idempotent when the migration is applied twice", async () => {
    const db = await createAssignmentDatabase();
    await db.exec(readRoundRobinMigrationSql());
    await insertStaff(db, E1, { name: "Riya Sharma" });
    const created = await insertTicket(db);
    expect(created.rows[0]?.assigned_executive_id).toBe(E1);
    await db.close();
  });

  it("uses identical hyphen-free per-ticket GUC names in BEFORE and AFTER functions", async () => {
    const sql = readRoundRobinMigrationSql();
    const before = extractSqlFunction(
      sql,
      "assign_creator_support_ticket_round_robin",
    );
    const after = extractSqlFunction(sql, "tickets_insert_assignment_audit");
    const beforeExpr = functionAssignmentGucExpression(before);
    const afterExpr = functionAssignmentGucExpression(after);

    expect(beforeExpr).toBe(EXPECTED_ASSIGNMENT_GUC_EXPRESSION);
    expect(afterExpr).toBe(EXPECTED_ASSIGNMENT_GUC_EXPRESSION);
    expect(beforeExpr).toBe(afterExpr);
    expect(before).toContain(
      "set_config(v_assignment_guc_name, 'preassigned', true)",
    );
    expect(before).toContain(
      "set_config(v_assignment_guc_name, 'skipped', true)",
    );
    expect(before).toContain(
      "set_config(v_assignment_guc_name, 'round_robin', true)",
    );
    expect(after).toContain("current_setting(v_assignment_guc_name, true)");
    expect(before).not.toMatch(/set_config\([^,]*NEW\.id/);
    expect(after).not.toMatch(/current_setting\([^,]*NEW\.id/);

    const exampleId = "123e4567-e89b-12d3-a456-426614174000";
    const db = new PGlite();
    const generated = await db.query<{ guc: string }>(
      `SELECT 'app.rr_assign_' || replace($1::uuid::text, '-', '_') AS guc`,
      [exampleId],
    );
    const guc = generated.rows[0]?.guc ?? "";
    expect(guc).toBe(assignmentGucNameFromTicketId(exampleId));
    expect(guc).toBe("app.rr_assign_123e4567_e89b_12d3_a456_426614174000");
    expect(guc).not.toContain("-");
    expect(guc).toMatch(/^app\.rr_assign_[a-z0-9_]+$/);
    expect(assignmentGucNameFromTicketId(E1)).toMatch(
      /^app\.rr_assign_[a-z0-9_]+$/,
    );
    expect(assignmentGucNameFromTicketId(E1)).not.toContain("-");
    await db.close();
  });

  it("preserves per-ticket audit identity across a multi-row insert", async () => {
    const db = await createAssignmentDatabase();
    await insertStaff(db, E1, { name: "Exec One" });
    await insertStaff(db, E2, { name: "Exec Two" });
    await insertStaff(db, PREASSIGNED, { name: "Preassigned Exec" });

    const created = await db.query<TicketRow>(
      `INSERT INTO public.tickets (
         source_channel,
         status,
         assigned_team,
         assigned_executive_id,
         assigned_executive_name
       ) VALUES
         ('website', 'open', 'Creator Support', NULL, NULL),
         ('website', 'open', 'Creator Support', $1, 'Preassigned Exec'),
         ('phone_call', 'open', 'Creator Support', NULL, NULL)
       RETURNING id, assigned_executive_id, assigned_executive_name, assigned_team, status`,
      [PREASSIGNED],
    );

    expect(created.rows).toHaveLength(3);
    const autoA = created.rows[0];
    const preassigned = created.rows[1];
    const autoB = created.rows[2];

    expect(autoA?.assigned_executive_id).toBe(E1);
    expect(preassigned?.assigned_executive_id).toBe(PREASSIGNED);
    expect(autoB?.assigned_executive_id).toBe(E2);

    const eventsA = await assignmentEvents(db, autoA!.id);
    const eventsPre = await assignmentEvents(db, preassigned!.id);
    const eventsB = await assignmentEvents(db, autoB!.id);

    expect(eventsA).toHaveLength(1);
    expect(eventsA[0]?.event_type).toBe("assignment_changed");
    expect(eventsA[0]?.event_data.source).toBe("round_robin");
    expect(eventsA[0]?.event_data.new_executive_id).toBe(E1);

    expect(eventsPre).toEqual([]);

    expect(eventsB).toHaveLength(1);
    expect(eventsB[0]?.event_type).toBe("assignment_changed");
    expect(eventsB[0]?.event_data.source).toBe("round_robin");
    expect(eventsB[0]?.event_data.new_executive_id).toBe(E2);
    await db.close();
  });
});
