export type DbTicketStatus = "open" | "in_progress" | "waiting" | "resolved";
export type DbTicketPriority = "urgent" | "high" | "normal" | "low";
export type DbSourceChannel =
  | "phone_call"
  | "whatsapp"
  | "instagram"
  | "website"
  | "email";
export type DbPlatform = "instagram" | "youtube";

export type DbRequestCategory =
  | "creator_support"
  | "track_campaign"
  | "product_demo"
  | "brand_support"
  | "reporting_analytics"
  | "payments_commercials"
  | "product_documentation";

export type DbRequesterType = "brand" | "creator" | "agency";

export interface DbTicket {
  id: string;
  ticket_code: string;
  creator_name: string | null;
  creator_phone: string | null;
  creator_email: string | null;
  social_handle: string | null;
  platform: string | null;
  /** Creator-support issue taxonomy; null for general website enquiries. */
  issue_type: string | null;
  campaign_name: string | null;
  brand_name: string | null;
  campaign_month: string | null;
  cloutflow_poc_name: string | null;
  cloutflow_poc_contact_number: string | null;
  request_category: string | null;
  company_name: string | null;
  requester_type: string | null;
  topic_or_module: string | null;
  intake_details: Record<string, unknown> | null;
  source_channel: string;
  status: string;
  priority: string;
  assigned_team: string | null;
  assigned_executive_id: string | null;
  assigned_executive_name: string | null;
  issue_description: string | null;
  internal_notes: string | null;
  acknowledgement_email_requested: boolean | null;
  acknowledgement_email_sent_at: string | null;
  resolution_summary: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  customer_last_notified_at: string | null;
  metadata: Record<string, unknown> | null;
  external_contact_id?: string | null;
  external_conversation_id?: string | null;
  identity_status?: string | null;
  created_at: string;
  updated_at: string;
}

export type DbTicketInsert = {
  creator_name: string;
  creator_phone: string | null;
  creator_email: string | null;
  social_handle: string | null;
  platform: DbPlatform | null;
  issue_type: string | null;
  campaign_name: string | null;
  brand_name: string | null;
  campaign_month: string | null;
  cloutflow_poc_name: string | null;
  cloutflow_poc_contact_number: string | null;
  request_category?: DbRequestCategory | null;
  company_name?: string | null;
  requester_type?: DbRequesterType | null;
  topic_or_module?: string | null;
  intake_details?: Record<string, unknown> | null;
  source_channel: Extract<
    DbSourceChannel,
    "phone_call" | "website" | "whatsapp" | "instagram"
  >;
  status: "open";
  priority: "normal";
  assigned_team: string | null;
  assigned_executive_id: string | null;
  assigned_executive_name: string | null;
  issue_description: string | null;
  internal_notes: string | null;
  acknowledgement_email_requested: boolean;
};
