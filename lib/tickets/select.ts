import { identitySchemaPhase } from "@/lib/meta/identity-schema-phase";

const TICKET_SELECT_BASE = `
  id,
  ticket_code,
  creator_name,
  creator_phone,
  creator_email,
  social_handle,
  platform,
  issue_type,
  campaign_name,
  brand_name,
  campaign_month,
  cloutflow_poc_name,
  cloutflow_poc_contact_number,
  request_category,
  company_name,
  requester_type,
  topic_or_module,
  intake_details,
  source_channel,
  status,
  priority,
  assigned_team,
  assigned_executive_id,
  assigned_executive_name,
  issue_description,
  internal_notes,
  acknowledgement_email_requested,
  acknowledgement_email_sent_at,
  resolution_summary,
  first_response_at,
  resolved_at,
  customer_last_notified_at,
  metadata,
  external_contact_id,
  external_conversation_id`;

/** Phase A: current Production ticket columns only. */
export const TICKET_SELECT_PHASE_A = `
${TICKET_SELECT_BASE},
  created_at,
  updated_at
`;

/** Phase C: requires 20260828150000 identity columns. */
export const TICKET_SELECT_PHASE_C = `
${TICKET_SELECT_BASE},
  identity_status,
  created_at,
  updated_at
`;

export function ticketSelect(): typeof TICKET_SELECT_PHASE_A {
  return (identitySchemaPhase() === "c"
    ? TICKET_SELECT_PHASE_C
    : TICKET_SELECT_PHASE_A) as typeof TICKET_SELECT_PHASE_A;
}

/** Default export stays Phase A so a missed call site cannot require new columns. */
export const TICKET_SELECT = TICKET_SELECT_PHASE_A;
