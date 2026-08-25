-- Instagram DM intent routing, intake state, outbound idempotency, and email outbox.
-- Idempotent and non-destructive: safe to re-run.
-- Does not modify ticket-number / ticket_code generation or ticket RLS policies.
-- Do not apply automatically; review before running remotely.
--
-- Webhook and CRM writes use the server-only Supabase admin client (service_role)
-- except staff-authenticated CRM actions, which first verify active staff.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. channel_conversations — routing / intake session columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS routing_intent text;

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS current_intake_field text;

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS last_prompt_key text;

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS last_processed_external_message_id text;

UPDATE public.channel_conversations
SET last_activity_at = last_message_at
WHERE last_activity_at IS NULL;

ALTER TABLE public.channel_conversations
  ALTER COLUMN last_activity_at SET DEFAULT now();

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
    WHERE c.conrelid = 'public.channel_conversations'::regclass
      AND c.contype = 'c'
      AND a.attname = 'state'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.channel_conversations DROP CONSTRAINT %I',
      rec.conname
    );
  END LOOP;

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
        'closed',
        'unclassified',
        'awaiting_route',
        'collaboration',
        'support_intake',
        'awaiting_confirmation',
        'ticket_open',
        'cancelled'
      )
    );
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_conversations_routing_intent_check'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_routing_intent_check
      CHECK (
        routing_intent IS NULL
        OR routing_intent IN (
          'unclassified',
          'collaboration',
          'creator_support'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS channel_conversations_last_activity_at_idx
  ON public.channel_conversations (last_activity_at DESC);

CREATE INDEX IF NOT EXISTS channel_conversations_last_prompt_key_idx
  ON public.channel_conversations (last_prompt_key)
  WHERE last_prompt_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. channel_messages — outbound idempotency and routing kind
-- ---------------------------------------------------------------------------

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS delivery_error_code text;

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS recipient_external_id text;

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS purpose text;

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS routing_kind text;

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS comment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_messages_routing_kind_check'
      AND conrelid = 'public.channel_messages'::regclass
  ) THEN
    ALTER TABLE public.channel_messages
      ADD CONSTRAINT channel_messages_routing_kind_check
      CHECK (
        routing_kind IS NULL
        OR routing_kind IN ('unclassified', 'collaboration', 'support')
      );
  END IF;
END $$;

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
    WHERE c.conrelid = 'public.channel_messages'::regclass
      AND c.contype = 'c'
      AND a.attname = 'delivery_status'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.channel_messages DROP CONSTRAINT %I',
      rec.conname
    );
  END LOOP;

  ALTER TABLE public.channel_messages
    ADD CONSTRAINT channel_messages_delivery_status_check
    CHECK (
      delivery_status IS NULL
      OR delivery_status IN (
        'received',
        'pending',
        'sent',
        'delivered',
        'failed',
        'queued'
      )
    );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_idempotency_key_uidx
  ON public.channel_messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS channel_messages_comment_id_idx
  ON public.channel_messages (comment_id)
  WHERE comment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_messages_comment_id_fkey'
      AND conrelid = 'public.channel_messages'::regclass
  ) THEN
    ALTER TABLE public.channel_messages
      ADD CONSTRAINT channel_messages_comment_id_fkey
      FOREIGN KEY (comment_id)
      REFERENCES public.ticket_comments (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.channel_messages.idempotency_key IS
  'Outbound send idempotency key. Unique when present. Prevents duplicate Instagram/email prompts.';

COMMENT ON COLUMN public.channel_messages.delivery_error_code IS
  'Sanitized outbound error code only. Never store tokens, payloads, or message text.';

COMMENT ON COLUMN public.channel_messages.routing_kind IS
  'unclassified, collaboration, or support. Collaboration messages must not be treated as support ticket transcript.';

-- ---------------------------------------------------------------------------
-- 3. channel_email_deliveries — Brevo outbox / idempotency
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.channel_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.channel_conversations (id) ON DELETE SET NULL,
  comment_id uuid REFERENCES public.ticket_comments (id) ON DELETE SET NULL,
  purpose text NOT NULL,
  idempotency_key text NOT NULL,
  brevo_message_id text,
  delivery_status text NOT NULL DEFAULT 'pending',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_email_deliveries_idempotency_key_key'
      AND conrelid = 'public.channel_email_deliveries'::regclass
  ) THEN
    ALTER TABLE public.channel_email_deliveries
      ADD CONSTRAINT channel_email_deliveries_idempotency_key_key
      UNIQUE (idempotency_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_email_deliveries_status_check'
      AND conrelid = 'public.channel_email_deliveries'::regclass
  ) THEN
    ALTER TABLE public.channel_email_deliveries
      ADD CONSTRAINT channel_email_deliveries_status_check
      CHECK (
        delivery_status IN ('pending', 'sent', 'failed', 'skipped')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS channel_email_deliveries_ticket_id_idx
  ON public.channel_email_deliveries (ticket_id)
  WHERE ticket_id IS NOT NULL;

ALTER TABLE public.channel_email_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.channel_email_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.channel_email_deliveries TO service_role;

COMMENT ON TABLE public.channel_email_deliveries IS
  'Outbound email delivery log for Instagram ticket mirroring. Written by the server-only admin client. No anon/authenticated access.';

COMMENT ON COLUMN public.channel_conversations.routing_intent IS
  'unclassified, collaboration, or creator_support. Null on legacy rows.';

COMMENT ON COLUMN public.channel_conversations.last_prompt_key IS
  'Idempotency key of the last chatbot prompt sent for this conversation session.';

COMMENT ON COLUMN public.channel_conversations.last_processed_external_message_id IS
  'Last inbound Meta message id applied to the routing state machine. Prevents duplicate prompt/state advances on webhook retry.';

COMMIT;
