-- READ ONLY. Do not apply as a migration.
-- SELECT statements only. No UPDATE, INSERT, DELETE, DDL, DO blocks, or functions.
-- SHA-256 fingerprints are truncated to 12 hex characters.
-- Returns ticket_code, status/state, channel/provider, identity_status,
-- linkage/identity booleans, email purpose/status, fingerprints, timestamps.

-- A. Instagram conversations stuck after month Yes skipped Raise ticket.
SELECT
  c.state,
  c.provider,
  c.identity_status,
  (c.ticket_id IS NOT NULL) AS has_ticket_link,
  (c.identity_status IS NOT NULL) AS has_identity_status,
  (c.provider IS NOT NULL) AS has_provider,
  (c.recipient_account_id IS NOT NULL) AS has_recipient_account_id,
  (c.external_contact_id IS NOT NULL) AS has_external_contact_id,
  (
    coalesce(c.collected_data->>'brandName', '') <> ''
    AND coalesce(c.collected_data->>'campaignMonth', '') <> ''
    AND coalesce(c.collected_data->>'email', '') <> ''
    AND coalesce(c.collected_data->>'igIssueCategory', '') <> ''
    AND coalesce(c.collected_data->>'campaignMonthConfirmed', 'false') IN ('true', 't')
  ) AS collected_complete,
  left(
    encode(
      extensions.digest(convert_to(coalesce(c.external_contact_id, ''), 'utf8'), 'sha256'),
      'hex'
    ),
    12
  ) AS contact_fp,
  left(
    encode(
      extensions.digest(convert_to(coalesce(c.external_conversation_id, ''), 'utf8'), 'sha256'),
      'hex'
    ),
    12
  ) AS conversation_fp,
  c.updated_at,
  c.last_activity_at
FROM public.channel_conversations c
WHERE c.channel = 'instagram'
  AND c.state = 'awaiting_post_completion'
  AND c.ticket_id IS NULL
ORDER BY c.last_activity_at DESC NULLS LAST;

-- B. Active Instagram tickets that are unlinked or missing identity_status.
SELECT
  t.ticket_code,
  t.status,
  t.source_channel,
  t.identity_status,
  (t.identity_status IS NOT NULL) AS has_identity_status,
  (t.recipient_account_id IS NOT NULL) AS has_recipient_account_id,
  EXISTS (
    SELECT 1
    FROM public.channel_conversations c
    WHERE c.ticket_id = t.id
  ) AS conversation_linked,
  left(
    encode(
      extensions.digest(convert_to(coalesce(t.external_contact_id, ''), 'utf8'), 'sha256'),
      'hex'
    ),
    12
  ) AS contact_fp,
  left(
    encode(
      extensions.digest(convert_to(coalesce(t.external_conversation_id, ''), 'utf8'), 'sha256'),
      'hex'
    ),
    12
  ) AS conversation_fp,
  t.created_at,
  t.updated_at
FROM public.tickets t
WHERE t.source_channel = 'instagram'
  AND t.status IN ('open', 'in_progress', 'waiting')
  AND (
    t.identity_status IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.channel_conversations c
      WHERE c.ticket_id = t.id
    )
  )
ORDER BY t.created_at DESC;

-- C. WATI acknowledgement emails that failed or are still pending.
SELECT
  t.ticket_code,
  t.status,
  t.source_channel,
  e.purpose,
  e.delivery_status,
  e.error_code,
  e.created_at,
  e.updated_at
FROM public.channel_email_deliveries e
JOIN public.tickets t ON t.id = e.ticket_id
WHERE e.purpose = 'whatsapp-ticket-confirmation'
  AND e.delivery_status IN ('pending', 'failed', 'skipped')
ORDER BY e.updated_at DESC;
