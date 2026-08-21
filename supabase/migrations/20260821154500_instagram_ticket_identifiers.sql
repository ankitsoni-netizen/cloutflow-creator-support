-- Instagram DM ticket identifiers and nullable creator identity.
-- Idempotent and non-destructive: safe to re-run.
-- Does not modify ticket-number / ticket_code generation or ticket RLS.
-- Do not apply automatically; review before running remotely.
--
-- Webhook writes continue to use the server-only Supabase admin client.

BEGIN;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS external_contact_id text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS external_conversation_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'creator_name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.tickets
      ALTER COLUMN creator_name DROP NOT NULL;
  END IF;
END $$;

DO $$
DECLARE
  rec record;
  needs_instagram boolean := false;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.tickets'::regclass
      AND c.contype = 'c'
      AND a.attname = 'source_channel'
  LOOP
    IF rec.def NOT ILIKE '%instagram%' THEN
      needs_instagram := true;
      EXECUTE format('ALTER TABLE public.tickets DROP CONSTRAINT %I', rec.conname);
    END IF;
  END LOOP;

  IF needs_instagram AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tickets'::regclass
      AND conname = 'tickets_source_channel_check'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_source_channel_check
      CHECK (
        source_channel IN (
          'phone_call',
          'whatsapp',
          'instagram',
          'website',
          'email'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tickets_instagram_external_conversation_id_idx
  ON public.tickets (source_channel, external_conversation_id)
  WHERE external_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_instagram_external_contact_id_idx
  ON public.tickets (source_channel, external_contact_id)
  WHERE external_contact_id IS NOT NULL;

COMMENT ON COLUMN public.tickets.external_contact_id IS
  'Channel-native sender ID (e.g. Instagram IGSID). Written by the server-only admin client. Null for staff/website tickets.';

COMMENT ON COLUMN public.tickets.external_conversation_id IS
  'Channel-native conversation/thread ID. Written by the server-only admin client. Null for staff/website tickets.';

COMMENT ON COLUMN public.tickets.creator_name IS
  'Creator display name when known. Null until collected for inbound Instagram DMs; never filled with fake placeholders.';

COMMIT;
