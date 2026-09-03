-- READ ONLY. Do not apply as a migration.
-- SELECT/WITH only. No INSERT, UPDATE, DELETE, DDL, DO blocks, RPC, or repair.
-- One result table. SHA-256 fingerprints truncated to 12 hex characters.
-- No raw IDs, usernames, phones, emails, text, payloads, URLs, or tokens.
--
-- Correlation rules (never latest-provider / latest-channel / time-only):
--   Instagram webhook: provider family + recipient page + sender IGSID
--     + message/event id when that id is stored on a conversation.
--   WATI webhook: provider=wati + receiving account + sender id
--     + message/event id when that id is stored on a conversation.
--   Final-summary outbound: this conversation + creator_confirm key only.
--   Ticket-closing outbound / confirmation email: linked ticket id, or
--     exactly one identity-proven active candidate, plus that ticket's key.
--
-- Candidate proof matches application findActiveTicketForIdentity Phase C:
--   source_channel, stable sender, active status, identity_status=unambiguous,
--   recipient account does not conflict, conversation key is canonical
--   {recipient}:{sender} or proven sender-only legacy. No username/email/latest.
--
-- Rejection diagnostics (counts are per conversation; never leak identifiers):
--   structural_active: source_channel + stable sender + active status
--   unproven_identity / recipient_conflict / conversation_key_mismatch:
--     subsets of structural_active
--   inactive_exact: identity-proven but not active
--   candidate_rejection_reason: none | no_structural_ticket | identity_unproven
--     | recipient_conflict | conversation_key_mismatch | inactive_ticket
--     | multiple_candidates (comma-separated when several apply)

WITH recent_creator_flows AS (
  SELECT
    c.id AS conversation_pk,
    c.ticket_id AS linked_ticket_pk,
    t.ticket_code,
    c.provider,
    c.channel,
    c.state AS conversation_state,
    (c.ticket_id IS NOT NULL) AS has_ticket_link,
    t.status AS ticket_status,
    t.identity_status,
    c.updated_at AS conversation_updated_at,
    t.created_at AS ticket_created_at,
    c.external_contact_id,
    c.external_conversation_id,
    c.recipient_account_id,
    c.last_processed_external_message_id
  FROM public.channel_conversations c
  LEFT JOIN public.tickets t
    ON t.id = c.ticket_id
  WHERE c.channel IN ('instagram', 'whatsapp')
    AND c.updated_at > now() - interval '14 days'
    AND (
      c.state IN (
        'creator_confirmation',
        'awaiting_month_confirmation',
        'creator_campaign_details',
        'awaiting_post_completion'
      )
      OR t.id IS NOT NULL
    )
),
structural_active_tickets AS (
  SELECT
    f.conversation_pk,
    x.id AS ticket_pk,
    x.ticket_code,
    x.status,
    x.identity_status,
    (
      x.identity_status IS NULL
      OR x.identity_status IS DISTINCT FROM 'unambiguous'
    ) AS identity_unproven,
    (
      x.recipient_account_id IS NOT NULL
      AND f.recipient_account_id IS NOT NULL
      AND x.recipient_account_id IS DISTINCT FROM f.recipient_account_id
    ) AS recipient_conflicts,
    (
      x.external_conversation_id = f.external_conversation_id
      OR (
        f.recipient_account_id IS NOT NULL
        AND f.recipient_account_id IS DISTINCT FROM f.external_contact_id
        AND x.external_conversation_id =
          f.recipient_account_id || ':' || f.external_contact_id
      )
      OR (
        x.identity_status = 'unambiguous'
        AND x.external_conversation_id = f.external_contact_id
        AND x.external_conversation_id IS DISTINCT FROM f.recipient_account_id
      )
    ) AS conversation_key_ok
  FROM recent_creator_flows f
  INNER JOIN public.tickets x
    ON x.source_channel = f.channel
    AND x.external_contact_id = f.external_contact_id
    AND x.status IN ('open', 'in_progress', 'waiting')
),
inactive_exact_tickets AS (
  SELECT
    f.conversation_pk,
    x.id AS ticket_pk
  FROM recent_creator_flows f
  INNER JOIN public.tickets x
    ON x.source_channel = f.channel
    AND x.external_contact_id = f.external_contact_id
    AND x.status NOT IN ('open', 'in_progress', 'waiting')
    AND x.identity_status = 'unambiguous'
    AND (
      x.recipient_account_id IS NULL
      OR f.recipient_account_id IS NULL
      OR x.recipient_account_id = f.recipient_account_id
    )
    AND (
      x.external_conversation_id = f.external_conversation_id
      OR (
        f.recipient_account_id IS NOT NULL
        AND f.recipient_account_id IS DISTINCT FROM f.external_contact_id
        AND x.external_conversation_id =
          f.recipient_account_id || ':' || f.external_contact_id
      )
      OR (
        x.external_conversation_id = f.external_contact_id
        AND x.external_conversation_id IS DISTINCT FROM f.recipient_account_id
      )
    )
),
exact_ticket_candidates AS (
  SELECT
    s.conversation_pk,
    s.ticket_pk AS candidate_ticket_pk,
    s.ticket_code AS candidate_ticket_code,
    s.status AS candidate_ticket_status,
    s.identity_status AS candidate_ticket_identity_status
  FROM structural_active_tickets s
  WHERE NOT s.identity_unproven
    AND NOT s.recipient_conflicts
    AND s.conversation_key_ok
),
exact_ticket_counts AS (
  SELECT
    conversation_pk,
    count(candidate_ticket_pk)::int AS exact_ticket_candidate_count
  FROM exact_ticket_candidates
  GROUP BY conversation_pk
),
structural_ticket_counts AS (
  SELECT
    conversation_pk,
    count(ticket_pk)::int AS structural_active_ticket_count,
    count(ticket_pk) FILTER (WHERE identity_unproven)::int
      AS unproven_identity_ticket_count,
    count(ticket_pk) FILTER (WHERE recipient_conflicts)::int
      AS recipient_conflict_ticket_count,
    count(ticket_pk) FILTER (WHERE NOT conversation_key_ok)::int
      AS conversation_key_mismatch_ticket_count
  FROM structural_active_tickets
  GROUP BY conversation_pk
),
inactive_exact_counts AS (
  SELECT
    conversation_pk,
    count(ticket_pk)::int AS inactive_exact_ticket_count
  FROM inactive_exact_tickets
  GROUP BY conversation_pk
),
rejection_reasons AS (
  SELECT
    f.conversation_pk,
    CASE
      WHEN coalesce(n.exact_ticket_candidate_count, 0) = 1 THEN 'none'
      WHEN coalesce(n.exact_ticket_candidate_count, 0) > 1 THEN 'multiple_candidates'
      WHEN coalesce(st.structural_active_ticket_count, 0) = 0
        AND coalesce(i.inactive_exact_ticket_count, 0) > 0 THEN 'inactive_ticket'
      WHEN coalesce(st.structural_active_ticket_count, 0) = 0 THEN 'no_structural_ticket'
      ELSE nullif(
        concat_ws(
          ',',
          CASE
            WHEN coalesce(st.unproven_identity_ticket_count, 0) > 0
              THEN 'identity_unproven'
          END,
          CASE
            WHEN coalesce(st.recipient_conflict_ticket_count, 0) > 0
              THEN 'recipient_conflict'
          END,
          CASE
            WHEN coalesce(st.conversation_key_mismatch_ticket_count, 0) > 0
              THEN 'conversation_key_mismatch'
          END
        ),
        ''
      )
    END AS candidate_rejection_reason
  FROM recent_creator_flows f
  LEFT JOIN exact_ticket_counts n ON n.conversation_pk = f.conversation_pk
  LEFT JOIN structural_ticket_counts st ON st.conversation_pk = f.conversation_pk
  LEFT JOIN inactive_exact_counts i ON i.conversation_pk = f.conversation_pk
),
unique_candidates AS (
  SELECT
    c.conversation_pk,
    c.candidate_ticket_pk,
    c.candidate_ticket_code,
    c.candidate_ticket_status,
    c.candidate_ticket_identity_status
  FROM exact_ticket_candidates c
  INNER JOIN exact_ticket_counts n
    ON n.conversation_pk = c.conversation_pk
    AND n.exact_ticket_candidate_count = 1
),
proven_tickets AS (
  SELECT
    f.conversation_pk,
    coalesce(f.linked_ticket_pk, u.candidate_ticket_pk) AS proven_ticket_pk
  FROM recent_creator_flows f
  LEFT JOIN unique_candidates u ON u.conversation_pk = f.conversation_pk
),
instagram_webhook_items AS (
  SELECT
    we.provider,
    we.processing_status,
    we.error_code,
    we.updated_at,
    we.external_event_id,
    nullif(btrim(item->'sender'->>'id'), '') AS sender_id,
    nullif(btrim(item->'recipient'->>'id'), '') AS recipient_id,
    nullif(
      btrim(
        coalesce(
          item->'message'->>'mid',
          item->'postback'->>'mid',
          we.external_event_id
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
  WHERE we.updated_at > now() - interval '14 days'
    AND jsonb_typeof(we.payload) = 'object'
    AND (
      we.provider IN ('meta_instagram', 'instagram')
      OR (
        we.provider = 'meta'
        AND we.payload->>'object' = 'instagram'
      )
    )
),
wati_webhook_items AS (
  SELECT
    we.provider,
    we.processing_status,
    we.error_code,
    we.updated_at,
    we.external_event_id,
    nullif(btrim(we.payload->>'waId'), '') AS sender_id,
    nullif(
      regexp_replace(
        coalesce(btrim(we.payload->>'channelPhoneNumber'), ''),
        '[^0-9]',
        '',
        'g'
      ),
      ''
    ) AS recipient_id,
    nullif(
      btrim(
        coalesce(
          we.payload->>'whatsappMessageId',
          we.external_event_id
        )
      ),
      ''
    ) AS message_mid
  FROM public.webhook_events we
  WHERE we.updated_at > now() - interval '14 days'
    AND we.provider = 'wati'
    AND jsonb_typeof(we.payload) = 'object'
),
webhook_items AS (
  SELECT * FROM instagram_webhook_items
  UNION ALL
  SELECT * FROM wati_webhook_items
),
identity_webhooks AS (
  SELECT
    f.conversation_pk,
    w.processing_status,
    w.error_code,
    w.updated_at
  FROM recent_creator_flows f
  INNER JOIN webhook_items w
    ON w.provider = f.provider
    AND w.sender_id = f.external_contact_id
    AND w.recipient_id = f.recipient_account_id
    AND w.sender_id IS NOT NULL
    AND w.recipient_id IS NOT NULL
    AND (
      w.message_mid IS NULL
      OR w.message_mid = f.last_processed_external_message_id
      OR EXISTS (
        SELECT 1
        FROM public.channel_messages inbound
        WHERE inbound.conversation_id = f.conversation_pk
          AND inbound.direction = 'inbound'
          AND inbound.external_message_id = w.message_mid
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.channel_messages inbound_any
        WHERE inbound_any.direction = 'inbound'
          AND inbound_any.external_message_id = w.message_mid
      )
    )
),
webhooks AS (
  SELECT DISTINCT ON (conversation_pk)
    conversation_pk,
    processing_status AS webhook_processing_status,
    error_code AS webhook_error_code,
    updated_at AS webhook_updated_at
  FROM identity_webhooks
  ORDER BY conversation_pk, updated_at DESC
),
final_summary_outbounds AS (
  SELECT
    m.conversation_id,
    max(m.delivery_status) AS final_summary_outbound_status
  FROM public.channel_messages m
  WHERE m.direction = 'outbound'
    AND m.created_at > now() - interval '14 days'
    AND (
      m.purpose LIKE 'creator_confirm%'
      OR m.idempotency_key LIKE '%creator_confirm%'
    )
    AND coalesce(m.purpose, '') NOT LIKE 'ticket_created%'
    AND coalesce(m.idempotency_key, '') NOT LIKE '%ticket_created%'
    AND coalesce(m.idempotency_key, '') NOT LIKE '%ticket:%:created%'
  GROUP BY m.conversation_id
),
closing_outbounds AS (
  SELECT
    m.conversation_id,
    max(m.delivery_status) AS ticket_closing_outbound_status
  FROM public.channel_messages m
  INNER JOIN proven_tickets p
    ON p.conversation_pk = m.conversation_id
    AND p.proven_ticket_pk IS NOT NULL
  WHERE m.direction = 'outbound'
    AND m.created_at > now() - interval '14 days'
    AND (
      m.idempotency_key LIKE '%ticket_created:' || p.proven_ticket_pk::text || '%'
      OR m.idempotency_key LIKE '%ticket:' || p.proven_ticket_pk::text || ':created%'
      OR (
        m.ticket_id = p.proven_ticket_pk
        AND (
          m.purpose LIKE 'ticket_created%'
          OR m.idempotency_key LIKE '%ticket_created%'
          OR m.idempotency_key LIKE '%ticket:%:created%'
        )
      )
    )
  GROUP BY m.conversation_id
),
emails AS (
  SELECT DISTINCT ON (p.conversation_pk)
    p.conversation_pk,
    e.purpose AS email_purpose,
    e.delivery_status AS email_status,
    e.error_code AS email_error_code,
    e.updated_at AS email_updated_at
  FROM proven_tickets p
  INNER JOIN public.channel_email_deliveries e
    ON e.ticket_id = p.proven_ticket_pk
  WHERE p.proven_ticket_pk IS NOT NULL
    AND e.purpose IN (
      'instagram-ticket-confirmation',
      'whatsapp-ticket-confirmation'
    )
    AND (
      e.idempotency_key = 'email:ig-confirm:' || p.proven_ticket_pk::text
      OR e.idempotency_key = 'email:wa-confirm:' || p.proven_ticket_pk::text
    )
  ORDER BY p.conversation_pk, e.updated_at DESC
)
SELECT
  f.ticket_code,
  f.provider,
  f.channel,
  f.conversation_state,
  f.has_ticket_link,
  coalesce(n.exact_ticket_candidate_count, 0) AS exact_ticket_candidate_count,
  coalesce(st.structural_active_ticket_count, 0) AS structural_active_ticket_count,
  coalesce(st.unproven_identity_ticket_count, 0) AS unproven_identity_ticket_count,
  coalesce(st.recipient_conflict_ticket_count, 0) AS recipient_conflict_ticket_count,
  coalesce(st.conversation_key_mismatch_ticket_count, 0)
    AS conversation_key_mismatch_ticket_count,
  coalesce(i.inactive_exact_ticket_count, 0) AS inactive_exact_ticket_count,
  r.candidate_rejection_reason,
  f.ticket_status,
  f.identity_status,
  u.candidate_ticket_code,
  u.candidate_ticket_status,
  u.candidate_ticket_identity_status,
  s.final_summary_outbound_status,
  k.ticket_closing_outbound_status,
  e.email_purpose,
  e.email_status,
  e.email_error_code,
  w.webhook_processing_status,
  w.webhook_error_code,
  f.conversation_updated_at,
  f.ticket_created_at,
  e.email_updated_at,
  w.webhook_updated_at,
  left(
    encode(
      extensions.digest(convert_to(coalesce(f.external_contact_id, ''), 'utf8'), 'sha256'),
      'hex'
    ),
    12
  ) AS contact_fp,
  left(
    encode(
      extensions.digest(convert_to(coalesce(f.external_conversation_id, ''), 'utf8'), 'sha256'),
      'hex'
    ),
    12
  ) AS conversation_fp
FROM recent_creator_flows f
LEFT JOIN exact_ticket_counts n ON n.conversation_pk = f.conversation_pk
LEFT JOIN structural_ticket_counts st ON st.conversation_pk = f.conversation_pk
LEFT JOIN inactive_exact_counts i ON i.conversation_pk = f.conversation_pk
LEFT JOIN rejection_reasons r ON r.conversation_pk = f.conversation_pk
LEFT JOIN unique_candidates u ON u.conversation_pk = f.conversation_pk
LEFT JOIN final_summary_outbounds s ON s.conversation_id = f.conversation_pk
LEFT JOIN closing_outbounds k ON k.conversation_id = f.conversation_pk
LEFT JOIN emails e ON e.conversation_pk = f.conversation_pk
LEFT JOIN webhooks w ON w.conversation_pk = f.conversation_pk
ORDER BY f.conversation_updated_at DESC
LIMIT 200;
