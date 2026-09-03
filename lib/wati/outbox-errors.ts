import {
  INVALID_WATI_CONVERSATION_TARGET_MODE,
  WHATSAPP_PROVIDER_NOT_CONFIGURED,
} from "@/lib/wati/config";

export const WATI_TERMINAL_SEND_CODES = new Set([
  "invalid_recipient",
  "empty_message",
  WHATSAPP_PROVIDER_NOT_CONFIGURED,
  INVALID_WATI_CONVERSATION_TARGET_MODE,
  "token_url_leak_prevented",
  "http_401",
  "http_403",
  "outbound_attempts_exhausted",
  "wati_interactive_body_too_long",
  "wati_interactive_missing_options",
  "wati_interactive_empty_option",
  "wati_interactive_too_many_options",
  "wati_interactive_option_too_long",
  "wati_interactive_unsupported",
]);

export function isWatiTerminalSendError(
  errorCode: string | null | undefined,
): boolean {
  const code = errorCode?.trim() ?? "";
  if (!code) return false;
  if (WATI_TERMINAL_SEND_CODES.has(code)) return true;
  if (code.includes("_terminal_")) return true;
  return false;
}
