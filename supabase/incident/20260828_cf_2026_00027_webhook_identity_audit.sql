-- READ ONLY. Do not apply as a migration. Do not UPDATE/DELETE/INSERT.
-- SHA-256 identity fingerprints, truncated to 12 hex characters.
-- Never select raw sender/recipient IDs, usernames, emails, phones,
-- message_body, payloads, tokens, URLs, or secrets.
--
-- Hosted webhook_events stores the full Meta envelope in payload jsonb
-- (object + entry + messaging). channel_messages.raw_payload for inbound
-- Instagram rows is a sanitized fragment without sender.id.
-- Timeline sender_address may be collapsed; do not use it for ownership.
--
-- Requires extensions.digest (pgcrypto), available on hosted Supabase.

WITH ticket AS (
  SELECT
    t.id AS ticket_id,
    t.ticket_code,
    t.source_channel,
    t.status,
    t.created_at,
    t.external_contact_id,
    t.external_conversation_id,
    CASE
      WHEN t.external_conversation_id IS NULL THEN 'missing'
      WHEN t.external_contact_id IS NOT NULL
        AND t.external_conversation_id = t.external_contact_id THEN 'legacy_sender'
      WHEN t.external_contact_id IS NOT NULL
        AND t.external_conversation_id LIKE '%:' || t.external_contact_id THEN 'canonical'
      ELSE 'page_or_unscoped'
    END AS conversation_key_kind,
    left(encode(extensions.digest(convert_to(coalesce(t.external_contact_id, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS ticket_contact_fp
  FROM public.tickets t
  WHERE t.ticket_code = 'CF-2026-00027'
),
schema_cols AS (
  SELECT
    c.table_name,
    string_agg(c.column_name, ',' ORDER BY c.ordinal_position) AS columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name IN ('webhook_events', 'channel_messages', 'channel_conversations', 'tickets')
  GROUP BY c.table_name
),
ticket_mids AS (
  SELECT DISTINCT
    m.external_message_id,
    m.direction,
    m.delivery_status,
    m.created_at,
    m.recipient_external_id,
    m.sender_address,
    left(encode(extensions.digest(convert_to(coalesce(m.external_message_id, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS external_message_id_fp,
    left(encode(extensions.digest(convert_to(coalesce(m.recipient_external_id, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS stored_recipient_fp,
    left(encode(extensions.digest(convert_to(coalesce(m.sender_address, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS stored_sender_fp
  FROM public.channel_messages m
  JOIN ticket tk ON tk.ticket_id = m.ticket_id
  WHERE m.external_message_id IS NOT NULL
),
messaging AS (
  SELECT
    we.provider,
    we.received_at,
    we.processing_status,
    we.external_event_id,
    item AS item,
    CASE
      WHEN COALESCE(item->'message'->>'is_echo', '') IN ('true', 't')
        OR COALESCE(item->'message'->>'is_self', '') IN ('true', 't') THEN 'echo'
      WHEN item ? 'postback' OR (item->'message' ? 'quick_reply') THEN 'postback'
      WHEN item ? 'delivery' THEN 'delivery'
      WHEN item ? 'read' THEN 'read'
      WHEN item ? 'message' THEN 'message'
      ELSE 'unknown'
    END AS event_kind,
    nullif(btrim(item->'sender'->>'id'), '') AS sender_id,
    nullif(btrim(item->'recipient'->>'id'), '') AS recipient_id,
    nullif(
      btrim(
        coalesce(
          item->'message'->>'mid',
          item->'postback'->>'mid',
          item->>'mid'
        )
      ),
      ''
    ) AS message_mid
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
    AND jsonb_typeof(we.payload) = 'object'
    AND we.payload ? 'entry'
),
fingerprinted AS (
  SELECT
    m.provider,
    m.received_at,
    m.processing_status,
    m.event_kind,
    left(encode(extensions.digest(convert_to(coalesce(m.external_event_id, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS external_event_id_fp,
    left(encode(extensions.digest(convert_to(coalesce(m.message_mid, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS external_message_id_fp,
    left(encode(extensions.digest(convert_to(coalesce(m.sender_id, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS webhook_sender_fp,
    left(encode(extensions.digest(convert_to(coalesce(m.recipient_id, ''), 'utf8'), 'sha256'), 'hex'), 12)
      AS webhook_recipient_fp,
    tm.direction AS linked_direction,
    tk.ticket_code,
    tk.ticket_contact_fp,
    tk.conversation_key_kind,
    CASE
      WHEN m.sender_id IS NULL THEN NULL
      WHEN tk.external_contact_id IS NULL THEN NULL
      WHEN m.sender_id IS DISTINCT FROM tk.external_contact_id THEN true
      ELSE false
    END AS sender_differs_from_ticket
  FROM messaging m
  CROSS JOIN ticket tk
  LEFT JOIN ticket_mids tm
    ON tm.external_message_id IS NOT NULL
   AND m.message_mid IS NOT NULL
   AND tm.external_message_id = m.message_mid
  WHERE m.received_at >= tk.created_at
     OR tm.direction IS NOT NULL
),
windowed AS (
  SELECT *
  FROM fingerprinted
  WHERE received_at >= timestamptz '2026-08-28 07:45:00+00'
    AND received_at < timestamptz '2026-08-28 08:10:00+00'
)
SELECT
  'schema'::text AS report,
  sc.table_name AS ticket_code,
  NULL::text AS source_channel,
  NULL::text AS status,
  NULL::text AS conversation_key_kind,
  NULL::text AS ticket_contact_fp,
  NULL::text AS extra_fp,
  sc.columns AS metric,
  NULL::timestamptz AS at
FROM schema_cols sc

UNION ALL
SELECT
  'ticket',
  tk.ticket_code,
  tk.source_channel,
  tk.status,
  tk.conversation_key_kind,
  tk.ticket_contact_fp,
  NULL,
  NULL,
  tk.created_at
FROM ticket tk

UNION ALL
SELECT
  'payload_preservation',
  tk.ticket_code,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.webhook_events we
      WHERE we.provider IN ('meta_instagram', 'instagram', 'meta')
        AND jsonb_typeof(we.payload) = 'object'
        AND we.payload ? 'entry'
    ) THEN 'webhook_events.payload_is_meta_envelope'
    ELSE 'webhook_sender_identity_not_preserved'
  END,
  NULL
FROM ticket tk

UNION ALL
SELECT
  'webhook_sender_fps',
  f.ticket_code,
  f.event_kind,
  f.processing_status,
  NULL,
  f.webhook_sender_fp,
  f.webhook_recipient_fp,
  count(*)::text,
  min(f.received_at)
FROM fingerprinted f
WHERE f.webhook_sender_fp IS NOT NULL
GROUP BY f.ticket_code, f.event_kind, f.processing_status, f.webhook_sender_fp, f.webhook_recipient_fp

UNION ALL
SELECT
  'webhook_linked_to_ticket',
  f.ticket_code,
  f.event_kind,
  f.linked_direction,
  f.conversation_key_kind,
  f.ticket_contact_fp,
  f.webhook_sender_fp,
  count(*)::text,
  min(f.received_at)
FROM fingerprinted f
WHERE f.linked_direction IS NOT NULL
GROUP BY f.ticket_code, f.event_kind, f.linked_direction, f.conversation_key_kind, f.ticket_contact_fp, f.webhook_sender_fp

UNION ALL
SELECT
  'window_2026_08_28_0745_0810',
  w.ticket_code,
  w.event_kind,
  w.processing_status,
  CASE WHEN w.sender_differs_from_ticket THEN 'sender_differs' ELSE 'sender_matches_ticket' END,
  w.webhook_sender_fp,
  w.webhook_recipient_fp,
  count(*)::text,
  min(w.received_at)
FROM windowed w
GROUP BY w.ticket_code, w.event_kind, w.processing_status, w.sender_differs_from_ticket, w.webhook_sender_fp, w.webhook_recipient_fp

UNION ALL
SELECT
  'distinct_inbound_senders_on_ticket_mids',
  f.ticket_code,
  NULL,
  NULL,
  NULL,
  f.webhook_sender_fp,
  NULL,
  count(*)::text,
  NULL
FROM fingerprinted f
WHERE f.linked_direction IS NOT NULL
  AND f.event_kind IN ('message', 'postback')
  AND f.webhook_sender_fp IS NOT NULL
GROUP BY f.ticket_code, f.webhook_sender_fp

UNION ALL
SELECT
  'outbound_window_recipients',
  tk.ticket_code,
  m.delivery_status,
  m.purpose,
  CASE
    WHEN m.ticket_id = tk.ticket_id THEN 'on_ticket'
    ELSE 'other_or_unlinked'
  END,
  left(encode(extensions.digest(convert_to(coalesce(m.recipient_external_id, ''), 'utf8'), 'sha256'), 'hex'), 12),
  tk.ticket_contact_fp,
  count(*)::text,
  min(m.created_at)
FROM ticket tk
JOIN public.channel_messages m
  ON m.channel = 'instagram'
 AND m.direction = 'outbound'
 AND m.created_at >= timestamptz '2026-08-28 07:45:00+00'
 AND m.created_at < timestamptz '2026-08-28 08:10:00+00'
GROUP BY tk.ticket_code, m.delivery_status, m.purpose, m.ticket_id, tk.ticket_id, m.recipient_external_id, tk.ticket_contact_fp

UNION ALL
SELECT
  'repair_possible',
  tk.ticket_code,
  NULL,
  NULL,
  tk.conversation_key_kind,
  tk.ticket_contact_fp,
  NULL,
  CASE
    WHEN (
      SELECT count(DISTINCT f.webhook_sender_fp)
      FROM fingerprinted f
      WHERE f.linked_direction IS NOT NULL
        AND f.event_kind IN ('message', 'postback')
        AND f.webhook_sender_fp IS NOT NULL
        AND f.webhook_sender_fp IS DISTINCT FROM tk.ticket_contact_fp
    ) >= 1
    THEN 'deterministic_via_webhook_mid_and_sender_fp'
    ELSE 'cannot_automate_quarantine_timeline'
  END,
  NULL
FROM ticket tk

ORDER BY 1, 2, 9 NULLS LAST;
