-- Repair using webhook external message IDs + webhook sender.id.
-- Do not apply until 20260828_cf_2026_00027_webhook_identity_audit.sql
-- shows at least two inbound sender fingerprints linked to CF-2026-00027 mids.
-- A prior read-only inspect found original 990905e1e9eb and foreign 92b9b6418888
-- on ticket mids; still do not run this file until that result is reviewed live.
-- Do not use channel_messages.sender_address or timestamps for ownership.
-- Preserves every message. Does not renumber CF-2026-00027.
-- Resolved tickets stay immutable except for this reviewed split.
-- Abort (and ROLLBACK) unless exactly one foreign inbound sender is proven.
--
-- Never returns raw IDs. Internal joins may use sender.id/mid only inside
-- the transaction. Output is ticket codes, counts, and SHA-256 fingerprints.

BEGIN;

WITH ticket AS (
  SELECT
    t.id AS original_ticket_id,
    t.ticket_code,
    t.status,
    t.external_contact_id AS original_contact_id,
    t.external_conversation_id AS original_conversation_key
  FROM public.tickets t
  WHERE t.ticket_code = 'CF-2026-00027'
  FOR UPDATE
),
messaging AS (
  SELECT
    nullif(btrim(item->'sender'->>'id'), '') AS sender_id,
    nullif(btrim(item->'recipient'->>'id'), '') AS recipient_id,
    nullif(
      btrim(coalesce(item->'message'->>'mid', item->'postback'->>'mid')),
      ''
    ) AS message_mid,
    COALESCE(item->'message'->>'is_echo', '') IN ('true', 't')
      OR COALESCE(item->'message'->>'is_self', '') IN ('true', 't') AS is_echo
  FROM public.webhook_events we
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(we.payload->'entry') = 'array' THEN we.payload->'entry'
      ELSE '[]'::jsonb
    END
  ) AS entry
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(entry->'messaging') = 'array' THEN entry->'messaging'
      ELSE '[]'::jsonb
    END
  ) AS item
  WHERE we.provider IN ('meta_instagram', 'instagram', 'meta')
),
linked_inbound AS (
  SELECT
    msg.sender_id,
    msg.recipient_id,
    msg.message_mid
  FROM messaging msg
  JOIN public.channel_messages m
    ON m.external_message_id = msg.message_mid
  JOIN ticket tk
    ON m.ticket_id = tk.original_ticket_id
  WHERE msg.message_mid IS NOT NULL
    AND msg.sender_id IS NOT NULL
    AND NOT msg.is_echo
),
foreign_senders AS (
  SELECT sender_id
  FROM linked_inbound li
  JOIN ticket tk ON true
  WHERE li.sender_id IS DISTINCT FROM tk.original_contact_id
    AND li.sender_id IS DISTINCT FROM li.recipient_id
  GROUP BY sender_id
)
SELECT
  tk.ticket_code,
  tk.status,
  (SELECT count(*) FROM foreign_senders) AS foreign_sender_count,
  (
    SELECT count(DISTINCT sender_id) FROM linked_inbound
  ) AS distinct_linked_inbound_senders
FROM ticket tk;

-- STOP unless foreign_sender_count = 1.
-- The statements below stay commented until that check is reviewed.

-- DO $$
-- DECLARE
--   v_original_ticket uuid;
--   v_original_contact text;
--   v_foreign_contact text;
--   v_recipient text;
--   v_foreign_conversation_key text;
--   v_new_conversation uuid;
--   v_new_ticket uuid;
--   v_new_ticket_code text;
--   v_moved integer;
-- BEGIN
--   SELECT original_ticket_id, original_contact_id
--     INTO v_original_ticket, v_original_contact
--     FROM ticket;
--
--   SELECT sender_id INTO v_foreign_contact FROM foreign_senders;
--   IF NOT FOUND OR v_foreign_contact IS NULL THEN
--     RAISE EXCEPTION 'identity_missing';
--   END IF;
--
--   SELECT recipient_id INTO v_recipient
--     FROM linked_inbound
--    WHERE sender_id = v_foreign_contact
--    GROUP BY recipient_id
--   HAVING count(*) FILTER (WHERE recipient_id IS NOT NULL) > 0;
--
--   IF v_recipient IS NULL OR v_recipient = v_foreign_contact
--      OR v_foreign_contact = v_original_contact THEN
--     RAISE EXCEPTION 'identity_missing';
--   END IF;
--
--   IF (SELECT count(*) FROM foreign_senders) <> 1 THEN
--     RAISE EXCEPTION 'identity_ambiguous';
--   END IF;
--
--   v_foreign_conversation_key := v_recipient || ':' || v_foreign_contact;
--
--   INSERT INTO public.channel_conversations (
--     channel, provider, recipient_account_id, external_contact_id,
--     external_conversation_id, identity_status, state, routing_intent,
--     collected_data, last_message_at, last_activity_at
--   )
--   VALUES (
--     'instagram', 'meta_instagram', v_recipient, v_foreign_contact,
--     v_foreign_conversation_key, 'unambiguous', 'ticket_open', 'unclassified',
--     '{}'::jsonb, now(), now()
--   )
--   ON CONFLICT (channel, external_conversation_id)
--   DO UPDATE SET last_activity_at = public.channel_conversations.last_activity_at
--   RETURNING id INTO v_new_conversation;
--
--   INSERT INTO public.tickets (
--     source_channel, status, priority, assigned_team, request_category,
--     external_contact_id, external_conversation_id, recipient_account_id,
--     identity_status, issue_description
--   )
--   VALUES (
--     'instagram', 'open', 'normal', 'Creator Support', 'creator_support',
--     v_foreign_contact, v_foreign_conversation_key, v_recipient,
--     'unambiguous',
--     'Separated from CF-2026-00027 using webhook message ids.'
--   )
--   RETURNING id, ticket_code INTO v_new_ticket, v_new_ticket_code;
--
--   UPDATE public.channel_conversations
--      SET ticket_id = v_new_ticket
--    WHERE id = v_new_conversation;
--
--   UPDATE public.channel_messages m
--      SET ticket_id = v_new_ticket,
--          conversation_id = v_new_conversation
--    WHERE m.ticket_id = v_original_ticket
--      AND m.external_message_id IN (
--        SELECT message_mid FROM linked_inbound WHERE sender_id = v_foreign_contact
--      );
--   GET DIAGNOSTICS v_moved = ROW_COUNT;
--
--   INSERT INTO public.ticket_events (ticket_id, event_type, actor_name, event_data)
--   VALUES
--     (
--       v_original_ticket,
--       'system_note',
--       'system',
--       jsonb_build_object(
--         'reason', 'identity_split_webhook_mid',
--         'moved_message_count', v_moved,
--         'new_ticket_code', v_new_ticket_code
--       )
--     ),
--     (
--       v_new_ticket,
--       'system_note',
--       'system',
--       jsonb_build_object(
--         'reason', 'identity_split_webhook_mid',
--         'source_ticket_code', 'CF-2026-00027',
--         'moved_message_count', v_moved
--       )
--     );
-- END $$;

ROLLBACK;
