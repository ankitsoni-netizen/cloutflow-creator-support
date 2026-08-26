import {
  AGENCY_EDIT_PAYLOAD,
  AGENCY_SEND_PAYLOAD,
  BRAND_BOOK_CALL_PAYLOAD,
  BRAND_BOOK_DEMO_PAYLOAD,
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_NEW_WORK_PAYLOAD,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  CREATOR_TICKET_EDIT_PAYLOAD,
  FLOW_BACK_PAYLOAD,
  FLOW_CANCEL_PAYLOAD,
  OTHER_EDIT_PAYLOAD,
  OTHER_SEND_PAYLOAD,
  PERSONA_AGENCY_PAYLOAD,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_OTHER_PAYLOAD,
  POST_DONE_PAYLOAD,
  POST_MAIN_MENU_PAYLOAD,
} from "@/lib/meta/instagram-persona-copy";

export type InstagramPersonaCommand =
  | "menu"
  | "restart"
  | "persona_creator"
  | "persona_brand"
  | "persona_agency"
  | "persona_other"
  | "creator_new_work"
  | "creator_existing_campaign"
  | "creator_campaign_issue"
  | "creator_payment_issue"
  | "creator_ticket_confirm"
  | "creator_ticket_edit"
  | "brand_book_call"
  | "brand_book_demo"
  | "agency_send"
  | "agency_edit"
  | "other_send"
  | "other_edit"
  | "edit"
  | "yes"
  | "flow_cancel"
  | "flow_back"
  | "post_main_menu"
  | "post_done";

function normalizeChoiceText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ");
}

function payloadCommand(
  quickReplyPayload: string | null,
): InstagramPersonaCommand | null {
  const payload = quickReplyPayload?.trim().toUpperCase() ?? "";
  switch (payload) {
    case PERSONA_CREATOR_PAYLOAD:
      return "persona_creator";
    case PERSONA_BRAND_PAYLOAD:
      return "persona_brand";
    case PERSONA_AGENCY_PAYLOAD:
      return "persona_agency";
    case PERSONA_OTHER_PAYLOAD:
      return "persona_other";
    case CREATOR_NEW_WORK_PAYLOAD:
      return "creator_new_work";
    case CREATOR_EXISTING_CAMPAIGN_PAYLOAD:
      return "creator_existing_campaign";
    case CREATOR_CAMPAIGN_ISSUE_PAYLOAD:
      return "creator_campaign_issue";
    case CREATOR_PAYMENT_ISSUE_PAYLOAD:
      return "creator_payment_issue";
    case CREATOR_TICKET_CONFIRM_PAYLOAD:
      return "creator_ticket_confirm";
    case CREATOR_TICKET_EDIT_PAYLOAD:
      return "creator_ticket_edit";
    case BRAND_BOOK_CALL_PAYLOAD:
      return "brand_book_call";
    case BRAND_BOOK_DEMO_PAYLOAD:
      return "brand_book_demo";
    case AGENCY_SEND_PAYLOAD:
      return "agency_send";
    case AGENCY_EDIT_PAYLOAD:
      return "agency_edit";
    case OTHER_SEND_PAYLOAD:
      return "other_send";
    case OTHER_EDIT_PAYLOAD:
      return "other_edit";
    case FLOW_CANCEL_PAYLOAD:
      return "flow_cancel";
    case FLOW_BACK_PAYLOAD:
      return "flow_back";
    case POST_MAIN_MENU_PAYLOAD:
      return "post_main_menu";
    case POST_DONE_PAYLOAD:
      return "post_done";
    default:
      return null;
  }
}

const TEXT_COMMANDS: Array<[InstagramPersonaCommand, readonly string[]]> = [
  ["menu", ["menu"]],
  ["restart", ["restart"]],
  ["persona_creator", ["i'm a creator", "i am a creator", "im a creator", "creator"]],
  ["persona_brand", ["i'm a brand", "i am a brand", "im a brand", "brand"]],
  ["persona_agency", ["i'm an agency", "i am an agency", "im an agency", "agency"]],
  ["persona_other", ["something else", "other"]],
  ["creator_new_work", ["work with cloutflow", "work with us"]],
  ["creator_existing_campaign", ["existing campaign"]],
  ["creator_campaign_issue", ["campaign issue"]],
  ["creator_payment_issue", ["payment issue"]],
  ["creator_ticket_confirm", ["yes, raise it", "yes raise it"]],
  ["edit", ["edit details", "edit"]],
  ["yes", ["yes", "y"]],
  ["brand_book_call", ["book a call", "call"]],
  ["brand_book_demo", ["book a demo", "demo"]],
  ["agency_send", ["send to team"]],
  ["other_send", ["yes, send it", "yes send it"]],
  ["flow_cancel", ["cancel"]],
  ["flow_back", ["back", "go back"]],
  ["post_main_menu", ["main menu"]],
  ["post_done", ["i'm done", "i am done", "im done", "done"]],
];

/**
 * Global menu/restart: entire message only, case-insensitive, whitespace-trimmed.
 * Does not match the words inside a longer issue description.
 */
export function isGlobalMenuOrRestart(
  text: string,
  quickReplyPayload: string | null = null,
): "menu" | "restart" | null {
  const fromPayload = payloadCommand(quickReplyPayload);
  if (fromPayload === "menu" || fromPayload === "restart") return fromPayload;
  if (fromPayload === "post_main_menu") return null;

  const normalized = normalizeChoiceText(text);
  if (normalized === "menu") return "menu";
  if (normalized === "restart") return "restart";
  return null;
}

/**
 * Global Go back: FLOW_BACK payload or entire trimmed message "back" / "go back".
 * Does not match those words inside a longer description.
 */
export function isGlobalFlowBack(
  text: string,
  quickReplyPayload: string | null = null,
): boolean {
  if (payloadCommand(quickReplyPayload) === "flow_back") return true;
  const normalized = normalizeChoiceText(text);
  return normalized === "back" || normalized === "go back";
}

export function detectInstagramPersonaCommand(
  text: string,
  quickReplyPayload: string | null,
): InstagramPersonaCommand | null {
  const fromPayload = payloadCommand(quickReplyPayload);
  if (fromPayload) return fromPayload;

  const normalized = normalizeChoiceText(text);
  if (!normalized) return null;

  for (const [command, aliases] of TEXT_COMMANDS) {
    if (aliases.includes(normalized)) return command;
  }
  return null;
}

export function commandAllowedAtState(
  command: InstagramPersonaCommand | null,
  allowed: readonly InstagramPersonaCommand[],
): command is InstagramPersonaCommand {
  return command !== null && allowed.includes(command);
}
