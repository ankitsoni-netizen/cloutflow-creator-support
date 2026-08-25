-- Instagram intake session version for restart-safe outbound idempotency.
-- Idempotent and non-destructive: safe to re-run.
-- Do not apply automatically; review before running remotely.

BEGIN;

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS intake_session_version integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_conversations_intake_session_version_check'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_intake_session_version_check
      CHECK (intake_session_version >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.channel_conversations.intake_session_version IS
  'Monotonic Instagram intake session version. Incremented on RESTART, collaboration reclassification to support, and a new support intake after resolve/cancel. Included in chatbot outbound idempotency keys so prompts from a previous session cannot suppress a later session.';

COMMIT;
