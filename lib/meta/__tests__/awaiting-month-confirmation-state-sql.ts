import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MONTH_CONFIRMATION_STATE_MIGRATION_PATH = resolve(
  __dirname,
  "../../../supabase/migrations/20260828160000_awaiting_month_confirmation_state.sql",
);

export function readMonthConfirmationStateMigrationSql(): string {
  return readFileSync(MONTH_CONFIRMATION_STATE_MIGRATION_PATH, "utf8");
}

export const PRODUCTION_CONVERSATION_STATES = [
  "new",
  "collecting_name",
  "collecting_email",
  "collecting_phone",
  "collecting_social_handle",
  "collecting_platform",
  "collecting_issue_type",
  "collecting_campaign",
  "collecting_brand",
  "collecting_campaign_month",
  "collecting_poc",
  "collecting_description",
  "confirming",
  "ticket_created",
  "human_handoff",
  "closed",
  "unclassified",
  "awaiting_route",
  "collaboration",
  "support_intake",
  "awaiting_confirmation",
  "ticket_open",
  "cancelled",
  "awaiting_persona",
  "awaiting_creator_reason",
  "awaiting_creator_issue_category",
  "creator_campaign_details",
  "creator_issue_details",
  "creator_confirmation",
  "brand_action",
  "agency_details",
  "agency_confirmation",
  "other_inquiry",
  "other_contact",
  "other_confirmation",
  "awaiting_post_completion",
  "completed",
] as const;

export const EXPANDED_CONVERSATION_STATES = [
  ...PRODUCTION_CONVERSATION_STATES.slice(
    0,
    PRODUCTION_CONVERSATION_STATES.indexOf("ticket_open"),
  ),
  "awaiting_month_confirmation",
  ...PRODUCTION_CONVERSATION_STATES.slice(
    PRODUCTION_CONVERSATION_STATES.indexOf("ticket_open"),
  ),
] as const;

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(",\n        ");
}

export const PRODUCTION_STATE_CHECK_SQL = `
CHECK (
  state IN (
        ${sqlStringList(PRODUCTION_CONVERSATION_STATES)}
  )
)
`;

export const PGLITE_MONTH_CONFIRMATION_SCHEMA = `
CREATE TABLE public.channel_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'instagram',
  external_conversation_id text NOT NULL,
  external_contact_id text NOT NULL,
  state text NOT NULL DEFAULT 'new',
  routing_intent text,
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  recipient_account_id text,
  identity_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_conversations
  ADD CONSTRAINT channel_conversations_channel_check
  CHECK (channel IN ('whatsapp', 'instagram'));

ALTER TABLE public.channel_conversations
  ADD CONSTRAINT channel_conversations_routing_intent_check
  CHECK (
    routing_intent IS NULL
    OR routing_intent IN ('unclassified', 'collaboration', 'creator_support')
  );

ALTER TABLE public.channel_conversations
  ADD CONSTRAINT channel_conversations_identity_status_check
  CHECK (
    identity_status IS NULL
    OR identity_status IN ('unambiguous', 'ambiguous', 'quarantined')
  );

ALTER TABLE public.channel_conversations
  ADD CONSTRAINT channel_conversations_state_check
  ${PRODUCTION_STATE_CHECK_SQL};
`;
