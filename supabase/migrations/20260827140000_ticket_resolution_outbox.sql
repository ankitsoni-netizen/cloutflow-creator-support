-- CRM ticket resolution: atomic status transition + durable notification outbox.
-- Idempotent and non-destructive: safe to re-run.
-- Do not apply automatically; review before running remotely.
-- Does not modify ticket intake, Instagram/WATI webhook handling, staff roles,
-- assignment logic, authentication, or RLS policies on tickets/comments.
--
-- Critical path (same transaction):
--   authorization, validation, idempotent resolve, status=resolved,
--   authoritative resolved_at, resolution_summary, one resolution audit event,
--   pending creator comment, enqueue notification job.
-- Slow Instagram/WhatsApp/email work is NOT in this function.
--
-- Existing status-change triggers are preserved. This function inserts a
-- resolution audit event only when none already exists for the ticket.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Durable resolution notification outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticket_resolution_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets (id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.ticket_comments (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  purpose text NOT NULL DEFAULT 'ticket-resolution',
  delivery_status text NOT NULL DEFAULT 'pending',
  delivery_attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_resolution_jobs_status_check
    CHECK (delivery_status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  CONSTRAINT ticket_resolution_jobs_purpose_check
    CHECK (purpose IN ('ticket-resolution'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_resolution_jobs_idempotency_key_idx
  ON public.ticket_resolution_jobs (idempotency_key);

CREATE INDEX IF NOT EXISTS ticket_resolution_jobs_due_idx
  ON public.ticket_resolution_jobs (next_attempt_at NULLS FIRST, created_at)
  WHERE delivery_status IN ('pending', 'failed');

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ticket_resolution_jobs TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMENT ON TABLE public.ticket_resolution_jobs IS
  'Durable CRM resolution notification outbox. Claim takes a 60s lease via next_attempt_at. Do not send Instagram/WhatsApp/email inside the resolve transaction. Inaccessible through the public Data API (RLS on, no anon/authenticated grants).';

-- One resolution audit event per ticket. Skip creation when duplicate rows already exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ticket_events
    WHERE event_type IN ('status_changed', 'resolved', 'ticket_resolved')
      AND lower(COALESCE(to_status, '')) = 'resolved'
    GROUP BY ticket_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'ticket_events_one_resolved_status_idx skipped: duplicate resolved audit rows already exist';
    RETURN;
  END IF;

  EXECUTE $idx$
    CREATE UNIQUE INDEX IF NOT EXISTS ticket_events_one_resolved_status_idx
      ON public.ticket_events (ticket_id)
      WHERE event_type IN ('status_changed', 'resolved', 'ticket_resolved')
        AND lower(COALESCE(to_status, '')) = 'resolved'
  $idx$;
END $$;

ALTER TABLE public.ticket_resolution_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ticket_resolution_jobs FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.ticket_resolution_jobs FROM anon';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.ticket_resolution_jobs FROM authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Atomic resolve + enqueue
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_creator_support_ticket(
  p_ticket_id uuid,
  p_resolution_summary text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_summary text := btrim(COALESCE(p_resolution_summary, ''));
  v_actor_id uuid := COALESCE(p_actor_user_id, auth.uid());
  v_actor_name text := NULLIF(btrim(COALESCE(p_actor_name, '')), '');
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_ticket public.tickets%ROWTYPE;
  v_mutated boolean := false;
  v_event_id uuid;
  v_comment_id uuid;
  v_job_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'ticket_id_required' USING ERRCODE = '22023';
  END IF;
  IF v_summary = '' THEN
    RAISE EXCEPTION 'resolution_summary_required' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL THEN
    v_key := 'ticket-resolution:' || p_ticket_id::text;
  END IF;

  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS sp
    WHERE sp.user_id = v_actor_id
      AND sp.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_actor_name IS NULL THEN
    SELECT sp.full_name
    INTO v_actor_name
    FROM public.staff_profiles AS sp
    WHERE sp.user_id = v_actor_id
      AND sp.is_active = true
    LIMIT 1;
  END IF;
  IF v_actor_name IS NULL OR btrim(v_actor_name) = '' THEN
    v_actor_name := 'System';
  END IF;

  SELECT *
  INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_ticket.status IS DISTINCT FROM 'resolved' THEN
    UPDATE public.tickets
    SET
      status = 'resolved',
      resolution_summary = v_summary,
      resolved_at = v_now,
      updated_at = v_now
    WHERE id = p_ticket_id
      AND status IS DISTINCT FROM 'resolved'
    RETURNING * INTO v_ticket;

    IF FOUND THEN
      v_mutated := true;
    ELSE
      SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id;
    END IF;
  END IF;

  SELECT te.id
  INTO v_event_id
  FROM public.ticket_events AS te
  WHERE te.ticket_id = p_ticket_id
    AND lower(COALESCE(te.to_status, '')) = 'resolved'
    AND te.event_type IN ('status_changed', 'resolved', 'ticket_resolved')
  ORDER BY te.created_at ASC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    BEGIN
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
        p_ticket_id,
        'status_changed',
        NULL,
        'resolved',
        v_actor_id,
        v_actor_name,
        jsonb_build_object('resolution_summary', v_summary)
      )
      RETURNING id INTO v_event_id;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT te.id
        INTO v_event_id
        FROM public.ticket_events AS te
        WHERE te.ticket_id = p_ticket_id
          AND lower(COALESCE(te.to_status, '')) = 'resolved'
          AND te.event_type IN ('status_changed', 'resolved', 'ticket_resolved')
        ORDER BY te.created_at ASC
        LIMIT 1;
    END;
  END IF;

  SELECT tc.id
  INTO v_comment_id
  FROM public.ticket_comments AS tc
  WHERE tc.ticket_id = p_ticket_id
    AND tc.visibility = 'creator'
    AND tc.send_to_creator = true
    AND tc.comment_text = v_summary
  ORDER BY tc.created_at ASC
  LIMIT 1;

  IF v_comment_id IS NULL AND (v_mutated OR v_ticket.status = 'resolved') THEN
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
      p_ticket_id,
      v_actor_id,
      v_actor_name,
      'creator',
      v_summary,
      true,
      'pending'
    )
    RETURNING id INTO v_comment_id;
  END IF;

  INSERT INTO public.ticket_resolution_jobs (
    ticket_id,
    comment_id,
    idempotency_key,
    purpose,
    delivery_status,
    payload
  )
  VALUES (
    p_ticket_id,
    v_comment_id,
    v_key,
    'ticket-resolution',
    'pending',
    jsonb_build_object(
      'resolution_summary', v_summary,
      'source_channel', v_ticket.source_channel,
      'instagram', 'pending',
      'whatsapp', 'pending',
      'email', 'pending',
      'transcript', 'pending',
      'comment_delivery', 'pending',
      'customer_notified', false
    )
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET comment_id = COALESCE(public.ticket_resolution_jobs.comment_id, EXCLUDED.comment_id),
        updated_at = v_now
  RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'already_resolved', NOT v_mutated,
    'comment_id', v_comment_id,
    'job_id', v_job_id,
    'event_id', v_event_id,
    'ticket', to_jsonb(v_ticket)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_creator_support_ticket(uuid, text, uuid, text, text)
  FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.resolve_creator_support_ticket(uuid, text, uuid, text, text) FROM anon';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_creator_support_ticket(uuid, text, uuid, text, text) TO authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_creator_support_ticket(uuid, text, uuid, text, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMENT ON FUNCTION public.resolve_creator_support_ticket(uuid, text, uuid, text, text) IS
  'Atomic CRM resolve: auth, idempotent status=resolved, resolved_at, summary, one audit event, pending comment, enqueue durable notification job. Does not send email or DMs.';

-- ---------------------------------------------------------------------------
-- 3. Claim a due resolution job with a 60s delivery lease
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_ticket_resolution_job(
  p_job_id uuid,
  p_now timestamptz,
  p_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, clock_timestamp());
  v_max integer := COALESCE(NULLIF(p_max_attempts, 0), 5);
  v_row public.ticket_resolution_jobs%ROWTYPE;
  v_next_count integer;
  v_lease timestamptz;
BEGIN
  SELECT *
  INTO v_row
  FROM public.ticket_resolution_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  IF v_row.delivery_status NOT IN ('pending', 'failed')
     OR v_row.delivery_attempt_count >= v_max
     OR (v_row.next_attempt_at IS NOT NULL AND v_row.next_attempt_at > v_now)
  THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  v_next_count := v_row.delivery_attempt_count + 1;
  v_lease := v_now + interval '60 seconds';

  UPDATE public.ticket_resolution_jobs
  SET
    delivery_attempt_count = v_next_count,
    last_attempt_at = v_now,
    next_attempt_at = v_lease,
    delivery_status = 'pending',
    updated_at = v_now
  WHERE id = p_job_id
    AND delivery_attempt_count = v_row.delivery_attempt_count
    AND delivery_status IN ('pending', 'failed')
    AND (next_attempt_at IS NULL OR next_attempt_at <= v_now);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'attempt_count', v_next_count,
    'ticket_id', v_row.ticket_id,
    'comment_id', v_row.comment_id,
    'payload', v_row.payload
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer)
  FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer) FROM anon';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer) FROM authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMENT ON FUNCTION public.claim_ticket_resolution_job(uuid, timestamptz, integer) IS
  'Lease a due ticket_resolution_jobs row for 60 seconds by advancing next_attempt_at in the same UPDATE as the attempt increment.';

COMMIT;
