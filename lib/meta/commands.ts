import {
  CANCEL_PAYLOAD,
  CONFIRM_PAYLOAD,
  EDIT_PAYLOAD,
  RESTART_PAYLOAD,
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  USE_ORIGINAL_PAYLOAD,
  YES_PAYLOAD,
} from "@/lib/meta/routing-copy";

export type RoutingCommand =
  | "collaboration"
  | "creator_support"
  | "cancel"
  | "restart"
  | "confirm"
  | "edit"
  | "yes"
  | "support_reclassify";

function normalizeCommandText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s/]+/gu, "")
    .replace(/\s+/g, " ");
}

export function detectRoutingCommand(
  text: string,
  quickReplyPayload: string | null,
): RoutingCommand | null {
  const payload = quickReplyPayload?.trim().toUpperCase() ?? "";
  if (payload === ROUTE_COLLABORATION_PAYLOAD) return "collaboration";
  if (payload === ROUTE_CREATOR_SUPPORT_PAYLOAD) return "creator_support";
  if (payload === CANCEL_PAYLOAD) return "cancel";
  if (payload === RESTART_PAYLOAD) return "restart";
  if (payload === CONFIRM_PAYLOAD) return "confirm";
  if (payload === EDIT_PAYLOAD) return "edit";
  if (payload === YES_PAYLOAD || payload === USE_ORIGINAL_PAYLOAD) return "yes";

  const normalized = normalizeCommandText(text);
  if (!normalized) return null;

  if (normalized === "cancel") return "cancel";
  if (normalized === "restart") return "restart";
  if (normalized === "confirm" || normalized === "yes confirm") return "confirm";
  if (normalized === "edit") return "edit";
  if (normalized === "yes" || normalized === "y") return "yes";

  if (
    normalized === "support" ||
    normalized === "help" ||
    normalized === "creator support"
  ) {
    return "support_reclassify";
  }

  if (
    normalized === "campaign collaboration" ||
    normalized === "campaign / collaboration" ||
    normalized === "campaign collab" ||
    normalized === "collaboration" ||
    normalized === "collab" ||
    normalized === "campaign"
  ) {
    return "collaboration";
  }

  if (normalized === "creator support" || normalized === "creator") {
    return "creator_support";
  }

  return null;
}

export function isSupportReclassifyCommand(
  text: string,
  quickReplyPayload: string | null,
): boolean {
  const command = detectRoutingCommand(text, quickReplyPayload);
  return command === "support_reclassify" || command === "creator_support";
}
