-- Narrowly scoped migration: allow active staff to update only
-- ticket_comments.delivery_status on creator-facing outbound comments.
-- Does not weaken SELECT/INSERT policies. Do not apply automatically.

BEGIN;

-- Ensure RLS remains enabled (idempotent).
ALTER TABLE public.ticket_comments ENABLE ROW LEVEL SECURITY;

-- Recreate only this named UPDATE policy.
DROP POLICY IF EXISTS active_staff_update_creator_comment_delivery
  ON public.ticket_comments;

CREATE POLICY active_staff_update_creator_comment_delivery
  ON public.ticket_comments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff_profiles AS sp
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
    )
    AND visibility = 'creator'
    AND send_to_creator = true
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff_profiles AS sp
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
    )
    AND visibility = 'creator'
    AND send_to_creator = true
  );

-- RLS cannot restrict which columns change. Enforce delivery_status-only
-- updates for authenticated sessions via a BEFORE UPDATE trigger.
CREATE OR REPLACE FUNCTION public.ticket_comments_delivery_status_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Restrict authenticated app users only. Service/admin roles (e.g. postgres
  -- in the SQL editor) remain able to maintain full comment rows.
  IF auth.role() = 'authenticated' THEN
    IF (to_jsonb(NEW) - 'delivery_status')
         IS DISTINCT FROM
       (to_jsonb(OLD) - 'delivery_status') THEN
      RAISE EXCEPTION
        'Only delivery_status may be updated on ticket_comments for authenticated staff'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_comments_delivery_status_only_trg
  ON public.ticket_comments;

CREATE TRIGGER ticket_comments_delivery_status_only_trg
  BEFORE UPDATE ON public.ticket_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.ticket_comments_delivery_status_only();

COMMENT ON FUNCTION public.ticket_comments_delivery_status_only() IS
  'Rejects authenticated updates that change any ticket_comments column other than delivery_status.';

COMMENT ON POLICY active_staff_update_creator_comment_delivery
  ON public.ticket_comments IS
  'Active staff may update creator-facing outbound comments (delivery_status via companion trigger).';

-- Column-level privilege: authenticated may UPDATE only delivery_status.
-- RLS (above) still decides which rows are eligible; this GRANT does not
-- allow table-wide UPDATE and is not granted to anon.
GRANT UPDATE (delivery_status)
  ON TABLE public.ticket_comments
  TO authenticated;

COMMIT;
