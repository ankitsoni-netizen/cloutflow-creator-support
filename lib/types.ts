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
  | "command-centre"
  | "inbox"
  | "my-tickets"
  | "unassigned"
  | "waiting"
  | "sla-risk"
  | "resolved"
  | "creators"
  | "campaigns"
  | "resolution-base"
  | "analytics"
  | "automations"
  | "ai-agent"
  | "channels"
  | "team"
  | "settings";

export type InboxView =
  | "all-active"
  | "my-tickets"
  | "unassigned"
  | "open"
  | "in-progress"
  | "waiting"
  | "urgent"
  | "pending-reply"
  | "resolved";

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
  resolutionSummary?: string | null;
  resolvedAt?: string | null;
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

/** Typed contract for future Cloutflow Copilot AI responses. */
export interface CopilotAiResult {
  summary?: string;
  suggestedNextAction?: string;
  draftCreatorResponse?: string;
  resolutionBaseMatches?: Array<{ id: string; title: string; score?: number }>;
  similarResolvedTickets?: Array<{
    ticketId: string;
    ticketNumber: string;
    reason: string;
  }>;
  riskAndEscalation?: {
    level: "low" | "medium" | "high";
    rationale: string;
  };
  suggestedAssignment?: {
    executiveUserId?: string;
    executiveName?: string;
    team?: string;
    rationale?: string;
  };
  suggestedPriority?: {
    priority: TicketPriority;
    rationale: string;
  };
  confidence?: number;
  generatedAt?: string;
  model?: string;
}

export interface CreatorRecord {
  id: string;
  displayName: string;
  phones: string[];
  emails: string[];
  handles: string[];
  platforms: string[];
  brands: string[];
  campaigns: string[];
  pocs: string[];
  ticketCount: number;
  openCount: number;
  resolvedCount: number;
  waitingCount: number;
  tickets: Ticket[];
  latestUpdatedAt: string;
}

export interface CampaignRecord {
  id: string;
  campaignName: string;
  brand: string;
  campaignMonth: string;
  pocs: string[];
  teams: string[];
  ticketCount: number;
  openCount: number;
  paymentCount: number;
  taxCount: number;
  conductCount: number;
  oldestUnresolvedAt: string | null;
  tickets: Ticket[];
}

export interface StaffDirectoryMember {
  userId: string;
  fullName: string;
  role: string | null;
  team: string | null;
  isActive: boolean;
}
