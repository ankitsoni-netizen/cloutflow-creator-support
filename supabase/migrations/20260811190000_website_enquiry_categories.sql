-- Website enquiry categories: support general Cloutflow.com/help intake
-- alongside detailed creator-support tickets.
-- Idempotent and non-destructive: safe to re-run.
-- Does not modify ticket-number / ticket_code generation.

BEGIN;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS request_category text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS company_name text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS requester_type text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS topic_or_module text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS intake_details jsonb;

ALTER TABLE public.tickets
  ALTER COLUMN intake_details SET DEFAULT '{}'::jsonb;

UPDATE public.tickets
SET intake_details = '{}'::jsonb
WHERE intake_details IS NULL;

COMMENT ON COLUMN public.tickets.request_category IS
  'Website enquiry category (e.g. creator_support, brand_support). Separate from creator issue_type.';

COMMENT ON COLUMN public.tickets.company_name IS
  'Company / brand organisation from website intake forms.';

COMMENT ON COLUMN public.tickets.requester_type IS
  'Who submitted a website enquiry (brand, creator, agency).';

COMMENT ON COLUMN public.tickets.topic_or_module IS
  'Product documentation topic or Cloutflow module from website intake.';

COMMENT ON COLUMN public.tickets.intake_details IS
  'Safe JSON snapshot of category-specific website form fields.';

-- Category-specific creator/campaign fields may be omitted for general
-- website enquiries. Leave core identity/workflow columns NOT NULL.
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'creator_phone',
    'social_handle',
    'platform',
    'issue_type',
    'campaign_name',
    'brand_name',
    'campaign_month',
    'cloutflow_poc_name',
    'cloutflow_poc_contact_number'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tickets'
        AND column_name = col
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.tickets ALTER COLUMN %I DROP NOT NULL',
        col
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_request_category_check'
      AND conrelid = 'public.tickets'::regclass
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_request_category_check
      CHECK (
        request_category IS NULL
        OR request_category IN (
          'creator_support',
          'track_campaign',
          'product_demo',
          'brand_support',
          'reporting_analytics',
          'payments_commercials',
          'product_documentation'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_requester_type_check'
      AND conrelid = 'public.tickets'::regclass
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_requester_type_check
      CHECK (
        requester_type IS NULL
        OR requester_type IN ('brand', 'creator', 'agency')
      );
  END IF;
END $$;

COMMIT;
