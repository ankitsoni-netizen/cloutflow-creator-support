export type DbTicketStatus = "open" | "in_progress" | "waiting" | "resolved";
export type DbTicketPriority = "urgent" | "high" | "normal" | "low";
export type DbSourceChannel =
  | "phone_call"
  | "whatsapp"
  | "instagram"
  | "website"
  | "email";
export type DbPlatform = "instagram" | "youtube";

export interface DbTicket {
  id: string;
  ticket_code: string;
  creator_name: string;
  creator_phone: string | null;
  creator_email: string | null;
  social_handle: string | null;
  platform: string | null;
  issue_type: string;
  campaign_name: string | null;
  brand_name: string | null;
  campaign_month: string | null;
  cloutflow_poc_name: string | null;
  cloutflow_poc_contact_number: string | null;
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
  created_at: string;
  updated_at: string;
}

export type DbTicketInsert = {
  creator_name: string;
  creator_phone: string | null;
  creator_email: string | null;
  social_handle: string | null;
  platform: DbPlatform;
  issue_type: string;
  campaign_name: string | null;
  brand_name: string | null;
  campaign_month: string | null;
  cloutflow_poc_name: string | null;
  cloutflow_poc_contact_number: string | null;
  source_channel: "phone_call";
  status: "open";
  priority: "normal";
  assigned_team: string | null;
  assigned_executive_id: string | null;
  assigned_executive_name: string | null;
  issue_description: string | null;
  internal_notes: string | null;
  acknowledgement_email_requested: boolean;
};
