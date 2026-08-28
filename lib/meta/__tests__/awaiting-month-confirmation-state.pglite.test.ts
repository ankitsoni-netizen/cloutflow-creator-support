import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  EXPANDED_CONVERSATION_STATES,
  PGLITE_MONTH_CONFIRMATION_SCHEMA,
  PRODUCTION_CONVERSATION_STATES,
  readMonthConfirmationStateMigrationSql,
} from "@/lib/meta/__tests__/awaiting-month-confirmation-state-sql";

type ConversationRow = {
  id: string;
  state: string;
  collected_data: Record<string, unknown>;
  provider: string | null;
  recipient_account_id: string | null;
  identity_status: string | null;
};

type ConstraintRow = {
  conname: string;
  def: string;
  attnames: string;
};

async function createDatabase() {
  const db = new PGlite();
  await db.exec(PGLITE_MONTH_CONFIRMATION_SCHEMA);
  return db;
}

async function stateConstraints(db: PGlite) {
  const result = await db.query<ConstraintRow>(
    `SELECT
       c.conname,
       pg_get_constraintdef(c.oid) AS def,
       (
         SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
         FROM pg_attribute a
         WHERE a.attrelid = c.conrelid
           AND a.attnum = ANY (c.conkey)
           AND NOT a.attisdropped
       ) AS attnames
     FROM pg_constraint c
     WHERE c.conrelid = 'public.channel_conversations'::regclass
       AND c.contype = 'c'
     ORDER BY c.conname`,
  );
  return result.rows;
}

function stateCheck(rows: ConstraintRow[]) {
  return rows.find((row) => row.attnames === "state") ?? null;
}

async function insertConversation(
  db: PGlite,
  state: string,
  extras: {
    collected?: Record<string, unknown>;
    provider?: string;
    recipientAccountId?: string;
    identityStatus?: string;
  } = {},
) {
  const result = await db.query<ConversationRow>(
    `INSERT INTO public.channel_conversations (
       external_conversation_id,
       external_contact_id,
       state,
       collected_data,
       provider,
       recipient_account_id,
       identity_status
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     RETURNING id, state, collected_data, provider, recipient_account_id, identity_status`,
    [
      `ext-${state}-${Math.random().toString(16).slice(2)}`,
      "contact-1",
      state,
      JSON.stringify(extras.collected ?? { brandName: "Acme" }),
      extras.provider ?? "meta_instagram",
      extras.recipientAccountId ?? "17841400008460000",
      extras.identityStatus ?? "unambiguous",
    ],
  );
  return result.rows[0]!;
}

describe("awaiting_month_confirmation state migration SQL", () => {
  it("only expands the single-column state CHECK and stays additive", () => {
    const sql = readMonthConfirmationStateMigrationSql();
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).toContain("SET LOCAL lock_timeout = '15s'");
    expect(statements).toContain("SET LOCAL statement_timeout = '2min'");
    expect(statements).toContain("c.conkey = ARRAY[state_attnum]::int2[]");
    expect(statements).toContain("ADD CONSTRAINT channel_conversations_state_check_month");
    expect(statements).toContain(
      "RENAME CONSTRAINT channel_conversations_state_check_month",
    );
    expect(statements).toMatch(/BEGIN;/);
    expect(statements).toMatch(/COMMIT;/);
    expect(statements).not.toMatch(/\bUPDATE\b/);
    expect(statements).not.toMatch(/\bDELETE\b/);
    expect(statements).not.toMatch(/\bGRANT\b/);
    expect(statements).not.toMatch(/\bREVOKE\b/);
    expect(statements).not.toMatch(/\bENABLE ROW LEVEL SECURITY\b/);
    expect(statements).not.toContain("public.tickets");
    expect(statements).not.toContain("public.channel_messages");
    for (const state of PRODUCTION_CONVERSATION_STATES) {
      expect(statements).toContain(`'${state}'`);
    }
    expect(statements).toContain("'awaiting_month_confirmation'");
  });
});

describe("awaiting_month_confirmation state CHECK (PGlite)", () => {
  it("keeps every Production state, allows the new state, and rejects invalid states", async () => {
    const db = new PGlite();
    await db.exec(PGLITE_MONTH_CONFIRMATION_SCHEMA);
    const beforeConstraints = await stateConstraints(db);
    expect(stateCheck(beforeConstraints)?.def).not.toContain(
      "awaiting_month_confirmation",
    );
    expect(
      beforeConstraints.map((row) => row.conname).sort(),
    ).toEqual([
      "channel_conversations_channel_check",
      "channel_conversations_identity_status_check",
      "channel_conversations_routing_intent_check",
      "channel_conversations_state_check",
    ]);

    const seeded: ConversationRow[] = [];
    for (const state of PRODUCTION_CONVERSATION_STATES) {
      seeded.push(
        await insertConversation(db, state, {
          collected: { seed: state },
        }),
      );
    }

    await db.exec(readMonthConfirmationStateMigrationSql());
    await db.exec(readMonthConfirmationStateMigrationSql());

    const afterConstraints = await stateConstraints(db);
    const check = stateCheck(afterConstraints);
    expect(check?.conname).toBe("channel_conversations_state_check");
    expect(check?.def).toContain("awaiting_month_confirmation");
    for (const state of PRODUCTION_CONVERSATION_STATES) {
      expect(check?.def).toContain(state);
    }
    expect(
      afterConstraints.map((row) => row.conname).sort(),
    ).toEqual([
      "channel_conversations_channel_check",
      "channel_conversations_identity_status_check",
      "channel_conversations_routing_intent_check",
      "channel_conversations_state_check",
    ]);

    const reloaded = await db.query<ConversationRow>(
      `SELECT id, state, collected_data, provider, recipient_account_id, identity_status
       FROM public.channel_conversations
       ORDER BY state, id`,
    );
    expect(reloaded.rows).toHaveLength(seeded.length);
    for (const row of seeded) {
      const match = reloaded.rows.find((item) => item.id === row.id);
      expect(match).toMatchObject({
        state: row.state,
        provider: "meta_instagram",
        recipient_account_id: "17841400008460000",
        identity_status: "unambiguous",
      });
      expect(match?.collected_data).toEqual({ seed: row.state });
    }

    for (const state of EXPANDED_CONVERSATION_STATES) {
      await insertConversation(db, state);
    }

    await expect(
      insertConversation(db, "not_a_real_state"),
    ).rejects.toThrow();

    const identity = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'channel_conversations'
         AND column_name IN ('provider', 'recipient_account_id', 'identity_status')
       ORDER BY column_name`,
    );
    expect(identity.rows.map((row) => row.column_name)).toEqual([
      "identity_status",
      "provider",
      "recipient_account_id",
    ]);
  });

  it("rolls back and leaves the existing state CHECK when existing rows are invalid", async () => {
    const db = await createDatabase();
    await db.exec(`
      ALTER TABLE public.channel_conversations
        DROP CONSTRAINT channel_conversations_state_check;
      INSERT INTO public.channel_conversations (
        external_conversation_id,
        external_contact_id,
        state
      ) VALUES ('ext-bogus', 'contact-bogus', 'not_a_real_state');
      ALTER TABLE public.channel_conversations
        ADD CONSTRAINT channel_conversations_state_check
        CHECK (
          state IN (
            ${PRODUCTION_CONVERSATION_STATES.map((state) => `'${state}'`).join(", ")}
          )
        ) NOT VALID;
    `);

    await expect(db.exec(readMonthConfirmationStateMigrationSql())).rejects.toThrow(
      /allow-list|check constraint/i,
    );
    await db.exec("ROLLBACK");

    const after = await stateConstraints(db);
    const check = stateCheck(after);
    expect(check).not.toBeNull();
    expect(check?.def).not.toContain("awaiting_month_confirmation");
    const leftover = await db.query<{ state: string }>(
      `SELECT state FROM public.channel_conversations WHERE state = 'not_a_real_state'`,
    );
    expect(leftover.rows).toHaveLength(1);
    expect(
      after.some((row) => row.conname === "channel_conversations_identity_status_check"),
    ).toBe(true);
  });
});
