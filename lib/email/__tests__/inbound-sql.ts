import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractSqlFunction } from "@/lib/meta/__tests__/instagram-outbox-sql";

export const INBOUND_EMAIL_MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260904120000_ticket_inbound_email_replies.sql",
);

export function readInboundEmailMigrationSql(): string {
  return readFileSync(INBOUND_EMAIL_MIGRATION_PATH, "utf8");
}

export function inboundEmailSqlFunction(name: string): string {
  return extractSqlFunction(readInboundEmailMigrationSql(), name);
}

export const INBOUND_EMAIL_ROLLBACK_SQL = `
DROP TRIGGER IF EXISTS tickets_ensure_email_reply_alias_trg ON public.tickets;
DROP FUNCTION IF EXISTS public.tickets_ensure_email_reply_alias();
DROP FUNCTION IF EXISTS public.ingest_brevo_inbound_email(text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.ensure_ticket_email_reply_alias(uuid);
DROP TABLE IF EXISTS public.inbound_email_attachments;
DROP TABLE IF EXISTS public.inbound_email_events;
DROP TABLE IF EXISTS public.ticket_email_reply_aliases;
`;

export const PGLITE_PRODUCTION_SHAPED_TICKET_SCHEMA = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION gen_random_bytes(n integer)
RETURNS bytea
LANGUAGE sql
AS $$
  SELECT substring(
    decode(md5(random()::text || clock_timestamp()::text), 'hex')
    || decode(md5(random()::text || n::text), 'hex')
    FROM 1 FOR n
  );
$$;

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
  creator_email text,
  creator_name text,
  source_channel text NOT NULL DEFAULT 'website',
  status text NOT NULL DEFAULT 'open',
  assigned_team text,
  assigned_executive_id uuid,
  assigned_executive_name text,
  external_contact_id text,
  external_conversation_id text,
  recipient_account_id text,
  identity_status text,
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

CREATE OR REPLACE FUNCTION public.tickets_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_set_updated_at_trg ON public.tickets;
CREATE TRIGGER tickets_set_updated_at_trg
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tickets_set_updated_at();
`;


export const PGLITE_INBOUND_EMAIL_SCHEMA = `
CREATE OR REPLACE FUNCTION gen_random_bytes(n integer)
RETURNS bytea
LANGUAGE sql
AS $$
  SELECT substring(
    decode(md5(random()::text || clock_timestamp()::text), 'hex')
    || decode(md5(random()::text || n::text), 'hex')
    FROM 1 FOR n
  );
$$;

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code text,
  creator_email text,
  creator_name text,
  source_channel text,
  status text NOT NULL DEFAULT 'open',
  external_contact_id text,
  external_conversation_id text,
  recipient_account_id text,
  identity_status text,
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

CREATE TABLE public.ticket_email_reply_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets (id) ON DELETE CASCADE,
  local_part text NOT NULL,
  domain text NOT NULL DEFAULT 'reply.cloutflow.com',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT ticket_email_reply_aliases_local_part_format
    CHECK (local_part ~ '^t-[0-9a-f]{32}$'),
  CONSTRAINT ticket_email_reply_aliases_domain_format
    CHECK (domain = 'reply.cloutflow.com')
);

CREATE UNIQUE INDEX ticket_email_reply_aliases_local_part_uidx
  ON public.ticket_email_reply_aliases (local_part);

CREATE UNIQUE INDEX ticket_email_reply_aliases_one_active_ticket_uidx
  ON public.ticket_email_reply_aliases (ticket_id)
  WHERE revoked_at IS NULL;

CREATE TABLE public.inbound_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  outcome text NOT NULL,
  error_code text,
  ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL,
  comment_id uuid REFERENCES public.ticket_comments (id) ON DELETE SET NULL,
  reopened boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inbound_email_events_message_id_uidx
  ON public.inbound_email_events (message_id);

CREATE TABLE public.inbound_email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.inbound_email_events (id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.ticket_comments (id) ON DELETE SET NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer,
  status text NOT NULL,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
