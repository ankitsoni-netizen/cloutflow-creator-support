/**
 * Deterministic Instagram routing and intake copy.
 * Keep these strings stable — they are product copy, not LLM prompts.
 */

export const ROUTE_COLLABORATION_PAYLOAD = "ROUTE_COLLABORATION";
export const ROUTE_CREATOR_SUPPORT_PAYLOAD = "ROUTE_CREATOR_SUPPORT";
export const CONFIRM_PAYLOAD = "CONFIRM";
export const EDIT_PAYLOAD = "EDIT";
export const CANCEL_PAYLOAD = "CANCEL";
export const RESTART_PAYLOAD = "RESTART";
export const YES_PAYLOAD = "YES";
export const USE_ORIGINAL_PAYLOAD = "USE_ORIGINAL";

export const ROUTING_QUESTION_TEXT =
  "Hi! Before we proceed, please tell us what you’re reaching out about so we can route your message correctly.";

export const WHATSAPP_ROUTING_QUESTION_TEXT =
  "Hi! Welcome to Cloutflow. Before we continue, please tell us what you’re reaching out about.";

export const ROUTING_COLLABORATION_TITLE = "Campaign / Collaboration";
export const ROUTING_CREATOR_SUPPORT_TITLE = "Creator Support";

/** Meta Instagram quick-reply titles are limited to 20 characters. */
export const ROUTING_COLLABORATION_QUICK_REPLY_TITLE = "Campaign / Collab";

export const COLLABORATION_CONFIRMED_TEXT =
  "Got it. We’ll keep this conversation with Cloutflow’s collaborations team. No support ticket has been created. If you need assistance at any time, reply SUPPORT.";

export const CREATOR_DETAILS_PROMPT_TEXT =
  "Sure, I’ll help you raise a support ticket. First, please share your full name, email address and contact number.";

export const WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT =
  "Sure, I’ll help you raise a support ticket. Please share your full name and email address. We’ll use this WhatsApp number as your contact number unless you share a different one.";

export const WHATSAPP_MEDIA_INTAKE_TEXT =
  "Please send the requested details as text so I can continue.";

/** @deprecated Use CREATOR_DETAILS_PROMPT_TEXT. Kept as an alias for the first intake prompt. */
export const CREATOR_SUPPORT_STARTED_TEXT = CREATOR_DETAILS_PROMPT_TEXT;

export const PLATFORM_DETAILS_PROMPT_TEXT =
  "Thanks. Which platform is this regarding—Instagram or YouTube—and what’s your username or handle there?";

export const CAMPAIGN_DETAILS_PROMPT_TEXT =
  "Lastly, please share the campaign name, brand name and campaign month.";

export const INTAKE_CANCELLED_TEXT =
  "No problem. I have cancelled this Creator Support intake and no ticket was created. Reply anytime if you need help.";

export const INTAKE_RESTARTED_TEXT =
  "Restarting Creator Support intake. You can type CANCEL anytime to stop.";

export const ROUTING_CLARIFY_TEXT =
  "Please choose one of the options below so we can route your message correctly.";

export const CONFIRMATION_PROMPT_TEXT =
  "Please review the summary above. Reply Confirm to create your Creator Support ticket, Edit to restart the questions, or Cancel to stop without creating a ticket.";

export const TICKET_CREATED_TEXT = (ticketCode: string): string =>
  `Thanks. Your Creator Support ticket ${ticketCode} has been created. Our team will follow up here.`;

export function ticketRaisedConfirmationText(ticketCode: string): string {
  return `Your support ticket ${ticketCode} has been raised. Our Creator Support team will update you shortly.`;
}

export const TICKET_EMAIL_SENT_FOLLOW_UP_TEXT =
  "We've also sent the ticket details to your email.";

export function firstNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/).find(Boolean) ?? "";
}

export function ticketCreatedWithEmailText(
  firstName: string,
  ticketCode: string,
): string {
  return `Thanks, ${firstName}. Your support ticket ${ticketCode} has been raised successfully. We’ve also sent the details to your email. Our team will review your inquiry and update you shortly.`;
}

export function ticketCreatedWithoutEmailText(
  firstName: string,
  ticketCode: string,
): string {
  return `Thanks, ${firstName}. Your support ticket ${ticketCode} has been raised successfully. Our team will review your inquiry and update you shortly.`;
}

export const ACTIVE_TICKET_FOLLOW_UP_TEXT =
  "Thanks — I’ve added this to your open Creator Support ticket.";

export const MESSAGING_WINDOW_STAFF_WARNING =
  "Instagram’s 24-hour messaging window may be closed. Replies can fail until the creator messages again.";

export const WHATSAPP_MESSAGING_WINDOW_STAFF_WARNING =
  "WhatsApp’s customer-service window is closed. This reply was not sent. The creator must message again before we can reply. Approved templates are not sent automatically.";

export type ChannelIntakeCopy = {
  routingQuestion: string;
  routingClarify: string;
  collaborationConfirmed: string;
  creatorDetailsPrompt: string;
  platformDetailsPrompt: string;
  campaignDetailsPrompt: string;
  intakeCancelled: string;
  intakeRestarted: string;
  collaborationQuickReplyTitle: string;
  creatorSupportQuickReplyTitle: string;
  mediaIntakeText: string;
};

export const INSTAGRAM_INTAKE_COPY: ChannelIntakeCopy = {
  routingQuestion: ROUTING_QUESTION_TEXT,
  routingClarify: ROUTING_CLARIFY_TEXT,
  collaborationConfirmed: COLLABORATION_CONFIRMED_TEXT,
  creatorDetailsPrompt: CREATOR_DETAILS_PROMPT_TEXT,
  platformDetailsPrompt: PLATFORM_DETAILS_PROMPT_TEXT,
  campaignDetailsPrompt: CAMPAIGN_DETAILS_PROMPT_TEXT,
  intakeCancelled: INTAKE_CANCELLED_TEXT,
  intakeRestarted: INTAKE_RESTARTED_TEXT,
  collaborationQuickReplyTitle: ROUTING_COLLABORATION_QUICK_REPLY_TITLE,
  creatorSupportQuickReplyTitle: ROUTING_CREATOR_SUPPORT_TITLE,
  mediaIntakeText: WHATSAPP_MEDIA_INTAKE_TEXT,
};

export const WHATSAPP_INTAKE_COPY: ChannelIntakeCopy = {
  routingQuestion: WHATSAPP_ROUTING_QUESTION_TEXT,
  routingClarify: ROUTING_CLARIFY_TEXT,
  collaborationConfirmed: COLLABORATION_CONFIRMED_TEXT,
  creatorDetailsPrompt: WHATSAPP_CREATOR_DETAILS_PROMPT_TEXT,
  platformDetailsPrompt: PLATFORM_DETAILS_PROMPT_TEXT,
  campaignDetailsPrompt: CAMPAIGN_DETAILS_PROMPT_TEXT,
  intakeCancelled: INTAKE_CANCELLED_TEXT,
  intakeRestarted: INTAKE_RESTARTED_TEXT,
  collaborationQuickReplyTitle: ROUTING_COLLABORATION_QUICK_REPLY_TITLE,
  creatorSupportQuickReplyTitle: ROUTING_CREATOR_SUPPORT_TITLE,
  mediaIntakeText: WHATSAPP_MEDIA_INTAKE_TEXT,
};

export const UNKNOWN_OPTIONAL_HINT =
  'If you don’t know, reply "I don\'t know".';
