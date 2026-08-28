import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const RESOLUTION_OUTBOX_MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260827140000_ticket_resolution_outbox.sql",
);

export function readResolutionOutboxMigrationSql(): string {
  return readFileSync(RESOLUTION_OUTBOX_MIGRATION_PATH, "utf8");
}

export const PGLITE_RESOLUTION_SCHEMA = `
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
  resolution_summary text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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

CREATE TABLE public.ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id),
  author_user_id uuid,
  author_name text,
  visibility text NOT NULL,
  comment_text text NOT NULL,
  send_to_creator boolean NOT NULL DEFAULT false,
  delivery_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
