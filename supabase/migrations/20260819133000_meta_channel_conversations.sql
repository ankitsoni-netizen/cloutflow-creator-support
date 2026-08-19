-- Meta WhatsApp / Instagram conversation storage — compatibility migration.
-- Idempotent and non-destructive: safe to re-run.
--
-- public.channel_messages and public.webhook_events already exist with
-- legacy columns and constraints. This migration does not recreate them,
-- drop them, or delete rows.
--
-- Does not modify public.tickets, ticket-number / ticket_code generation,
-- existing ticket RLS policies, or existing ticket rows.
--
-- Webhook writes use the server-only Supabase admin client (service_role).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. channel_conversations (create only if missing)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.channel_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  external_conversation_id text NOT NULL,
  external_contact_id text NOT NULL,
  display_name text,
  ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'new',
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS external_conversation_id text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS external_contact_id text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS ticket_id uuid;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS collected_data jsonb;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.channel_conversations
  ALTER COLUMN state SET DEFAULT 'new';
ALTER TABLE public.channel_conversations
  ALTER COLUMN collected_data SET DEFAULT '{}'::jsonb;
ALTER TABLE public.channel_conversations
  ALTER COLUMN last_message_at SET DEFAULT now();
ALTER TABLE public.channel_conversations
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.channel_conversations
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_conversations_ticket_id_fkey'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_ticket_id_fkey
      FOREIGN KEY (ticket_id)
      REFERENCES public.tickets (id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_conversations_channel_check'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_channel_check
      CHECK (channel IN ('whatsapp', 'instagram'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_conversations_state_check'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_state_check
      CHECK (
        state IN (
          'new',
          'collecting_name',
          'collecting_email',
          'collecting_phone',
          'collecting_social_handle',
          'collecting_platform',
          'collecting_issue_type',
          'collecting_campaign',
          'collecting_brand',
          'collecting_campaign_month',
          'collecting_poc',
          'collecting_description',
          'confirming',
          'ticket_created',
          'human_handoff',
          'closed'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_conversations_channel_external_conversation_id_key'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_channel_external_conversation_id_key
      UNIQUE (channel, external_conversation_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. channel_messages — preserve legacy columns/rows; add Meta compatibility
--    Canonical text column remains message_body. Do not add message_text.
--    Keep existing channel / direction / delivery_status constraints.
-- ---------------------------------------------------------------------------

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS message_type text;

ALTER TABLE public.channel_messages
  ALTER COLUMN message_type SET DEFAULT 'text';

UPDATE public.channel_messages
SET message_type = 'text'
WHERE message_type IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'channel_messages'
      AND column_name = 'message_type'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.channel_messages
      ALTER COLUMN message_type SET NOT NULL;
  END IF;
END $$;

-- ticket_id must be nullable: Meta messages can arrive before a ticket exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'channel_messages'
      AND column_name = 'ticket_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.channel_messages
      ALTER COLUMN ticket_id DROP NOT NULL;
  END IF;
END $$;

-- conversation_id → channel_conversations(id) ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.channel_messages'::regclass
      AND c.contype = 'f'
      AND a.attname = 'conversation_id'
  ) THEN
    ALTER TABLE public.channel_messages
      ADD CONSTRAINT channel_messages_conversation_id_fkey
      FOREIGN KEY (conversation_id)
      REFERENCES public.channel_conversations (id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Replace ticket_id FK CASCADE with SET NULL; preserve existing data.
DO $$
DECLARE
  rec record;
  has_set_null boolean := false;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.conname, c.confdeltype
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.channel_messages'::regclass
      AND c.contype = 'f'
      AND a.attname = 'ticket_id'
  LOOP
    IF rec.confdeltype = 'n' THEN
      has_set_null := true;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.channel_messages DROP CONSTRAINT %I',
        rec.conname
      );
    END IF;
  END LOOP;

  IF NOT has_set_null THEN
    ALTER TABLE public.channel_messages
      ADD CONSTRAINT channel_messages_ticket_id_fkey
      FOREIGN KEY (ticket_id)
      REFERENCES public.tickets (id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. webhook_events — preserve payload, error_message, and existing unique
-- ---------------------------------------------------------------------------

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS payload_hash text;

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS error_code text;

-- Replace provider check: keep existing values and allow meta / meta_whatsapp.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.webhook_events'::regclass
      AND c.contype = 'c'
      AND a.attname = 'provider'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.webhook_events DROP CONSTRAINT %I',
      rec.conname
    );
  END LOOP;

  ALTER TABLE public.webhook_events
    ADD CONSTRAINT webhook_events_provider_check
    CHECK (
      provider IN (
        'wati',
        'meta',
        'meta_whatsapp',
        'meta_instagram',
        'website',
        'brevo'
      )
    );
END $$;

-- Replace processing_status check: keep existing values and allow
-- processed / ignored.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.webhook_events'::regclass
      AND c.contype = 'c'
      AND a.attname = 'processing_status'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.webhook_events DROP CONSTRAINT %I',
      rec.conname
    );
  END LOOP;

  ALTER TABLE public.webhook_events
    ADD CONSTRAINT webhook_events_processing_status_check
    CHECK (
      processing_status IN (
        'received',
        'processing',
        'completed',
        'processed',
        'ignored',
        'failed'
      )
    );
END $$;

-- Reuse existing UNIQUE(provider, external_event_id). Do not add another.

-- ---------------------------------------------------------------------------
-- 4. Indexes (only after referenced columns exist)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS channel_conversations_ticket_id_idx
  ON public.channel_conversations (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS channel_conversations_last_message_at_idx
  ON public.channel_conversations (last_message_at DESC);

CREATE INDEX IF NOT EXISTS channel_conversations_channel_contact_idx
  ON public.channel_conversations (channel, external_contact_id);

CREATE INDEX IF NOT EXISTS channel_conversations_channel_state_idx
  ON public.channel_conversations (channel, state);

CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_channel_external_message_id_uidx
  ON public.channel_messages (channel, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS channel_messages_conversation_id_created_at_idx
  ON public.channel_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS channel_messages_ticket_id_idx
  ON public.channel_messages (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_events_status_received_at_idx
  ON public.webhook_events (processing_status, received_at);

-- ---------------------------------------------------------------------------
-- 5. updated_at trigger for channel_conversations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.channel_conversations_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_conversations_set_updated_at_trg
  ON public.channel_conversations;

CREATE TRIGGER channel_conversations_set_updated_at_trg
  BEFORE UPDATE ON public.channel_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.channel_conversations_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS — no anon/authenticated policies. Admin client bypasses RLS.
-- ---------------------------------------------------------------------------

ALTER TABLE public.channel_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.channel_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channel_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.channel_conversations TO service_role;
GRANT ALL ON TABLE public.channel_messages TO service_role;
GRANT ALL ON TABLE public.webhook_events TO service_role;

COMMENT ON TABLE public.channel_conversations IS
  'WhatsApp/Instagram conversation state. Written only by the server-only Supabase admin client from Meta webhook ingest. No anon/authenticated access.';

COMMENT ON TABLE public.channel_messages IS
  'Channel messages. Canonical text is message_body. conversation_id links Meta threads. Written by the server-only Supabase admin client. No anon/authenticated policies.';

COMMENT ON TABLE public.webhook_events IS
  'Webhook delivery log. Preserve payload and error_message; payload_hash/error_code are additive. Unique (provider, external_event_id) is the existing constraint. Server-only admin client writes. No anon/authenticated policies.';

COMMENT ON COLUMN public.channel_messages.conversation_id IS
  'Optional link to channel_conversations. Null on legacy ticket-linked rows; set for Meta ingest before a ticket exists.';

COMMENT ON COLUMN public.channel_messages.message_type IS
  'Message type for channel ingest. Defaults to text. Does not replace message_body.';

COMMENT ON COLUMN public.webhook_events.payload_hash IS
  'Optional hash of a webhook payload fragment for server-side idempotency diagnostics.';

COMMENT ON COLUMN public.webhook_events.error_code IS
  'Optional normalized error code for webhook processing diagnostics.';

COMMIT;
