import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const INSTAGRAM_OUTBOX_MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260826120000_instagram_outbox_and_active_ticket_unique.sql",
);

export function readInstagramOutboxMigrationSql(): string {
  return readFileSync(INSTAGRAM_OUTBOX_MIGRATION_PATH, "utf8");
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

export const PGLITE_OUTBOX_SCHEMA = `
CREATE TABLE public.channel_conversations (
  id uuid PRIMARY KEY,
  last_processed_external_message_id text,
  last_message_at timestamptz,
  last_activity_at timestamptz,
  state text,
  routing_intent text,
  current_intake_field text,
  last_prompt_key text,
  collected_data jsonb DEFAULT '{}'::jsonb,
  ticket_id uuid,
  intake_session_version integer DEFAULT 0,
  display_name text
);

CREATE TABLE public.channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.channel_conversations(id),
  ticket_id uuid,
  channel text,
  direction text,
  sender_name text,
  sender_address text,
  recipient_external_id text,
  message_body text,
  message_type text DEFAULT 'text',
  delivery_status text,
  delivery_error_code text,
  delivery_attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  idempotency_key text UNIQUE,
  purpose text,
  routing_kind text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel text,
  external_conversation_id text,
  status text
);
`;
