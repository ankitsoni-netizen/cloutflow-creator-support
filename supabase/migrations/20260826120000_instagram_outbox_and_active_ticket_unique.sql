-- Instagram chatbot durable outbox + one-active-ticket uniqueness.
-- Also persists sanitized Instagram quick-reply payloads on reserve.
-- Idempotent and non-destructive: safe to re-run.
-- Do not apply automatically; review before running remotely.
-- Does not modify WhatsApp intake, website tickets, HMAC, RLS policies,
-- or existing ticket workflows beyond the Instagram active-ticket index.
--
-- raw_payload stores only safe Meta send data: message text plus quick-reply
-- titles and payload codes. Never store access tokens, Authorization headers,
-- Graph responses, creator profile payloads, or media URLs.
--
-- claim_instagram_outbound_send takes a durable delivery lease by setting
-- next_attempt_at to p_now + 60 seconds in the same UPDATE that increments
-- attempts. Do not rely on a row lock held only for the RPC transaction:
-- that lock ends when the RPC commits, before the Graph request completes.

BEGIN;

-- ---------------------------------------------------------------------------
-- PREFLIGHT
-- Duplicate active Instagram tickets abort this migration with
-- duplicate_active_instagram_tickets. Do not delete or merge rows here.
-- Inspect with:
--
-- SELECT source_channel, external_conversation_id, count(*)
-- FROM public.tickets
-- WHERE source_channel = 'instagram'
--   AND external_conversation_id IS NOT NULL
--   AND status IN ('open', 'in_progress', 'waiting')
-- GROUP BY 1, 2
-- HAVING count(*) > 1;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Outbox attempt / backoff columns + durable Meta send payload
-- ---------------------------------------------------------------------------

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS delivery_attempt_count integer;
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

ALTER TABLE public.channel_messages
  ALTER COLUMN delivery_attempt_count SET DEFAULT 0;

UPDATE public.channel_messages
SET delivery_attempt_count = 0
WHERE delivery_attempt_count IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.channel_messages
    WHERE delivery_attempt_count IS NULL
  ) THEN
    RAISE EXCEPTION 'delivery_attempt_count_nulls_remain'
      USING HINT = 'Null delivery_attempt_count rows remain after backfill; refuse SET NOT NULL.';
  END IF;
END $$;

ALTER TABLE public.channel_messages
  ALTER COLUMN delivery_attempt_count SET NOT NULL;

COMMENT ON COLUMN public.channel_messages.raw_payload IS
  'Sanitized Instagram chatbot send snapshot: {"text": "...", "quick_replies": [{"content_type":"text","title":"...","payload":"..."}]}. Null on legacy plain-text rows. Must never contain tokens, Authorization headers, Graph responses, profile payloads, or media URLs.';

DROP INDEX IF EXISTS public.channel_messages_instagram_outbox_due_idx;

CREATE INDEX IF NOT EXISTS channel_messages_instagram_outbox_due_idx
  ON public.channel_messages (next_attempt_at NULLS FIRST, created_at)
  WHERE channel = 'instagram'
    AND direction = 'outbound'
    AND delivery_status IN ('pending', 'failed')
    AND purpose IS DISTINCT FROM 'staff_reply';

COMMENT ON INDEX public.channel_messages_instagram_outbox_due_idx IS
  'Recovery selection for Instagram chatbot outbounds: due when next_attempt_at is null or past, ordered by next_attempt_at then created_at.';

-- ---------------------------------------------------------------------------
-- 2. Allowlisted raw_payload sanitizer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sanitize_instagram_outbound_raw_payload(
  p_text text,
  p_raw jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  reply jsonb;
  title text;
  payload text;
  body text;
  kept jsonb := '[]'::jsonb;
  reply_count integer := 0;
BEGIN
  IF p_raw IS NULL OR jsonb_typeof(p_raw) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;

  body := NULLIF(btrim(COALESCE(p_raw->>'text', p_text, '')), '');
  IF body IS NOT NULL THEN
    body := left(body, 1000);
  END IF;

  IF p_raw ? 'quick_replies' AND jsonb_typeof(p_raw->'quick_replies') = 'array' THEN
    FOR reply IN SELECT value FROM jsonb_array_elements(p_raw->'quick_replies')
    LOOP
      EXIT WHEN reply_count >= 13;
      IF jsonb_typeof(reply) IS DISTINCT FROM 'object' THEN
        CONTINUE;
      END IF;
      title := NULLIF(btrim(COALESCE(reply->>'title', '')), '');
      payload := NULLIF(btrim(COALESCE(reply->>'payload', '')), '');
      IF title IS NULL OR payload IS NULL THEN
        CONTINUE;
      END IF;
      title := left(title, 20);
      payload := left(payload, 1000);
      IF payload ~* '^https?://'
        OR payload ~* 'bearer[[:space:]]'
        OR payload ~* 'access_token'
        OR payload ~* 'authorization'
        OR payload ~* 'lookaside\\.fbsbx\\.com'
        OR payload ~* 'graph\\.instagram\\.com'
      THEN
        CONTINUE;
      END IF;
      kept := kept || jsonb_build_array(
        jsonb_build_object(
          'content_type', 'text',
          'title', title,
          'payload', payload
        )
      );
      reply_count := reply_count + 1;
    END LOOP;
  END IF;

  IF jsonb_array_length(kept) > 0 THEN
    RETURN jsonb_build_object(
      'text', COALESCE(body, ''),
      'quick_replies', kept
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_instagram_outbound_raw_payload(text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sanitize_instagram_outbound_raw_payload(text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.sanitize_instagram_outbound_raw_payload(text, jsonb) IS
  'Allowlists Instagram chatbot raw_payload to text plus quick-reply title/payload codes. Drops tokens, Authorization values, and http(s) media URLs. Returns null for plain-text or empty payloads.';

-- ---------------------------------------------------------------------------
-- 3. Durable delivery lease for Instagram chatbot outbounds
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_instagram_outbound_send(
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
    AND channel = 'instagram'
    AND purpose IS DISTINCT FROM 'staff_reply'
    AND delivery_status IN ('pending', 'failed')
    AND COALESCE(delivery_attempt_count, 0) < COALESCE(p_max_attempts, 5)
    AND COALESCE(delivery_error_code, '') NOT IN (
      'messaging_window_expired',
      'instagram_send_not_configured',
      'invalid_recipient',
      'empty_message',
      'graph_190',
      'http_401',
      'http_403',
      'outbound_attempts_exhausted'
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

REVOKE ALL ON FUNCTION public.claim_instagram_outbound_send(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_instagram_outbound_send(uuid, timestamptz, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_instagram_outbound_send(uuid, timestamptz, integer) IS
  'Atomic delivery lease for a reserved Instagram chatbot outbound. One UPDATE ... RETURNING increments attempts, sets last_attempt_at, and sets next_attempt_at to p_now + 60s. Concurrent workers skip while the lease is active. After lease expiry the row may be reclaimed until max attempts or a terminal error. Does not send to Meta.';

-- ---------------------------------------------------------------------------
-- 4. Reserve RPC: persist sanitized raw_payload with outbound rows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_instagram_outbound_and_snapshot(
  p_conversation_id uuid,
  p_state text,
  p_routing_intent text,
  p_current_intake_field text,
  p_last_prompt_key text,
  p_last_activity_at timestamptz,
  p_last_processed_external_message_id text,
  p_expected_last_processed_external_message_id text,
  p_collected_data jsonb,
  p_ticket_id uuid,
  p_intake_session_version integer,
  p_last_message_at timestamptz,
  p_display_name text,
  p_outbounds jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  outbound jsonb;
  inserted_id uuid;
  existing_id uuid;
  existing_status text;
  existing_conversation_id uuid;
  existing_channel text;
  existing_recipient_external_id text;
  existing_sender_address text;
  existing_purpose text;
  existing_message_body text;
  existing_ticket_id uuid;
  existing_routing_kind text;
  existing_raw_payload jsonb;
  existing_sanitized jsonb;
  claimed boolean;
  outbound_channel text;
  outbound_ticket_id uuid;
  outbound_sender text;
  outbound_recipient text;
  outbound_routing_kind text;
  outbound_raw_payload jsonb;
  results jsonb := '[]'::jsonb;
BEGIN
  UPDATE public.channel_conversations
  SET
    last_message_at = p_last_message_at,
    last_activity_at = COALESCE(p_last_activity_at, p_last_message_at),
    state = p_state,
    routing_intent = p_routing_intent,
    current_intake_field = p_current_intake_field,
    last_prompt_key = p_last_prompt_key,
    last_processed_external_message_id = p_last_processed_external_message_id,
    collected_data = COALESCE(p_collected_data, '{}'::jsonb),
    ticket_id = p_ticket_id,
    intake_session_version = COALESCE(p_intake_session_version, 0),
    display_name = COALESCE(NULLIF(btrim(p_display_name), ''), display_name)
  WHERE id = p_conversation_id
    AND last_processed_external_message_id
      IS NOT DISTINCT FROM p_expected_last_processed_external_message_id;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.channel_conversations
      WHERE id = p_conversation_id
    ) THEN
      RAISE EXCEPTION 'conversation_state_conflict';
    END IF;
    RAISE EXCEPTION 'conversation_not_found';
  END IF;

  IF p_outbounds IS NOT NULL AND jsonb_typeof(p_outbounds) = 'array' THEN
    FOR outbound IN SELECT value FROM jsonb_array_elements(p_outbounds)
    LOOP
      inserted_id := NULL;
      existing_id := NULL;
      existing_status := NULL;
      existing_conversation_id := NULL;
      existing_channel := NULL;
      existing_recipient_external_id := NULL;
      existing_sender_address := NULL;
      existing_purpose := NULL;
      existing_message_body := NULL;
      existing_ticket_id := NULL;
      existing_routing_kind := NULL;
      existing_raw_payload := NULL;
      existing_sanitized := NULL;
      claimed := false;
      outbound_channel := COALESCE(outbound->>'channel', 'instagram');
      outbound_ticket_id := NULLIF(outbound->>'ticket_id', '')::uuid;
      outbound_sender := NULLIF(btrim(COALESCE(outbound->>'sender_address', '')), '');
      outbound_recipient := NULLIF(btrim(COALESCE(outbound->>'recipient_external_id', '')), '');
      outbound_routing_kind := COALESCE(outbound->>'routing_kind', 'support');
      outbound_raw_payload := outbound->'raw_payload';
      IF outbound_raw_payload = 'null'::jsonb THEN
        outbound_raw_payload := NULL;
      END IF;
      outbound_raw_payload := public.sanitize_instagram_outbound_raw_payload(
        outbound->>'message_body',
        outbound_raw_payload
      );

      IF outbound_sender IS NULL
        OR outbound_recipient IS NULL
        OR outbound_sender = outbound_recipient
      THEN
        RAISE EXCEPTION 'outbound_address_invalid';
      END IF;

      BEGIN
        INSERT INTO public.channel_messages (
          conversation_id,
          ticket_id,
          channel,
          direction,
          sender_name,
          sender_address,
          recipient_external_id,
          message_body,
          message_type,
          delivery_status,
          idempotency_key,
          purpose,
          routing_kind,
          raw_payload
        )
        VALUES (
          p_conversation_id,
          outbound_ticket_id,
          outbound_channel,
          'outbound',
          'Cloutflow',
          outbound_sender,
          outbound_recipient,
          outbound->>'message_body',
          'text',
          'pending',
          outbound->>'idempotency_key',
          outbound->>'purpose',
          outbound_routing_kind,
          outbound_raw_payload
        )
        RETURNING id INTO inserted_id;
        claimed := true;
      EXCEPTION
        WHEN unique_violation THEN
          SELECT
            id,
            delivery_status,
            conversation_id,
            channel,
            recipient_external_id,
            sender_address,
            purpose,
            message_body,
            ticket_id,
            routing_kind,
            raw_payload
            INTO
              existing_id,
              existing_status,
              existing_conversation_id,
              existing_channel,
              existing_recipient_external_id,
              existing_sender_address,
              existing_purpose,
              existing_message_body,
              existing_ticket_id,
              existing_routing_kind,
              existing_raw_payload
          FROM public.channel_messages
          WHERE idempotency_key = outbound->>'idempotency_key'
          LIMIT 1;

          existing_sanitized := public.sanitize_instagram_outbound_raw_payload(
            existing_message_body,
            existing_raw_payload
          );

          IF existing_id IS NULL
            OR existing_conversation_id IS DISTINCT FROM p_conversation_id
            OR existing_channel IS DISTINCT FROM 'instagram'
            OR outbound_channel IS DISTINCT FROM 'instagram'
            OR existing_recipient_external_id IS DISTINCT FROM outbound_recipient
            OR existing_sender_address IS DISTINCT FROM outbound_sender
            OR existing_purpose IS DISTINCT FROM outbound->>'purpose'
            OR existing_message_body IS DISTINCT FROM outbound->>'message_body'
            OR existing_routing_kind IS DISTINCT FROM outbound_routing_kind
            OR existing_ticket_id IS DISTINCT FROM outbound_ticket_id
            OR (
              existing_sanitized IS NOT NULL
              AND outbound_raw_payload IS NOT NULL
              AND existing_sanitized IS DISTINCT FROM outbound_raw_payload
            )
          THEN
            RAISE EXCEPTION 'outbound_idempotency_conflict';
          END IF;

          IF existing_raw_payload IS NULL AND outbound_raw_payload IS NOT NULL THEN
            UPDATE public.channel_messages
            SET raw_payload = outbound_raw_payload
            WHERE id = existing_id
              AND conversation_id IS NOT DISTINCT FROM p_conversation_id
              AND channel = 'instagram'
              AND recipient_external_id IS NOT DISTINCT FROM outbound_recipient
              AND sender_address IS NOT DISTINCT FROM outbound_sender
              AND purpose IS NOT DISTINCT FROM outbound->>'purpose'
              AND message_body IS NOT DISTINCT FROM outbound->>'message_body'
              AND routing_kind IS NOT DISTINCT FROM outbound_routing_kind
              AND ticket_id IS NOT DISTINCT FROM outbound_ticket_id
              AND raw_payload IS NULL;
          END IF;
      END;

      IF claimed THEN
        results := results || jsonb_build_array(
          jsonb_build_object(
            'id', inserted_id,
            'idempotency_key', outbound->>'idempotency_key',
            'delivery_status', 'pending',
            'claimed', true
          )
        );
      ELSE
        results := results || jsonb_build_array(
          jsonb_build_object(
            'id', existing_id,
            'idempotency_key', outbound->>'idempotency_key',
            'delivery_status', COALESCE(existing_status, 'pending'),
            'claimed', false
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('outbounds', results);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_instagram_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_instagram_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.reserve_instagram_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb
) IS
  'Instagram chatbot outbox: persist the next conversation snapshot with optimistic concurrency on last_processed_external_message_id and reserve outbound idempotency keys in one transaction. Stores sanitize_instagram_outbound_raw_payload output only. Reuses an existing outbound only when conversation, channel, recipient, sender_address, body, purpose, routing_kind, ticket_id and (when both sanitized payloads are non-null) raw_payload match. Legacy null raw_payload remains compatible. Backfill of a legacy null payload is scoped to that identity including sender_address. Raises conversation_state_conflict, outbound_idempotency_conflict, or outbound_address_invalid. Does not run the routing reducer or send to Meta.';

-- ---------------------------------------------------------------------------
-- 5. One active Instagram ticket per external conversation
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  duplicate_groups integer := 0;
BEGIN
  SELECT count(*)
  INTO duplicate_groups
  FROM (
    SELECT 1
    FROM public.tickets
    WHERE source_channel = 'instagram'
      AND external_conversation_id IS NOT NULL
      AND status IN ('open', 'in_progress', 'waiting')
    GROUP BY source_channel, external_conversation_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'duplicate_active_instagram_tickets'
      USING HINT = 'Resolve duplicate active Instagram tickets before creating tickets_instagram_one_active_conversation_idx. This migration does not delete, merge, or resolve tickets.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_instagram_one_active_conversation_idx
  ON public.tickets (source_channel, external_conversation_id)
  WHERE source_channel = 'instagram'
    AND external_conversation_id IS NOT NULL
    AND status IN ('open', 'in_progress', 'waiting');

COMMENT ON INDEX public.tickets_instagram_one_active_conversation_idx IS
  'At most one active Instagram support ticket per external_conversation_id. Aborts with duplicate_active_instagram_tickets when preflight finds duplicates. Resolved tickets are excluded.';

COMMIT;
