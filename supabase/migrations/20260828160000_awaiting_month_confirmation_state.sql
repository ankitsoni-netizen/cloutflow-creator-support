-- Expand public.channel_conversations.state to allow awaiting_month_confirmation.
-- Additive and idempotent. Safe to re-run.
--
-- Targets only the single-column state CHECK. Does not modify rows, tickets,
-- messages, identity metadata, RLS, grants, triggers, functions, cron, Vault,
-- webhooks, or environment variables.
--
-- Replacement is atomic in one transaction:
--   1. Validate existing rows against the expanded allow-list.
--   2. ADD the expanded CHECK while the current CHECK remains in place.
--   3. DROP only the unexpanded single-column state CHECK.
--   4. RENAME the new CHECK to the canonical name.
-- A failure rolls back and leaves the existing constraint intact.
-- Do not apply automatically; review before running remotely.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  state_attnum int2;
  rec record;
  def text;
  expanded_name text := NULL;
  old_names text[] := ARRAY[]::text[];
  old_name text;
  pending_name constant text := 'channel_conversations_state_check_month';
  canonical_name constant text := 'channel_conversations_state_check';
BEGIN
  SELECT a.attnum INTO STRICT state_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.channel_conversations'::regclass
    AND a.attname = 'state'
    AND NOT a.attisdropped;

  FOR rec IN
    SELECT c.oid, c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.channel_conversations'::regclass
      AND c.contype = 'c'
      AND c.conkey = ARRAY[state_attnum]::int2[]
  LOOP
    SELECT pg_get_constraintdef(rec.oid) INTO def;
    IF def ILIKE '%awaiting_month_confirmation%' THEN
      expanded_name := rec.conname;
    ELSE
      old_names := array_append(old_names, rec.conname);
    END IF;
  END LOOP;

  IF expanded_name IS NOT NULL THEN
    FOREACH old_name IN ARRAY old_names
    LOOP
      EXECUTE format(
        'ALTER TABLE public.channel_conversations DROP CONSTRAINT %I',
        old_name
      );
    END LOOP;

    IF expanded_name <> canonical_name
       AND NOT EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conrelid = 'public.channel_conversations'::regclass
           AND conname = canonical_name
       )
    THEN
      EXECUTE format(
        'ALTER TABLE public.channel_conversations RENAME CONSTRAINT %I TO %I',
        expanded_name,
        canonical_name
      );
      expanded_name := canonical_name;
    END IF;

    EXECUTE format(
      'COMMENT ON CONSTRAINT %I ON public.channel_conversations IS %L',
      expanded_name,
      'Instagram persona and WhatsApp routing states, including month confirmation.'
    );
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.channel_conversations
    WHERE state NOT IN (
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
      'awaiting_month_confirmation',
      'ticket_open',
      'cancelled',
      'awaiting_persona',
      'awaiting_creator_reason',
      'awaiting_creator_issue_category',
      'creator_campaign_details',
      'creator_issue_details',
      'creator_confirmation',
      'brand_action',
      'agency_details',
      'agency_confirmation',
      'other_inquiry',
      'other_contact',
      'other_confirmation',
      'awaiting_post_completion',
      'completed'
    )
  ) THEN
    RAISE EXCEPTION
      'channel_conversations.state has values outside the expanded allow-list';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.channel_conversations'::regclass
      AND conname = pending_name
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.channel_conversations DROP CONSTRAINT %I',
      pending_name
    );
  END IF;

  ALTER TABLE public.channel_conversations
    ADD CONSTRAINT channel_conversations_state_check_month
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
        'awaiting_month_confirmation',
        'ticket_open',
        'cancelled',
        'awaiting_persona',
        'awaiting_creator_reason',
        'awaiting_creator_issue_category',
        'creator_campaign_details',
        'creator_issue_details',
        'creator_confirmation',
        'brand_action',
        'agency_details',
        'agency_confirmation',
        'other_inquiry',
        'other_contact',
        'other_confirmation',
        'awaiting_post_completion',
        'completed'
      )
    );

  FOREACH old_name IN ARRAY old_names
  LOOP
    EXECUTE format(
      'ALTER TABLE public.channel_conversations DROP CONSTRAINT %I',
      old_name
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.channel_conversations'::regclass
      AND conname = canonical_name
  ) THEN
    ALTER TABLE public.channel_conversations
      RENAME CONSTRAINT channel_conversations_state_check_month
      TO channel_conversations_state_check;
  END IF;

  COMMENT ON CONSTRAINT channel_conversations_state_check ON public.channel_conversations IS
    'Instagram persona and WhatsApp routing states, including month confirmation.';
END $$;

COMMIT;
