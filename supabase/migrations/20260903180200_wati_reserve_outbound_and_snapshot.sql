-- WATI chatbot atomic snapshot + outbound reservation.
-- Additive and idempotent. Do not apply automatically.
-- Does not change Instagram reserve, Meta WhatsApp intake, HMAC, or ticket RLS.
--
-- reserve_wati_outbound_and_snapshot updates the conversation snapshot with
-- optimistic concurrency on last_processed_external_message_id and inserts
-- sanitized WhatsApp chatbot outbounds in the same transaction.
-- If outbound insert fails, the snapshot update rolls back.
-- If OCC fails, no outbound row is inserted.

BEGIN;

CREATE OR REPLACE FUNCTION public.sanitize_wati_outbound_raw_payload(
  p_text text,
  p_raw jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
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
        OR payload ~* 'wati\\.io'
        OR payload ~* 'api\\.wati'
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

REVOKE ALL ON FUNCTION public.sanitize_wati_outbound_raw_payload(text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sanitize_wati_outbound_raw_payload(text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.sanitize_wati_outbound_raw_payload(text, jsonb) IS
  'Allowlists WATI chatbot raw_payload to text plus quick-reply title/payload codes. Drops tokens, Authorization values, and endpoint URLs. Returns null for plain-text or empty payloads. Never returns creator PII beyond the allowlisted send plan.';

CREATE OR REPLACE FUNCTION public.reserve_wati_outbound_and_snapshot(
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
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  outbound jsonb;
  inserted_id uuid;
  existing_id uuid;
  existing_status text;
  existing_conversation_id uuid;
  existing_channel text;
  existing_recipient_external_id text;
  existing_purpose text;
  existing_message_body text;
  existing_ticket_id uuid;
  existing_routing_kind text;
  existing_raw_payload jsonb;
  existing_sanitized jsonb;
  claimed boolean;
  any_claimed boolean := false;
  outbound_channel text;
  outbound_ticket_id uuid;
  outbound_sender text;
  outbound_recipient text;
  outbound_routing_kind text;
  outbound_raw_payload jsonb;
  outbound_idempotency text;
  conversation_channel text;
  conversation_provider text;
  results jsonb := '[]'::jsonb;
BEGIN
  IF p_outbounds IS NOT NULL AND jsonb_typeof(p_outbounds) = 'array' THEN
    FOR outbound IN SELECT value FROM jsonb_array_elements(p_outbounds)
    LOOP
      outbound_channel := COALESCE(outbound->>'channel', '');
      outbound_idempotency := NULLIF(btrim(COALESCE(outbound->>'idempotency_key', '')), '');
      outbound_recipient := NULLIF(btrim(COALESCE(outbound->>'recipient_external_id', '')), '');
      IF outbound_channel IS DISTINCT FROM 'whatsapp' THEN
        RAISE EXCEPTION 'invalid_channel';
      END IF;
      IF outbound_idempotency IS NULL THEN
        RAISE EXCEPTION 'missing_idempotency_key';
      END IF;
      IF outbound_recipient IS NULL THEN
        RAISE EXCEPTION 'outbound_address_invalid';
      END IF;
    END LOOP;
  END IF;

  SELECT c.channel, c.provider
    INTO conversation_channel, conversation_provider
  FROM public.channel_conversations AS c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found';
  END IF;

  IF conversation_channel IS DISTINCT FROM 'whatsapp' THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  IF conversation_provider IS DISTINCT FROM 'wati' THEN
    RAISE EXCEPTION 'invalid_provider';
  END IF;

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
    RAISE EXCEPTION 'conversation_state_conflict';
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
      existing_purpose := NULL;
      existing_message_body := NULL;
      existing_ticket_id := NULL;
      existing_routing_kind := NULL;
      existing_raw_payload := NULL;
      existing_sanitized := NULL;
      claimed := false;
      outbound_channel := COALESCE(outbound->>'channel', 'whatsapp');
      outbound_ticket_id := NULLIF(outbound->>'ticket_id', '')::uuid;
      outbound_sender := NULLIF(btrim(COALESCE(outbound->>'sender_address', '')), '');
      outbound_recipient := NULLIF(btrim(COALESCE(outbound->>'recipient_external_id', '')), '');
      outbound_routing_kind := COALESCE(outbound->>'routing_kind', 'support');
      outbound_idempotency := NULLIF(btrim(COALESCE(outbound->>'idempotency_key', '')), '');
      outbound_raw_payload := outbound->'raw_payload';
      IF outbound_raw_payload = 'null'::jsonb THEN
        outbound_raw_payload := NULL;
      END IF;
      outbound_raw_payload := public.sanitize_wati_outbound_raw_payload(
        outbound->>'message_body',
        outbound_raw_payload
      );

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
          'whatsapp',
          'outbound',
          'Cloutflow',
          outbound_sender,
          outbound_recipient,
          outbound->>'message_body',
          'text',
          'pending',
          outbound_idempotency,
          outbound->>'purpose',
          outbound_routing_kind,
          outbound_raw_payload
        )
        RETURNING id INTO inserted_id;
        claimed := true;
        any_claimed := true;
      EXCEPTION
        WHEN unique_violation THEN
          SELECT
            id,
            delivery_status,
            conversation_id,
            channel,
            recipient_external_id,
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
              existing_purpose,
              existing_message_body,
              existing_ticket_id,
              existing_routing_kind,
              existing_raw_payload
          FROM public.channel_messages
          WHERE idempotency_key = outbound_idempotency
          LIMIT 1;

          existing_sanitized := public.sanitize_wati_outbound_raw_payload(
            existing_message_body,
            existing_raw_payload
          );

          IF existing_id IS NULL
            OR existing_conversation_id IS DISTINCT FROM p_conversation_id
            OR existing_channel IS DISTINCT FROM 'whatsapp'
            OR outbound_channel IS DISTINCT FROM 'whatsapp'
            OR existing_recipient_external_id IS DISTINCT FROM outbound_recipient
            OR existing_purpose IS DISTINCT FROM outbound->>'purpose'
            OR existing_message_body IS DISTINCT FROM outbound->>'message_body'
            OR COALESCE(existing_routing_kind, 'support')
              IS DISTINCT FROM outbound_routing_kind
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
              AND channel = 'whatsapp'
              AND recipient_external_id IS NOT DISTINCT FROM outbound_recipient
              AND purpose IS NOT DISTINCT FROM outbound->>'purpose'
              AND message_body IS NOT DISTINCT FROM outbound->>'message_body'
              AND COALESCE(routing_kind, 'support')
                IS NOT DISTINCT FROM outbound_routing_kind
              AND ticket_id IS NOT DISTINCT FROM outbound_ticket_id
              AND raw_payload IS NULL;
          END IF;
      END;

      IF claimed THEN
        results := results || jsonb_build_array(
          jsonb_build_object(
            'id', inserted_id,
            'idempotency_key', outbound_idempotency,
            'delivery_status', 'pending',
            'claimed', true
          )
        );
      ELSE
        results := results || jsonb_build_array(
          jsonb_build_object(
            'id', existing_id,
            'idempotency_key', outbound_idempotency,
            'delivery_status', COALESCE(existing_status, 'pending'),
            'claimed', false
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN any_claimed THEN 'reserved' ELSE 'existing' END,
    'outbounds', results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_wati_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_wati_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.reserve_wati_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb
) IS
  'WATI chatbot outbox: persist the next conversation snapshot with optimistic concurrency on last_processed_external_message_id and reserve outbound idempotency keys in one transaction. Requires channel=whatsapp and provider=wati. Stores sanitize_wati_outbound_raw_payload output only. Reuses an existing outbound only when conversation, channel, recipient, body, purpose, routing_kind (null treated as support), ticket_id and (when both sanitized payloads are non-null) raw_payload match. A sent/delivered/read row is returned as existing and is not reclaimed. Raises conversation_state_conflict, outbound_idempotency_conflict, outbound_address_invalid, invalid_channel, invalid_provider, missing_idempotency_key, or conversation_not_found. Return payload is ids/status only. Does not send to WATI.';

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.reserve_wati_outbound_and_snapshot(uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, integer, timestamptz, text, jsonb);
-- DROP FUNCTION IF EXISTS public.sanitize_wati_outbound_raw_payload(text, jsonb);
