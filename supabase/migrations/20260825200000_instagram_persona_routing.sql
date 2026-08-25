-- Instagram persona routing states for the DM chatbot.
-- Idempotent and non-destructive: safe to re-run.
-- Preserves legacy conversation states so existing rows remain valid.
-- Does not expand routing_intent. Brand/agency/other stay in collected_data
-- (igPersona). routing_intent remains unclassified | collaboration | creator_support.
-- Do not apply automatically; review before running remotely.

BEGIN;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.channel_conversations'::regclass
      AND c.contype = 'c'
      AND a.attname = 'state'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.channel_conversations DROP CONSTRAINT %I',
      rec.conname
    );
  END LOOP;

  ALTER TABLE public.channel_conversations
    ADD CONSTRAINT channel_conversations_state_check
    CHECK (
      state IN (
        'new',
        'collecting_name',
        'collecting_email',
        'collecting_phone',
        'collecting_social_handle',
        'collecting_platform',
        'collecting_issue_type',
        'collecting_campaign',
        'collecting_brand',
        'collecting_campaign_month',
        'collecting_poc',
        'collecting_description',
        'confirming',
        'ticket_created',
        'human_handoff',
        'closed',
        'unclassified',
        'awaiting_route',
        'collaboration',
        'support_intake',
        'awaiting_confirmation',
        'ticket_open',
        'cancelled',
        'awaiting_persona',
        'awaiting_creator_reason',
        'awaiting_creator_issue_category',
        'creator_campaign_details',
        'creator_issue_details',
        'creator_confirmation',
        'brand_action',
        'agency_details',
        'agency_confirmation',
        'other_inquiry',
        'other_contact',
        'other_confirmation',
        'awaiting_post_completion',
        'completed'
      )
    );
END $$;

COMMENT ON CONSTRAINT channel_conversations_state_check ON public.channel_conversations IS
  'Instagram persona routing states plus preserved legacy chatbot and ticket states.';

COMMIT;
