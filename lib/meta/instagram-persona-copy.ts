/**
 * Deterministic Instagram persona-routing copy.
 * Keep these strings stable — they are product copy, not LLM prompts.
 */

export const PERSONA_CREATOR_PAYLOAD = "PERSONA_CREATOR";
export const PERSONA_BRAND_PAYLOAD = "PERSONA_BRAND";
export const PERSONA_AGENCY_PAYLOAD = "PERSONA_AGENCY";
export const PERSONA_OTHER_PAYLOAD = "PERSONA_OTHER";

export const CREATOR_NEW_WORK_PAYLOAD = "CREATOR_NEW_WORK";
export const CREATOR_EXISTING_CAMPAIGN_PAYLOAD = "CREATOR_EXISTING_CAMPAIGN";
export const CREATOR_CAMPAIGN_ISSUE_PAYLOAD = "CREATOR_CAMPAIGN_ISSUE";
export const CREATOR_PAYMENT_ISSUE_PAYLOAD = "CREATOR_PAYMENT_ISSUE";
export const CREATOR_TICKET_CONFIRM_PAYLOAD = "CREATOR_TICKET_CONFIRM";
export const CREATOR_TICKET_EDIT_PAYLOAD = "CREATOR_TICKET_EDIT";

export const BRAND_BOOK_CALL_PAYLOAD = "BRAND_BOOK_CALL";
export const BRAND_BOOK_DEMO_PAYLOAD = "BRAND_BOOK_DEMO";

export const AGENCY_SEND_PAYLOAD = "AGENCY_SEND";
export const AGENCY_EDIT_PAYLOAD = "AGENCY_EDIT";

export const OTHER_SEND_PAYLOAD = "OTHER_SEND";
export const OTHER_EDIT_PAYLOAD = "OTHER_EDIT";

export const FLOW_CANCEL_PAYLOAD = "FLOW_CANCEL";
export const FLOW_BACK_PAYLOAD = "FLOW_BACK";
export const POST_MAIN_MENU_PAYLOAD = "POST_MAIN_MENU";
export const POST_DONE_PAYLOAD = "POST_DONE";

export const PERSONA_CREATOR_TITLE = "I'm a creator";
export const PERSONA_BRAND_TITLE = "I'm a brand";
export const PERSONA_AGENCY_TITLE = "I'm an agency";
export const PERSONA_OTHER_TITLE = "Something else";

export const CREATOR_NEW_WORK_TITLE = "Work with Cloutflow";
export const CREATOR_EXISTING_CAMPAIGN_TITLE = "Existing campaign";
export const CREATOR_CAMPAIGN_ISSUE_TITLE = "Campaign issue";
export const CREATOR_PAYMENT_ISSUE_TITLE = "Payment issue";
export const CREATOR_TICKET_CONFIRM_TITLE = "Raise ticket";
export const CREATOR_TICKET_EDIT_TITLE = "Edit details";
export const FLOW_CANCEL_TITLE = "Cancel";
export const FLOW_BACK_TITLE = "Go back";

export const BRAND_BOOK_CALL_TITLE = "Book a call";
export const BRAND_BOOK_DEMO_TITLE = "Book a demo";

export const AGENCY_SEND_TITLE = "Send to team";
export const AGENCY_EDIT_TITLE = "Edit details";

export const OTHER_SEND_TITLE = "Yes, send it";
export const OTHER_EDIT_TITLE = "Edit details";

export const POST_MAIN_MENU_TITLE = "Main menu";
export const POST_DONE_TITLE = "I'm done";

export const CREATOR_APPLY_URL = "https://cloutflow.com/creators/apply";
export const BRAND_CONTACT_URL = "https://cloutflow.com/contact";

/** Meta Instagram text messages should stay within this safe length. */
export const INSTAGRAM_SAFE_MESSAGE_LENGTH = 1000;

export const POST_COMPLETION_QUESTION_TEXT =
  "Is there anything else I can help you with?";

export const POST_DONE_TEXT =
  "Thanks for reaching out to Cloutflow. Have a great day.";

export const CREATOR_REASON_TEXT =
  "Great, always happy to help a creator. What brings you in today?";

export const CREATOR_APPLY_TEXT = [
  "Love that you want to create with us. Cloutflow works with creators across all kinds of niches, and we would be glad to have you in the mix.",
  "",
  "Here is your next step: apply through the link below and tell us about yourself and your work.",
  "",
  `Apply here: ${CREATOR_APPLY_URL}`,
  "",
  "Our team reviews every application and reaches out about campaigns that fit your style. Thanks for thinking of Cloutflow.",
].join("\n");

export const CREATOR_ISSUE_CATEGORY_TEXT =
  "Got it. Is this about the campaign itself, or about a payment?";

export const CREATOR_CAMPAIGN_DETAILS_TEXT =
  "Sure, I can help with that. Send me the brand name, the month it ran, and the best email to reach you on. You can put it all in one message.";

export const CREATOR_ISSUE_DETAILS_TEXT =
  "Thanks, got it. Now tell me what is going wrong, in as much detail as you can. The more you share, the faster we can sort it out.";

export const BRAND_ACTION_TEXT =
  "Great to hear from a brand. The best way to explore working together is a quick call or demo with our team.";

export const BRAND_BOOKING_TEXT = [
  `Book a time here: ${BRAND_CONTACT_URL}`,
  "",
  "Pick a slot that works for you and we will take it from there.",
].join("\n");

export const AGENCY_DETAILS_TEXT = [
  "Thanks for reaching out. If you manage creators and want to bring them campaigns through Cloutflow, we can connect you with our procurement team.",
  "",
  "I will need a few details first. Send me your agency’s name, your name, your email, and your agency roster link. You can put it all in one message.",
].join("\n");

export const OTHER_INQUIRY_TEXT =
  "No problem. Tell me what you need in as much detail as you can, and I will make sure it reaches the right person.";

export const OTHER_CONTACT_TEXT =
  "Thanks. Send me your name, email, and a phone number with country code (for example +91 98765 43210). One message is fine.";

export const AGENCY_SEND_CONFIRMED_TEXT =
  "All set. I’ve received your details and queued them for our procurement team. They’ll reach out over email if there’s a fit.";

export const OTHER_SEND_CONFIRMED_TEXT =
  "Thanks, I’ve received your inquiry and queued it for our team. Someone will get back to you soon.";

export const INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT =
  "I can currently process text messages only. Please type your answer here so I can continue helping you.";

export const CREATOR_CAMPAIGN_AMBIGUOUS_TEXT =
  "Please send the brand name on a labelled line, for example:\nBrand: Acme";

export const AGENCY_INTERNAL_EMAIL_SUBJECT = "New agency details received";
export const OTHER_INTERNAL_EMAIL_SUBJECT = "New general inquiry received";

export function personaWelcomeText(username: string | null | undefined): string {
  const name = username?.trim();
  const greeting = name ? `Hi ${name}` : "Hi there";
  return `${greeting}, welcome to Cloutflow. Good to have you here. Tell me a bit about yourself so I can point you to the right place.`;
}

export function withPostCompletionQuestion(body: string): string {
  const trimmed = body.trim();
  return `${trimmed}\n\n${POST_COMPLETION_QUESTION_TEXT}`;
}

export function creatorTicketRaisedText(ticketCode: string): string {
  return `Done, your ticket is raised. Ticket ID: ${ticketCode}. Our support team has all the details and will follow up with you shortly. Please keep this ticket ID handy for reference.`;
}

export function activeTicketAttachText(ticketCode: string): string {
  return `You already have an active support ticket: ${ticketCode}. I’ll add your new details to that ticket so our team has everything in one place.`;
}

export function creatorConfirmationText(input: {
  campaignName?: string | null;
  brandName: string;
  displayCampaignMonth: string;
  contactEmail: string;
  issueDetails?: string | null;
  issueCategory?: string | null;
}): string {
  void input.campaignName;
  const lines = ["Here is what I have.", ""];
  const issueCategory = input.issueCategory?.trim();
  if (issueCategory) {
    lines.push(`Issue type: ${issueCategory}`);
  }
  lines.push(
    `Brand: ${input.brandName}`,
    `Month: ${input.displayCampaignMonth}`,
    `Email: ${input.contactEmail}`,
  );
  const issueDetails = input.issueDetails?.trim();
  if (issueDetails) {
    lines.push(`Issue: ${issueDetails}`);
  }
  lines.push("", "Should I raise a support ticket with these details?");
  return lines.join("\n");
}

export function agencySummaryText(input: {
  agencyName: string;
  contactName: string;
  contactEmail: string;
  rosterUrl: string;
}): string {
  return [
    "Here is what I have.",
    "",
    `Agency: ${input.agencyName}`,
    `Name: ${input.contactName}`,
    `Email: ${input.contactEmail}`,
    `Roster: ${input.rosterUrl}`,
    "",
    "Should I send these details to our procurement team?",
  ].join("\n");
}

export function otherSummaryText(input: {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  inquiryDetails: string;
}): string {
  return [
    "Here is what I have.",
    "",
    `Name: ${input.contactName}`,
    `Email: ${input.contactEmail}`,
    `Phone: ${input.contactPhone}`,
    `Inquiry: ${input.inquiryDetails}`,
    "",
    "Should I send this to our team?",
  ].join("\n");
}

export function truncateDisplayedIssue(
  summaryBuilder: (issueDetails: string) => string,
  issueDetails: string,
  maxLength: number = INSTAGRAM_SAFE_MESSAGE_LENGTH,
): string {
  const full = summaryBuilder(issueDetails);
  if (full.length <= maxLength) return full;

  const ellipsis = "…";
  let low = 0;
  let high = issueDetails.length;
  let best = summaryBuilder(ellipsis);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = summaryBuilder(
      `${issueDetails.slice(0, Math.max(0, mid - ellipsis.length)).trimEnd()}${ellipsis}`,
    );
    if (candidate.length <= maxLength) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best.slice(0, maxLength);
}
