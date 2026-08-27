-- Concurrency-safe round-robin assignment for new Creator Support tickets.
-- Idempotent and non-destructive: safe to re-run.
-- Does not modify existing ticket rows, existing RLS policies, or assignment
-- workflow UPDATE behaviour. Do not apply automatically; review before running
-- remotely.
--
-- Automatic assignment runs at the tickets INSERT boundary so Instagram, WATI
-- WhatsApp, Meta WhatsApp, website, and manual CRM inserts share one primitive.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS tickets_round_robin_assignment_trigger ON public.tickets;
--   DROP TRIGGER IF EXISTS tickets_insert_assignment_audit_trigger ON public.tickets;
--   DROP FUNCTION IF EXISTS public.assign_creator_support_ticket_round_robin();
--   DROP FUNCTION IF EXISTS public.tickets_insert_assignment_audit();
--   DROP TABLE IF EXISTS public.ticket_assignment_cursors;
--   Recreate public.tickets_assignment_audit() and
--   tickets_assignment_audit_trigger from
--     20260811120000_assignment_audit_trigger.sql (removes event_data.source).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Queue-scoped round-robin cursor (one row per support queue)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticket_assignment_cursors (
  queue_key text PRIMARY KEY,
  last_assigned_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ticket_assignment_cursors IS
  'Internal round-robin cursor for Creator Support ticket assignment. Not a public API.';

COMMENT ON COLUMN public.ticket_assignment_cursors.queue_key IS
  'Stable queue identifier. creator_support is the Creator Support desk.';

COMMENT ON COLUMN public.ticket_assignment_cursors.last_assigned_user_id IS
  'staff_profiles.user_id of the executive who received the last automatic assignment. Null until the first successful auto-assignment. Not rewound by later reassignment or resolution.';

ALTER TABLE public.ticket_assignment_cursors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ticket_assignment_cursors FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ticket_assignment_cursors FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ticket_assignment_cursors FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ticket_assignment_cursors FROM service_role';
  END IF;
END $$;

INSERT INTO public.ticket_assignment_cursors (queue_key, last_assigned_user_id)
VALUES ('creator_support', NULL)
ON CONFLICT (queue_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. BEFORE INSERT: lock cursor, pick next eligible executive, stamp NEW
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_creator_support_ticket_round_robin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_queue_key constant text := 'creator_support';
  v_assignment_guc_name text;
  last_user_id uuid;
  last_still_eligible boolean := false;
  chosen_id uuid;
  chosen_name text;
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  v_assignment_guc_name := 'app.rr_assign_' || replace(NEW.id::text, '-', '_');

  IF NEW.assigned_executive_id IS NOT NULL THEN
    PERFORM set_config(v_assignment_guc_name, 'preassigned', true);
    RETURN NEW;
  END IF;

  INSERT INTO public.ticket_assignment_cursors (queue_key)
  VALUES (v_queue_key)
  ON CONFLICT (queue_key) DO NOTHING;

  SELECT c.last_assigned_user_id
  INTO last_user_id
  FROM public.ticket_assignment_cursors AS c
  WHERE c.queue_key = v_queue_key
  FOR UPDATE;

  IF last_user_id IS NOT NULL THEN
    SELECT TRUE
    INTO last_still_eligible
    FROM public.staff_profiles AS sp
    WHERE sp.user_id = last_user_id
      AND sp.is_active IS TRUE
      AND lower(btrim(COALESCE(sp.role, ''))) = 'executive';
  END IF;

  IF COALESCE(last_still_eligible, false) THEN
    SELECT sp.user_id, sp.full_name
    INTO chosen_id, chosen_name
    FROM public.staff_profiles AS sp
    WHERE sp.is_active IS TRUE
      AND lower(btrim(COALESCE(sp.role, ''))) = 'executive'
      AND sp.user_id > last_user_id
    ORDER BY sp.user_id
    LIMIT 1;
  END IF;

  IF chosen_id IS NULL THEN
    -- No previous assignee, previous assignee is ineligible, or wrap.
    SELECT sp.user_id, sp.full_name
    INTO chosen_id, chosen_name
    FROM public.staff_profiles AS sp
    WHERE sp.is_active IS TRUE
      AND lower(btrim(COALESCE(sp.role, ''))) = 'executive'
    ORDER BY sp.user_id
    LIMIT 1;
  END IF;

  IF chosen_id IS NULL THEN
    PERFORM set_config(v_assignment_guc_name, 'skipped', true);
    RETURN NEW;
  END IF;

  NEW.assigned_executive_id := chosen_id;
  NEW.assigned_executive_name := chosen_name;
  NEW.assigned_team := 'Creator Support';

  UPDATE public.ticket_assignment_cursors
  SET last_assigned_user_id = chosen_id,
      updated_at = clock_timestamp()
  WHERE public.ticket_assignment_cursors.queue_key = v_queue_key;

  PERFORM set_config(v_assignment_guc_name, 'round_robin', true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assign_creator_support_ticket_round_robin() IS
  'SECURITY DEFINER BEFORE INSERT assignment: locks the Creator Support cursor, selects the next active executive in user_id order, and stamps the ticket. Preassigned executives are preserved. Does not rewind on later reassignment.';

DROP TRIGGER IF EXISTS tickets_round_robin_assignment_trigger ON public.tickets;

CREATE TRIGGER tickets_round_robin_assignment_trigger
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  WHEN (btrim(COALESCE(NEW.assigned_team, '')) = 'Creator Support')
  EXECUTE FUNCTION public.assign_creator_support_ticket_round_robin();

REVOKE ALL ON FUNCTION public.assign_creator_support_ticket_round_robin() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.assign_creator_support_ticket_round_robin() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.assign_creator_support_ticket_round_robin() FROM authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. AFTER INSERT: one automatic assignment event (or sanitized skip)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tickets_insert_assignment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_assignment_guc_name text;
  assign_source text;
BEGIN
  v_assignment_guc_name := 'app.rr_assign_' || replace(NEW.id::text, '-', '_');
  assign_source := current_setting(v_assignment_guc_name, true);

  IF assign_source = 'round_robin' THEN
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
      NEW.id,
      'assignment_changed',
      NULL,
      NULL,
      NULL,
      'System',
      jsonb_build_object(
        'previous_executive_id', NULL,
        'previous_executive_name', NULL,
        'previous_team', NULL,
        'new_executive_id', NEW.assigned_executive_id,
        'new_executive_name', NEW.assigned_executive_name,
        'new_team', NEW.assigned_team,
        'source', 'round_robin'
      )
    );
  ELSIF assign_source = 'skipped' THEN
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
      NEW.id,
      'assignment_skipped',
      NULL,
      NULL,
      NULL,
      'System',
      jsonb_build_object(
        'source', 'round_robin',
        'reason', 'no_eligible_executive',
        'queue', 'creator_support'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tickets_insert_assignment_audit() IS
  'SECURITY DEFINER AFTER INSERT writer for automatic round-robin assignment_changed or sanitized assignment_skipped events. Preassigned inserts are not audited here.';

DROP TRIGGER IF EXISTS tickets_insert_assignment_audit_trigger ON public.tickets;

CREATE TRIGGER tickets_insert_assignment_audit_trigger
  AFTER INSERT ON public.tickets
  FOR EACH ROW
  WHEN (btrim(COALESCE(NEW.assigned_team, '')) = 'Creator Support')
  EXECUTE FUNCTION public.tickets_insert_assignment_audit();

REVOKE ALL ON FUNCTION public.tickets_insert_assignment_audit() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.tickets_insert_assignment_audit() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.tickets_insert_assignment_audit() FROM authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Distinguish manual reassignment in the existing UPDATE audit event
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tickets_assignment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor_id uuid;
  actor_full_name text;
BEGIN
  IF (
    NEW.assigned_executive_id IS NOT DISTINCT FROM OLD.assigned_executive_id
    AND NEW.assigned_executive_name IS NOT DISTINCT FROM OLD.assigned_executive_name
    AND NEW.assigned_team IS NOT DISTINCT FROM OLD.assigned_team
  ) THEN
    RETURN NEW;
  END IF;

  actor_id := auth.uid();
  actor_full_name := NULL;

  IF actor_id IS NOT NULL THEN
    SELECT sp.full_name
    INTO actor_full_name
    FROM public.staff_profiles AS sp
    WHERE sp.user_id = actor_id
      AND sp.is_active = true
    LIMIT 1;
  END IF;

  IF actor_full_name IS NULL OR btrim(actor_full_name) = '' THEN
    actor_full_name := 'System';
  END IF;

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
    NEW.id,
    'assignment_changed',
    NULL,
    NULL,
    actor_id,
    actor_full_name,
    jsonb_build_object(
      'previous_executive_id', OLD.assigned_executive_id,
      'previous_executive_name', OLD.assigned_executive_name,
      'previous_team', OLD.assigned_team,
      'new_executive_id', NEW.assigned_executive_id,
      'new_executive_name', NEW.assigned_executive_name,
      'new_team', NEW.assigned_team,
      'source', 'manual'
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tickets_assignment_audit() IS
  'SECURITY DEFINER audit writer for manual assignment changes; runs in the ticket UPDATE transaction. event_data.source is manual.';

DROP TRIGGER IF EXISTS tickets_assignment_audit_trigger ON public.tickets;

CREATE TRIGGER tickets_assignment_audit_trigger
  AFTER UPDATE OF assigned_executive_id, assigned_executive_name, assigned_team
  ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tickets_assignment_audit();

COMMIT;
