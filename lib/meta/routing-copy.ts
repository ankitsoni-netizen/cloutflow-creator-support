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

export const ROUTING_COLLABORATION_TITLE = "Campaign / Collaboration";
export const ROUTING_CREATOR_SUPPORT_TITLE = "Creator Support";

/** Meta Instagram quick-reply titles are limited to 20 characters. */
export const ROUTING_COLLABORATION_QUICK_REPLY_TITLE = "Campaign / Collab";

export const COLLABORATION_CONFIRMED_TEXT =
  "Got it. We’ll keep this conversation with Cloutflow’s collaborations team. No support ticket has been created. If you need assistance at any time, reply SUPPORT.";

export const CREATOR_DETAILS_PROMPT_TEXT =
  "Sure, I’ll help you raise a support ticket. First, please share your full name, email address and contact number.";

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

export const UNKNOWN_OPTIONAL_HINT =
  'If you don’t know, reply "I don\'t know".';
