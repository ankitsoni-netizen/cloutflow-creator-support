-- Phase B: additive identity columns + classified backfill.
-- Compatible with Phase A application code (does not require the app to
-- select identity_status, provider, or recipient_account_id).
-- Deploy Phase A first. Do not deploy Phase C until this migration is applied.
--
-- Idempotent and non-destructive. Do not apply automatically.
-- Backfills only provable identities. Mixed or unproven rows are
-- ambiguous/quarantined. Resolved tickets do not have identity keys rewritten.
-- Unique indexes apply only to unambiguous identities.
--
-- Lock bounding: nullable ADD COLUMN is metadata-only. Payload extract is
-- written to a temp table before ticket/conversation UPDATEs so the
-- webhook scan does not sit behind ACCESS EXCLUSIVE. lock_timeout and
-- statement_timeout abort rather than wait indefinitely.

SET lock_timeout = '15s';
SET statement_timeout = '10min';

ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS recipient_account_id text;
ALTER TABLE public.channel_conversations
  ADD COLUMN IF NOT EXISTS identity_status text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS recipient_account_id text;
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS identity_status text;

COMMENT ON COLUMN public.channel_conversations.provider IS
  'Webhook provider (meta_instagram, meta_whatsapp, wati). Not PII.';
COMMENT ON COLUMN public.channel_conversations.recipient_account_id IS
  'Receiving business/page/channel id. Not the creator.';
COMMENT ON COLUMN public.channel_conversations.identity_status IS
  'unambiguous, ambiguous, or quarantined. Quarantined rows must not send outbound replies.';
COMMENT ON COLUMN public.tickets.recipient_account_id IS
  'Receiving business/page/channel id copied from a proven conversation identity.';
COMMENT ON COLUMN public.tickets.identity_status IS
  'unambiguous, ambiguous, or quarantined. Outbound replies require unambiguous.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'channel_conversations_identity_status_check'
      AND conrelid = 'public.channel_conversations'::regclass
  ) THEN
    ALTER TABLE public.channel_conversations
      ADD CONSTRAINT channel_conversations_identity_status_check
      CHECK (
        identity_status IS NULL
        OR identity_status IN ('unambiguous', 'ambiguous', 'quarantined')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tickets_identity_status_check'
      AND conrelid = 'public.tickets'::regclass
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_identity_status_check
      CHECK (
        identity_status IS NULL
        OR identity_status IN ('unambiguous', 'ambiguous', 'quarantined')
      );
  END IF;
END $$;

-- Classify from webhook envelopes. Echo senders are the page, not creators.
-- Extract mids into a temp table first (no ticket row locks during the scan).
-- Distinct inbound senders on a ticket's stored external_message_ids decide
-- quarantine vs unambiguous. No username/email/campaign matching.
CREATE TEMP TABLE IF NOT EXISTS tmp_cf_webhook_messaging (
  sender_id text,
  recipient_id text,
  message_mid text,
  is_echo boolean
) ON COMMIT PRESERVE ROWS;

TRUNCATE tmp_cf_webhook_messaging;

INSERT INTO tmp_cf_webhook_messaging (sender_id, recipient_id, message_mid, is_echo)
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
  AND jsonb_typeof(we.payload) = 'object';

CREATE INDEX IF NOT EXISTS tmp_cf_webhook_messaging_mid_idx
  ON tmp_cf_webhook_messaging (message_mid)
  WHERE message_mid IS NOT NULL;

WITH messaging AS (
  SELECT sender_id, recipient_id, message_mid, is_echo
  FROM tmp_cf_webhook_messaging
),
ticket_inbound_senders AS (
  SELECT
    t.id AS ticket_id,
    t.external_contact_id,
    count(DISTINCT msg.sender_id) FILTER (
      WHERE NOT msg.is_echo AND msg.sender_id IS NOT NULL
    ) AS inbound_sender_count,
    min(msg.sender_id) FILTER (
      WHERE NOT msg.is_echo AND msg.sender_id IS NOT NULL
    ) AS any_inbound_sender,
    count(DISTINCT msg.recipient_id) FILTER (
      WHERE NOT msg.is_echo AND msg.recipient_id IS NOT NULL
    ) AS inbound_recipient_count,
    min(msg.recipient_id) FILTER (
      WHERE NOT msg.is_echo AND msg.recipient_id IS NOT NULL
    ) AS any_inbound_recipient
  FROM public.tickets t
  JOIN public.channel_messages m
    ON m.ticket_id = t.id
   AND m.external_message_id IS NOT NULL
  JOIN messaging msg
    ON msg.message_mid = m.external_message_id
  WHERE t.source_channel IN ('instagram', 'whatsapp')
  GROUP BY t.id, t.external_contact_id
),
classified_tickets AS (
  SELECT
    t.id,
    CASE
      WHEN t.external_contact_id IS NULL
        OR btrim(t.external_contact_id) = '' THEN 'ambiguous'
      WHEN s.inbound_sender_count > 1 THEN 'quarantined'
      WHEN s.inbound_sender_count = 1
        AND s.any_inbound_sender IS DISTINCT FROM t.external_contact_id
        THEN 'quarantined'
      WHEN coalesce(s.any_inbound_recipient, key_recipient.recipient_id) IS NOT NULL
        AND coalesce(s.any_inbound_recipient, key_recipient.recipient_id)
          IS NOT DISTINCT FROM t.external_contact_id
        THEN 'ambiguous'
      WHEN t.external_conversation_id IS NOT NULL
        AND t.external_conversation_id = coalesce(
          s.any_inbound_recipient,
          key_recipient.recipient_id
        )
        AND NOT (
          s.inbound_sender_count = 1
          AND s.any_inbound_sender = t.external_contact_id
        )
        THEN 'ambiguous'
      WHEN s.inbound_sender_count = 1
        AND s.any_inbound_sender = t.external_contact_id
        AND s.inbound_recipient_count = 1
        AND s.any_inbound_recipient IS NOT NULL
        AND s.any_inbound_recipient IS DISTINCT FROM t.external_contact_id
        THEN 'unambiguous'
      WHEN key_recipient.recipient_id IS NOT NULL
        AND key_recipient.recipient_id IS DISTINCT FROM t.external_contact_id
        AND (s.inbound_sender_count IS NULL OR s.inbound_sender_count <= 1)
        THEN 'unambiguous'
      WHEN s.inbound_sender_count = 1
        AND s.any_inbound_sender = t.external_contact_id
        AND s.any_inbound_recipient IS NOT NULL
        AND s.any_inbound_recipient IS DISTINCT FROM t.external_contact_id
        THEN 'unambiguous'
      ELSE 'ambiguous'
    END AS identity_status,
    CASE
      WHEN s.inbound_sender_count = 1
        AND s.any_inbound_sender = t.external_contact_id
        AND s.any_inbound_recipient IS DISTINCT FROM t.external_contact_id
        THEN s.any_inbound_recipient
      WHEN key_recipient.recipient_id IS DISTINCT FROM t.external_contact_id
        THEN key_recipient.recipient_id
      ELSE NULL
    END AS recipient_account_id
  FROM public.tickets t
  LEFT JOIN ticket_inbound_senders s ON s.ticket_id = t.id
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN t.external_contact_id IS NOT NULL
          AND t.external_conversation_id LIKE '%:' || t.external_contact_id
          AND length(t.external_conversation_id)
            > length(t.external_contact_id) + 1
          THEN left(
            t.external_conversation_id,
            length(t.external_conversation_id)
              - length(t.external_contact_id) - 1
          )
        ELSE NULL
      END AS recipient_id
  ) key_recipient ON true
  WHERE t.source_channel IN ('instagram', 'whatsapp')
)
UPDATE public.tickets t
SET identity_status = c.identity_status,
    recipient_account_id = COALESCE(t.recipient_account_id, c.recipient_account_id)
FROM classified_tickets c
WHERE t.id = c.id
  AND (
    t.identity_status IS DISTINCT FROM c.identity_status
    OR (
      t.recipient_account_id IS NULL
      AND c.recipient_account_id IS NOT NULL
    )
  );

UPDATE public.channel_conversations c
SET identity_status = t.identity_status,
    recipient_account_id = COALESCE(c.recipient_account_id, t.recipient_account_id),
    provider = COALESCE(
      c.provider,
      CASE c.channel
        WHEN 'instagram' THEN 'meta_instagram'
        WHEN 'whatsapp' THEN 'meta_whatsapp'
        ELSE c.provider
      END
    )
FROM public.tickets t
WHERE c.ticket_id = t.id
  AND t.source_channel IN ('instagram', 'whatsapp');

-- Conversations without a ticket: backfill only when page and sender are
-- distinct. Page-only keys stay ambiguous without a proven sender.
UPDATE public.channel_conversations c
SET identity_status = COALESCE(
      c.identity_status,
      CASE
        WHEN c.external_contact_id IS NULL OR btrim(c.external_contact_id) = '' THEN 'ambiguous'
        WHEN c.recipient_account_id IS NOT NULL
          AND c.recipient_account_id = c.external_contact_id THEN 'ambiguous'
        WHEN c.external_conversation_id IS NOT NULL
          AND c.recipient_account_id IS NOT NULL
          AND c.external_conversation_id = c.recipient_account_id THEN 'ambiguous'
        WHEN c.recipient_account_id IS NOT NULL
          AND c.external_contact_id IS NOT NULL
          AND c.recipient_account_id IS DISTINCT FROM c.external_contact_id
          THEN 'unambiguous'
        WHEN c.external_conversation_id IS NOT NULL
          AND c.external_contact_id IS NOT NULL
          AND c.external_conversation_id LIKE '%:' || c.external_contact_id
          AND length(c.external_conversation_id) > length(c.external_contact_id) + 1
          THEN 'unambiguous'
        ELSE 'ambiguous'
      END
    )
WHERE c.identity_status IS NULL;

-- Rewrite conversation keys only for active, unambiguous, sender-only or
-- page-only rows when the canonical key is free. Never rewrite resolved tickets.
UPDATE public.channel_conversations c
SET external_conversation_id = c.recipient_account_id || ':' || c.external_contact_id
WHERE c.identity_status = 'unambiguous'
  AND c.recipient_account_id IS NOT NULL
  AND c.external_contact_id IS NOT NULL
  AND c.recipient_account_id IS DISTINCT FROM c.external_contact_id
  AND (
    c.external_conversation_id = c.external_contact_id
    OR c.external_conversation_id = c.recipient_account_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.tickets t
    WHERE t.id = c.ticket_id
      AND t.status IN ('open', 'in_progress', 'waiting')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.channel_conversations other
    WHERE other.channel = c.channel
      AND other.external_conversation_id = c.recipient_account_id || ':' || c.external_contact_id
      AND other.id IS DISTINCT FROM c.id
  );

UPDATE public.tickets t
SET external_conversation_id = c.external_conversation_id
FROM public.channel_conversations c
WHERE c.ticket_id = t.id
  AND t.identity_status = 'unambiguous'
  AND t.status IN ('open', 'in_progress', 'waiting')
  AND t.external_conversation_id IS DISTINCT FROM c.external_conversation_id
  AND c.external_conversation_id LIKE (COALESCE(c.recipient_account_id, '') || ':%');

CREATE UNIQUE INDEX IF NOT EXISTS channel_conversations_identity_uidx
  ON public.channel_conversations (
    provider,
    channel,
    recipient_account_id,
    external_contact_id
  )
  WHERE identity_status = 'unambiguous'
    AND provider IS NOT NULL
    AND recipient_account_id IS NOT NULL
    AND external_contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_active_identity_uidx
  ON public.tickets (
    source_channel,
    recipient_account_id,
    external_contact_id
  )
  WHERE identity_status = 'unambiguous'
    AND status IN ('open', 'in_progress', 'waiting')
    AND source_channel IN ('instagram', 'whatsapp')
    AND recipient_account_id IS NOT NULL
    AND external_contact_id IS NOT NULL;

DO $$
DECLARE
  duplicate_groups integer := 0;
BEGIN
  SELECT count(*)
  INTO duplicate_groups
  FROM (
    SELECT 1
    FROM public.tickets
    WHERE source_channel = 'whatsapp'
      AND identity_status = 'unambiguous'
      AND external_conversation_id IS NOT NULL
      AND status IN ('open', 'in_progress', 'waiting')
    GROUP BY source_channel, external_conversation_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'duplicate_active_whatsapp_tickets'
      USING HINT = 'Resolve duplicate active WhatsApp tickets before creating tickets_whatsapp_one_active_conversation_idx.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_whatsapp_one_active_conversation_idx
  ON public.tickets (source_channel, external_conversation_id)
  WHERE source_channel = 'whatsapp'
    AND identity_status = 'unambiguous'
    AND external_conversation_id IS NOT NULL
    AND status IN ('open', 'in_progress', 'waiting');

CREATE OR REPLACE FUNCTION public.upsert_channel_conversation_identity(
  p_provider text,
  p_channel text,
  p_recipient_account_id text,
  p_external_contact_id text,
  p_external_conversation_id text,
  p_display_name text,
  p_last_message_at timestamptz,
  p_state text DEFAULT 'unclassified'
)
RETURNS public.channel_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_provider text := nullif(btrim(p_provider), '');
  v_channel text := nullif(btrim(p_channel), '');
  v_recipient text := nullif(btrim(p_recipient_account_id), '');
  v_contact text := nullif(btrim(p_external_contact_id), '');
  v_conversation text := nullif(btrim(p_external_conversation_id), '');
  v_row public.channel_conversations;
BEGIN
  IF v_provider IS NULL OR v_channel IS NULL OR v_recipient IS NULL
     OR v_contact IS NULL OR v_conversation IS NULL THEN
    RAISE EXCEPTION 'identity_missing'
      USING ERRCODE = '22023';
  END IF;
  IF v_recipient = v_contact THEN
    RAISE EXCEPTION 'identity_missing'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.channel_conversations (
      provider, channel, recipient_account_id, external_contact_id,
      external_conversation_id, identity_status, display_name, state,
      routing_intent, collected_data, last_message_at, last_activity_at
    )
    VALUES (
      v_provider, v_channel, v_recipient, v_contact, v_conversation,
      'unambiguous', nullif(btrim(p_display_name), ''),
      COALESCE(nullif(btrim(p_state), ''), 'unclassified'),
      'unclassified', '{}'::jsonb,
      COALESCE(p_last_message_at, now()),
      COALESCE(p_last_message_at, now())
    )
    RETURNING * INTO v_row;
    RETURN v_row;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_row
        FROM public.channel_conversations
       WHERE provider = v_provider
         AND channel = v_channel
         AND recipient_account_id = v_recipient
         AND external_contact_id = v_contact
         AND identity_status = 'unambiguous'
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'identity_missing'
          USING ERRCODE = '22023';
      END IF;
      UPDATE public.channel_conversations
         SET last_message_at = COALESCE(p_last_message_at, now()),
             last_activity_at = COALESCE(p_last_message_at, now()),
             display_name = COALESCE(nullif(btrim(p_display_name), ''), display_name)
       WHERE id = v_row.id
      RETURNING * INTO v_row;
      RETURN v_row;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_channel_conversation_identity(
  text, text, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_channel_conversation_identity(
  text, text, text, text, text, text, timestamptz, text
) TO service_role;
