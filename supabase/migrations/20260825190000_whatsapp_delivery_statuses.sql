-- WhatsApp Cloud API delivery statuses for channel_messages.
-- Idempotent and non-destructive: safe to re-run.
-- Do not apply automatically; review before running remotely.

BEGIN;

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
        'read',
        'failed',
        'queued',
        'deleted'
      )
    );
END $$;

COMMENT ON CONSTRAINT channel_messages_delivery_status_check ON public.channel_messages IS
  'Includes WhatsApp Cloud API sent/delivered/read/failed/deleted statuses.';

COMMIT;
