export type TicketStatus =
  | "Open"
  | "In Progress"
  | "Waiting"
  | "Resolved";

export type TicketPriority = "Urgent" | "High" | "Normal" | "Low";

export type SourceChannel =
  | "Phone Call"
  | "WhatsApp"
  | "Instagram"
  | "Website"
  | "Email";

export type Platform = "Instagram" | "YouTube";

export type NavItem =
  | "inbox"
  | "my-tickets"
  | "resolved"
  | "analytics"
  | "resolution-base"
  | "settings";

export type StatusFilter =
  | "Open"
  | "In Progress"
  | "Waiting"
  | "Resolved"
  | "All";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  creatorName: string;
  phone: string;
  email: string;
  socialHandle: string;
  platform: Platform;
  issueType: string;
  issueCategory: string;
  campaignName: string;
  brand: string;
  campaignMonth: string;
  cloutflowPoc: string;
  cloutflowPocContactNumber: string;
  issueDescription: string;
  internalCallNotes?: string;
  sourceChannel: SourceChannel;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTeam: string;
  assignedExecutive: string;
  assignedExecutiveId?: string | null;
  createdAt: string;
  updatedAt: string;
  activity: ActivityEvent[];
  sendAcknowledgementEmail?: boolean;
}

export interface NewTicketFormData {
  source: SourceChannel;
  issueType: string;
  creatorName: string;
  phone: string;
  email: string;
  socialHandle: string;
  platform: Platform;
  campaignName: string;
  brand: string;
  campaignMonth: string;
  cloutflowPoc: string;
  cloutflowPocContactNumber: string;
  issueDescription: string;
  internalCallNotes: string;
  assignedExecutive: string;
  sendAcknowledgementEmail: boolean;
}
