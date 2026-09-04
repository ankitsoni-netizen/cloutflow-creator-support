-- Opaque ticket reply aliases and atomic Brevo inbound email ingest.
-- Additive and idempotent. Do not apply automatically.
-- Does not change Instagram/WATI identity matching, CRM RLS, or source_channel.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_email_reply_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets (id) ON DELETE CASCADE,
  local_part text NOT NULL,
  domain text NOT NULL DEFAULT 'reply.cloutflow.com',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT ticket_email_reply_aliases_local_part_format
    CHECK (local_part ~ '^t-[0-9a-f]{32}$'),
  CONSTRAINT ticket_email_reply_aliases_domain_format
    CHECK (domain = 'reply.cloutflow.com')
);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_email_reply_aliases_local_part_uidx
  ON public.ticket_email_reply_aliases (local_part);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_email_reply_aliases_one_active_ticket_uidx
  ON public.ticket_email_reply_aliases (ticket_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.ticket_email_reply_aliases IS
  'Opaque Reply-To aliases t-<random>@reply.cloutflow.com. Token is unrelated to ticket code, UUID, email, or channel identity.';

CREATE TABLE IF NOT EXISTS public.inbound_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  outcome text NOT NULL,
  error_code text,
  ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL,
  comment_id uuid REFERENCES public.ticket_comments (id) ON DELETE SET NULL,
  reopened boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_email_events_message_id_nonempty
    CHECK (btrim(message_id) <> ''),
  CONSTRAINT inbound_email_events_outcome_check
    CHECK (
      outcome IN (
        'appended',
        'duplicate',
        'ignored',
        'rejected'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_events_message_id_uidx
  ON public.inbound_email_events (message_id);

COMMENT ON TABLE public.inbound_email_events IS
  'Brevo inbound MessageId reservations. Stores outcome codes only. Never stores bodies, addresses, aliases, tokens, or raw payloads.';

CREATE TABLE IF NOT EXISTS public.inbound_email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.inbound_email_events (id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.ticket_comments (id) ON DELETE SET NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer,
  status text NOT NULL,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_email_attachments_status_check
    CHECK (
      status IN (
        'accepted_metadata',
        'rejected_type',
        'rejected_size',
        'rejected_name',
        'unavailable'
      )
    )
);

COMMENT ON TABLE public.inbound_email_attachments IS
  'Sanitized inbound attachment metadata only. Attachments are unsupported in this release: never stores Brevo download tokens, URLs, file bytes, or storage credentials. storage_path remains NULL.';

ALTER TABLE public.ticket_email_reply_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_email_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ticket_email_reply_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inbound_email_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inbound_email_attachments FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.ticket_email_reply_aliases TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.inbound_email_events TO service_role;
GRANT SELECT, INSERT ON TABLE public.inbound_email_attachments TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_ticket_email_reply_alias(p_ticket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  existing_local text;
  next_local text;
  attempts integer := 0;
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'ticket_not_found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tickets AS t WHERE t.id = p_ticket_id) THEN
    RAISE EXCEPTION 'ticket_not_found';
  END IF;

  SELECT a.local_part
    INTO existing_local
  FROM public.ticket_email_reply_aliases AS a
  WHERE a.ticket_id = p_ticket_id
    AND a.revoked_at IS NULL
  LIMIT 1;

  IF existing_local IS NOT NULL THEN
    RETURN existing_local || '@reply.cloutflow.com';
  END IF;

  LOOP
    attempts := attempts + 1;
    IF attempts > 8 THEN
      RAISE EXCEPTION 'alias_generation_failed';
    END IF;
    next_local := 't-' || encode(gen_random_bytes(16), 'hex');
    BEGIN
      INSERT INTO public.ticket_email_reply_aliases (ticket_id, local_part, domain)
      VALUES (p_ticket_id, next_local, 'reply.cloutflow.com');
      RETURN next_local || '@reply.cloutflow.com';
    EXCEPTION
      WHEN unique_violation THEN
        SELECT a.local_part
          INTO existing_local
        FROM public.ticket_email_reply_aliases AS a
        WHERE a.ticket_id = p_ticket_id
          AND a.revoked_at IS NULL
        LIMIT 1;
        IF existing_local IS NOT NULL THEN
          RETURN existing_local || '@reply.cloutflow.com';
        END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_ticket_email_reply_alias(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_ticket_email_reply_alias(uuid)
  TO service_role;

COMMENT ON FUNCTION public.ensure_ticket_email_reply_alias(uuid) IS
  'Returns the active opaque Reply-To address for a ticket, creating one when missing. service_role only. Never returns creator PII.';

CREATE OR REPLACE FUNCTION public.tickets_ensure_email_reply_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.creator_email IS NULL OR btrim(NEW.creator_email) = '' THEN
    RETURN NEW;
  END IF;
  PERFORM public.ensure_ticket_email_reply_alias(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_ensure_email_reply_alias_trg ON public.tickets;
CREATE TRIGGER tickets_ensure_email_reply_alias_trg
  AFTER INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tickets_ensure_email_reply_alias();

CREATE OR REPLACE FUNCTION public.ingest_brevo_inbound_email(
  p_message_id text,
  p_alias_local_part text,
  p_sender_normalized text,
  p_body_text text,
  p_ignore_reason text,
  p_attachments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_id uuid;
  existing_id uuid;
  existing_outcome text;
  existing_comment uuid;
  existing_reopened boolean;
  alias_ticket uuid;
  alias_revoked timestamptz;
  ticket_row public.tickets%ROWTYPE;
  bound_email text;
  v_comment_id uuid;
  did_reopen boolean := false;
  from_status text;
  attachment jsonb;
  attach_name text;
  attach_type text;
  attach_size integer;
  attach_status text;
  sanitized_body text;
BEGIN
  IF NULLIF(btrim(COALESCE(p_message_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'missing_message_id';
  END IF;

  INSERT INTO public.inbound_email_events (message_id, outcome)
  VALUES (btrim(p_message_id), 'rejected')
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id INTO event_id;

  IF event_id IS NULL THEN
    SELECT e.id, e.outcome, e.comment_id, e.reopened
      INTO existing_id, existing_outcome, existing_comment, existing_reopened
    FROM public.inbound_email_events AS e
    WHERE e.message_id = btrim(p_message_id)
    LIMIT 1;
    RETURN jsonb_build_object(
      'outcome', 'duplicate',
      'error_code', NULL,
      'reopened', COALESCE(existing_reopened, false),
      'comment_id', existing_comment
    );
  END IF;

  IF NULLIF(btrim(COALESCE(p_ignore_reason, '')), '') IS NOT NULL THEN
    UPDATE public.inbound_email_events
    SET outcome = 'ignored',
        error_code = left(btrim(p_ignore_reason), 64)
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'ignored',
      'error_code', left(btrim(p_ignore_reason), 64),
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  IF p_alias_local_part IS NULL
    OR p_alias_local_part !~ '^t-[0-9a-f]{32}$'
  THEN
    UPDATE public.inbound_email_events
    SET outcome = 'rejected', error_code = 'alias_invalid'
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'error_code', 'alias_invalid',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  SELECT a.ticket_id, a.revoked_at
    INTO alias_ticket, alias_revoked
  FROM public.ticket_email_reply_aliases AS a
  WHERE a.local_part = p_alias_local_part;

  IF alias_ticket IS NULL THEN
    UPDATE public.inbound_email_events
    SET outcome = 'rejected', error_code = 'alias_unknown'
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'error_code', 'alias_unknown',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  IF alias_revoked IS NOT NULL THEN
    UPDATE public.inbound_email_events
    SET outcome = 'rejected', error_code = 'alias_revoked', ticket_id = alias_ticket
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'error_code', 'alias_revoked',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  SELECT t.*
    INTO ticket_row
  FROM public.tickets AS t
  WHERE t.id = alias_ticket;

  IF NOT FOUND THEN
    UPDATE public.inbound_email_events
    SET outcome = 'rejected', error_code = 'ticket_not_found'
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'error_code', 'ticket_not_found',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  bound_email := lower(btrim(COALESCE(ticket_row.creator_email, '')));
  IF bound_email = '' THEN
    UPDATE public.inbound_email_events
    SET outcome = 'rejected',
        error_code = 'creator_email_missing',
        ticket_id = ticket_row.id
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'error_code', 'creator_email_missing',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  IF p_sender_normalized IS NULL
    OR bound_email IS DISTINCT FROM lower(btrim(p_sender_normalized))
  THEN
    UPDATE public.inbound_email_events
    SET outcome = 'rejected',
        error_code = 'sender_mismatch',
        ticket_id = ticket_row.id
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'error_code', 'sender_mismatch',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  sanitized_body := left(btrim(COALESCE(p_body_text, '')), 20000);
  IF sanitized_body = '' THEN
    UPDATE public.inbound_email_events
    SET outcome = 'ignored',
        error_code = 'empty_reply',
        ticket_id = ticket_row.id
    WHERE id = event_id;
    RETURN jsonb_build_object(
      'outcome', 'ignored',
      'error_code', 'empty_reply',
      'reopened', false,
      'comment_id', NULL
    );
  END IF;

  INSERT INTO public.ticket_comments (
    ticket_id,
    author_user_id,
    author_name,
    visibility,
    comment_text,
    send_to_creator,
    delivery_status
  )
  VALUES (
    ticket_row.id,
    NULL,
    'Creator',
    'creator',
    sanitized_body,
    false,
    NULL
  )
  RETURNING id INTO v_comment_id;

  IF lower(COALESCE(ticket_row.status, '')) = 'resolved' THEN
    from_status := ticket_row.status;
    UPDATE public.tickets
    SET
      status = 'open',
      resolved_at = NULL,
      updated_at = now()
    WHERE id = ticket_row.id
      AND lower(COALESCE(status, '')) = 'resolved'
      AND source_channel IS NOT DISTINCT FROM ticket_row.source_channel
      AND external_contact_id IS NOT DISTINCT FROM ticket_row.external_contact_id
      AND external_conversation_id IS NOT DISTINCT FROM ticket_row.external_conversation_id
      AND recipient_account_id IS NOT DISTINCT FROM ticket_row.recipient_account_id
      AND identity_status IS NOT DISTINCT FROM ticket_row.identity_status;
    IF FOUND THEN
      INSERT INTO public.ticket_events (
        ticket_id,
        event_type,
        from_status,
        to_status,
        actor_user_id,
        actor_name,
        event_data
      )
      VALUES (
        ticket_row.id,
        'status_changed',
        from_status,
        'open',
        NULL,
        'Email inbound',
        jsonb_build_object('source', 'inbound_email')
      );
      did_reopen := true;
    END IF;
  END IF;

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
    FOR attachment IN SELECT value FROM jsonb_array_elements(p_attachments)
    LOOP
      IF jsonb_typeof(attachment) IS DISTINCT FROM 'object' THEN
        CONTINUE;
      END IF;
      attach_name := left(COALESCE(attachment->>'filename', 'file'), 200);
      attach_type := left(COALESCE(attachment->>'content_type', 'application/octet-stream'), 200);
      attach_status := COALESCE(attachment->>'status', 'unavailable');
      IF attach_status NOT IN (
        'accepted_metadata',
        'rejected_type',
        'rejected_size',
        'rejected_name',
        'unavailable'
      ) THEN
        attach_status := 'unavailable';
      END IF;
      attach_size := NULL;
      IF jsonb_typeof(attachment->'byte_size') = 'number' THEN
        attach_size := (attachment->>'byte_size')::integer;
      END IF;
      INSERT INTO public.inbound_email_attachments (
        event_id,
        comment_id,
        filename,
        content_type,
        byte_size,
        status,
        storage_path
      )
      VALUES (
        event_id,
        v_comment_id,
        attach_name,
        attach_type,
        attach_size,
        attach_status,
        NULL
      );
    END LOOP;
  END IF;

  UPDATE public.inbound_email_events
  SET
    outcome = 'appended',
    error_code = NULL,
    ticket_id = ticket_row.id,
    comment_id = v_comment_id,
    reopened = did_reopen
  WHERE id = event_id;

  RETURN jsonb_build_object(
    'outcome', 'appended',
    'error_code', NULL,
    'reopened', did_reopen,
    'comment_id', v_comment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_brevo_inbound_email(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_brevo_inbound_email(text, text, text, text, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.ingest_brevo_inbound_email(text, text, text, text, text, jsonb) IS
  'Atomically reserve a Brevo inbound MessageId via INSERT ON CONFLICT (message_id) DO NOTHING, resolve the opaque alias, verify the bound creator email, append a timeline comment, and reopen a resolved ticket via status_changed. Duplicate is returned only when that MessageId row already exists. Later failures abort the whole transaction. Never matches subject, ticket code, or fuzzy identity. Return payload is outcome codes only.';

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually)
-- ---------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS tickets_ensure_email_reply_alias_trg ON public.tickets;
-- DROP FUNCTION IF EXISTS public.tickets_ensure_email_reply_alias();
-- DROP FUNCTION IF EXISTS public.ingest_brevo_inbound_email(text, text, text, text, text, jsonb);
-- DROP FUNCTION IF EXISTS public.ensure_ticket_email_reply_alias(uuid);
-- DROP TABLE IF EXISTS public.inbound_email_attachments;
-- DROP TABLE IF EXISTS public.inbound_email_events;
-- DROP TABLE IF EXISTS public.ticket_email_reply_aliases;
