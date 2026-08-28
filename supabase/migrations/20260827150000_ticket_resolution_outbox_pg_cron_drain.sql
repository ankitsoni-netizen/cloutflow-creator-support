-- Ticket resolution outbox recovery scheduler (Supabase pg_cron + pg_net + Vault).
-- Vercel Hobby cron is once daily; this job is the independent safety net.
-- Next.js after() remains the immediate delivery path.
--
-- Do not apply automatically. Enable pg_cron and pg_net in the Supabase
-- dashboard first. Store the drain URL and secret in Vault BEFORE or AFTER
-- this migration — the job reads Vault names at runtime, never literals.
--
-- Vault secret names (create these manually; placeholders only):
--   ticket_resolution_outbox_drain_url
--   ticket_resolution_outbox_drain_secret
--
-- Manual Vault setup (run in the SQL editor; replace placeholders):
--
--   select vault.create_secret(
--     'https://YOUR_VERCEL_HOST/api/internal/tickets/resolution-outbox/drain',
--     'ticket_resolution_outbox_drain_url',
--     'Protected ticket resolution outbox drain URL'
--   );
--
--   select vault.create_secret(
--     'YOUR_TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET',
--     'ticket_resolution_outbox_drain_secret',
--     'Bearer token for ticket resolution outbox drain'
--   );
--
-- Never put the real secret in a migration, repository, or logs.
-- Never log decrypted Vault values, Authorization headers, creator data,
-- message content, email addresses, or phone numbers.
-- net.http_post runs only when both Vault values exist and are non-empty.
-- Missing Vault configuration fails closed: the cron row exists but posts
-- nothing, and ticket resolution itself still succeeds.
-- Idempotent: unschedules the stable job name before rescheduling.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  FOR existing_jobid IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'ticket-resolution-outbox-drain'
  LOOP
    PERFORM cron.unschedule(existing_jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'ticket-resolution-outbox-drain',
  '* * * * *',
  $drain$
  SELECT net.http_post(
    url := drain_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || drain_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 45000
  )
  FROM (
    SELECT
      (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'ticket_resolution_outbox_drain_url'
        LIMIT 1
      ) AS drain_url,
      (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'ticket_resolution_outbox_drain_secret'
        LIMIT 1
      ) AS drain_secret
  ) secrets
  WHERE nullif(btrim(secrets.drain_url), '') IS NOT NULL
    AND nullif(btrim(secrets.drain_secret), '') IS NOT NULL;
  $drain$
);

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; does not delete Vault secrets)
-- ---------------------------------------------------------------------------
-- SELECT cron.unschedule(jobid)
-- FROM cron.job
-- WHERE jobname = 'ticket-resolution-outbox-drain';
