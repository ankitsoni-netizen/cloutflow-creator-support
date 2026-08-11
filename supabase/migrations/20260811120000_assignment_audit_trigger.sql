-- Idempotent assignment audit trigger for public.tickets
-- Creates public.ticket_events rows with event_type = assignment_changed
-- inside the same transaction as the ticket update (SECURITY DEFINER bypasses RLS).
-- Does not modify status-change triggers.

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
  -- Only audit when an assignment field actually changes.
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
      'new_team', NEW.assigned_team
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_assignment_audit_trigger ON public.tickets;

CREATE TRIGGER tickets_assignment_audit_trigger
  AFTER UPDATE OF assigned_executive_id, assigned_executive_name, assigned_team
  ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tickets_assignment_audit();

COMMENT ON FUNCTION public.tickets_assignment_audit() IS
  'SECURITY DEFINER audit writer for assignment changes; runs in the ticket UPDATE transaction.';
