-- WATI chatbot durable outbox claim lease.
-- Reuses channel_messages attempt / backoff / raw_payload columns from
-- 20260826120000. Additive and idempotent. Do not apply automatically.
-- Does not change Instagram claim, WhatsApp intake copy, HMAC, or ticket RLS.
--
-- claim_wati_outbound_send takes a durable delivery lease by setting
-- next_attempt_at to p_now + 60 seconds in the same UPDATE that increments
-- attempts. Do not rely on a row lock held only for the RPC transaction:
-- that lock ends when the RPC commits, before the WATI request completes.

BEGIN;

DROP INDEX IF EXISTS public.channel_messages_wati_outbox_due_idx;

CREATE INDEX IF NOT EXISTS channel_messages_wati_outbox_due_idx
  ON public.channel_messages (next_attempt_at NULLS FIRST, created_at)
  WHERE channel = 'whatsapp'
    AND direction = 'outbound'
    AND delivery_status IN ('pending', 'failed')
    AND purpose IS DISTINCT FROM 'staff_reply';

COMMENT ON INDEX public.channel_messages_wati_outbox_due_idx IS
  'Recovery selection for WATI WhatsApp chatbot outbounds: due when next_attempt_at is null or past, ordered by next_attempt_at then created_at.';

CREATE OR REPLACE FUNCTION public.claim_wati_outbound_send(
  p_id uuid,
  p_now timestamptz,
  p_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claimed_attempts integer;
  lease_until timestamptz;
BEGIN
  lease_until := p_now + interval '60 seconds';

  UPDATE public.channel_messages
  SET
    delivery_attempt_count = COALESCE(delivery_attempt_count, 0) + 1,
    last_attempt_at = p_now,
    next_attempt_at = lease_until
  WHERE id = p_id
    AND direction = 'outbound'
    AND channel = 'whatsapp'
    AND purpose IS DISTINCT FROM 'staff_reply'
    AND delivery_status IN ('pending', 'failed')
    AND COALESCE(delivery_attempt_count, 0) < COALESCE(p_max_attempts, 5)
    AND COALESCE(delivery_error_code, '') NOT IN (
      'invalid_recipient',
      'empty_message',
      'whatsapp_provider_not_configured',
      'invalid_wati_conversation_target_mode',
      'token_url_leak_prevented',
      'http_401',
      'http_403',
      'outbound_attempts_exhausted',
      'wati_interactive_body_too_long',
      'wati_interactive_missing_options',
      'wati_interactive_empty_option',
      'wati_interactive_too_many_options',
      'wati_interactive_option_too_long',
      'wati_interactive_unsupported'
    )
    AND (next_attempt_at IS NULL OR next_attempt_at <= p_now)
  RETURNING delivery_attempt_count INTO claimed_attempts;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'attempt_count', claimed_attempts,
    'lease_until', lease_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_wati_outbound_send(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_wati_outbound_send(uuid, timestamptz, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_wati_outbound_send(uuid, timestamptz, integer) IS
  'Atomic delivery lease for a reserved WATI chatbot outbound. One UPDATE ... RETURNING increments attempts, sets last_attempt_at, and sets next_attempt_at to p_now + 60s. Concurrent workers skip while the lease is active. After lease expiry the row may be reclaimed until max attempts or a terminal error. Does not send to WATI.';

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.claim_wati_outbound_send(uuid, timestamptz, integer);
-- DROP INDEX IF EXISTS public.channel_messages_wati_outbox_due_idx;
