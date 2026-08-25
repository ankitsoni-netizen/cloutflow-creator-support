-- Atomically persist the next Instagram conversation snapshot and reserve
-- chatbot outbound rows (idempotency keys) before the Meta send.
-- Optimistic concurrency: the caller must pass the previously observed
-- last_processed_external_message_id. The update succeeds only when the
-- stored value still matches (IS NOT DISTINCT FROM, so null is safe).
-- Idempotent and non-destructive: safe to re-run.
-- Does not implement the conversation reducer, ticket numbering, or RLS.
-- Do not apply automatically; review before running remotely.

BEGIN;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.reserve_instagram_outbound_and_snapshot(
    uuid, text, text, text, text, timestamptz, text, jsonb, uuid, integer, timestamptz, text, jsonb
  ) FROM PUBLIC, anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END $$;

DROP FUNCTION IF EXISTS public.reserve_instagram_outbound_and_snapshot(
  uuid, text, text, text, text, timestamptz, text, jsonb, uuid, integer, timestamptz, text, jsonb
);

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
  existing_purpose text;
  existing_message_body text;
  existing_ticket_id uuid;
  existing_routing_kind text;
  claimed boolean;
  outbound_channel text;
  outbound_ticket_id uuid;
  outbound_sender text;
  outbound_recipient text;
  outbound_routing_kind text;
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
      existing_purpose := NULL;
      existing_message_body := NULL;
      existing_ticket_id := NULL;
      existing_routing_kind := NULL;
      claimed := false;
      outbound_channel := COALESCE(outbound->>'channel', 'instagram');
      outbound_ticket_id := NULLIF(outbound->>'ticket_id', '')::uuid;
      outbound_sender := NULLIF(btrim(COALESCE(outbound->>'sender_address', '')), '');
      outbound_recipient := NULLIF(btrim(COALESCE(outbound->>'recipient_external_id', '')), '');
      outbound_routing_kind := COALESCE(outbound->>'routing_kind', 'support');

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
          routing_kind
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
          outbound_routing_kind
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
            purpose,
            message_body,
            ticket_id,
            routing_kind
            INTO
              existing_id,
              existing_status,
              existing_conversation_id,
              existing_channel,
              existing_recipient_external_id,
              existing_purpose,
              existing_message_body,
              existing_ticket_id,
              existing_routing_kind
          FROM public.channel_messages
          WHERE idempotency_key = outbound->>'idempotency_key'
          LIMIT 1;

          IF existing_id IS NULL
            OR existing_conversation_id IS DISTINCT FROM p_conversation_id
            OR existing_channel IS DISTINCT FROM 'instagram'
            OR outbound_channel IS DISTINCT FROM 'instagram'
            OR existing_recipient_external_id IS DISTINCT FROM outbound_recipient
            OR existing_purpose IS DISTINCT FROM outbound->>'purpose'
            OR existing_message_body IS DISTINCT FROM outbound->>'message_body'
            OR existing_routing_kind IS DISTINCT FROM outbound_routing_kind
            OR existing_ticket_id IS DISTINCT FROM outbound_ticket_id
          THEN
            RAISE EXCEPTION 'outbound_idempotency_conflict';
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
  'Instagram chatbot outbox: persist the next conversation snapshot with optimistic concurrency on last_processed_external_message_id and reserve outbound idempotency keys in one transaction. Outbound sender_address is Cloutflow''s Instagram account id; recipient_external_id is the creator IGSID. Reuses an existing outbound only when conversation, channel, recipient, body, purpose, routing_kind and ticket_id match. Raises conversation_state_conflict, outbound_idempotency_conflict, or outbound_address_invalid. Does not run the routing reducer or send to Meta.';

COMMIT;
