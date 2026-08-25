-- Allow nullable creator_email for inbound Instagram tickets.
-- Idempotent and non-destructive: safe to re-run.
-- Does not modify ticket-number / ticket_code generation, ticket RLS, or application code.
-- Do not apply automatically; review before running remotely.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tickets'
      AND column_name = 'creator_email'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.tickets
      ALTER COLUMN creator_email DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.tickets.creator_email IS
  'Creator email when known. Null for inbound Instagram DMs until collected; never filled with fake placeholders.';

COMMIT;
