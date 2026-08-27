import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROUND_ROBIN_MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260827120000_creator_support_round_robin_assignment.sql",
);

export function readRoundRobinMigrationSql(): string {
  return readFileSync(ROUND_ROBIN_MIGRATION_PATH, "utf8");
}

export function extractSqlFunction(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing SQL function ${name}`);
  }
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) {
    throw new Error(`unterminated SQL function ${name}`);
  }
  return sql.slice(start, end + "\n$$;".length);
}

const GUC_NAME_ASSIGNMENT =
  "v_assignment_guc_name := 'app.rr_assign_' || replace(NEW.id::text, '-', '_');";

export function assignmentGucNameFromTicketId(ticketId: string): string {
  return `app.rr_assign_${ticketId.replace(/-/g, "_")}`;
}

export function functionAssignmentGucExpression(fnSql: string): string {
  const match = fnSql.match(
    /v_assignment_guc_name := 'app\.rr_assign_' \|\| replace\(NEW\.id::text, '-', '_'\);/,
  );
  if (!match) {
    throw new Error("missing per-ticket assignment GUC name expression");
  }
  return match[0];
}

export const EXPECTED_ASSIGNMENT_GUC_EXPRESSION = GUC_NAME_ASSIGNMENT;

export const PGLITE_ASSIGNMENT_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.staff_profiles (
  user_id uuid PRIMARY KEY,
  full_name text,
  role text,
  team text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code text,
  source_channel text,
  status text NOT NULL DEFAULT 'open',
  assigned_team text,
  assigned_executive_id uuid,
  assigned_executive_name text,
  external_contact_id text,
  external_conversation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id),
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid,
  actor_name text,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tickets_instagram_one_active_conversation_idx
  ON public.tickets (source_channel, external_conversation_id)
  WHERE source_channel = 'instagram'
    AND external_conversation_id IS NOT NULL
    AND status IN ('open', 'in_progress', 'waiting');
`;
