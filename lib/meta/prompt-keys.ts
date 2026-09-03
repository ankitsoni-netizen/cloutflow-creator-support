import type { IntakeField } from "@/lib/meta/intake-validate";

export type ChatbotIdempotencyPrefix = "ig" | "wa";

/** New deterministic persona prompt keys so historical rows cannot suppress these messages. */
export const PERSONA_PROMPT = {
  monthConfirm: "month_confirm:v2",
  monthConfirmCorrected: "month_confirm_corrected:v2",
  monthConfirmReask: "month_confirm_reask:v2",
  creatorConfirm: "creator_confirm:v2",
  creatorEdit: "creator_campaign_edit:v2",
  personaRecover: "persona_recover:v2",
} as const;

const PERSONA_STATE_PROMPT_KEYS: Record<string, string> = {
  awaiting_month_confirmation: PERSONA_PROMPT.monthConfirm,
  creator_confirmation: PERSONA_PROMPT.creatorConfirm,
};

export function personaStatePromptKey(
  state: string,
  retryMessageId?: string | null,
): string {
  const base = PERSONA_STATE_PROMPT_KEYS[state] ?? state;
  return retryMessageId ? `${base}:retry:${retryMessageId}` : base;
}

export function isCreatorConfirmPromptKey(promptKey: string): boolean {
  return (
    promptKey === PERSONA_PROMPT.creatorConfirm ||
    promptKey.startsWith(`${PERSONA_PROMPT.creatorConfirm}:`)
  );
}

export function chatbotOutboundIdempotencyKey(
  conversationId: string,
  intakeSessionVersion: number,
  effectType: string,
  prefix: ChatbotIdempotencyPrefix = "ig",
): string {
  return `${prefix}:prompt:${conversationId}:v${intakeSessionVersion}:${effectType}`;
}

export function channelTicketCreatedKey(
  prefix: ChatbotIdempotencyPrefix,
  ticketId: string,
): string {
  if (prefix === "ig") {
    return `ticket_created:${ticketId}`;
  }
  return `ticket:${ticketId}:created`;
}

export function channelTicketEmailSentKey(
  prefix: ChatbotIdempotencyPrefix,
  ticketId: string,
): string {
  if (prefix === "ig") {
    return `ticket_email_sent:${ticketId}`;
  }
  return `wa:ticket:${ticketId}:email-sent`;
}

export function channelCrmReplyKey(
  prefix: ChatbotIdempotencyPrefix,
  commentId: string,
): string {
  return `${prefix}:crm:${commentId}`;
}

export function channelOutboundKey(
  prefix: ChatbotIdempotencyPrefix,
  conversationId: string,
  intakeSessionVersion: number,
  effectType: string,
): string {
  if (prefix === "wa" && effectType.startsWith("ticket:")) {
    return `wa:${effectType}`;
  }
  if (prefix === "wa" && effectType.startsWith("ticket_created:")) {
    return `wa:ticket:${effectType.slice("ticket_created:".length)}:created`;
  }
  return chatbotOutboundIdempotencyKey(
    conversationId,
    intakeSessionVersion,
    effectType,
    prefix,
  );
}

export function intakeEffectType(
  field: IntakeField,
  followup: string | null = null,
): string {
  return followup ? `intake:${field}:${followup}` : `intake:${field}`;
}

export function parseChatbotIdempotencyKey(key: string): {
  prefix: ChatbotIdempotencyPrefix;
  conversationId: string;
  intakeSessionVersion: number;
  effectType: string;
} | null {
  const match = key.match(/^(ig|wa):prompt:([^:]+):v(\d+):(.+)$/);
  if (!match) return null;
  const prefix = match[1];
  if (prefix !== "ig" && prefix !== "wa") return null;
  return {
    prefix,
    conversationId: match[2] ?? "",
    intakeSessionVersion: Number(match[3]),
    effectType: match[4] ?? "",
  };
}

export function isSameSessionPrompt(input: {
  idempotencyKey: string;
  conversationId: string;
  intakeSessionVersion: number;
  effectType: string;
  prefix?: ChatbotIdempotencyPrefix;
}): boolean {
  const parsed = parseChatbotIdempotencyKey(input.idempotencyKey);
  if (parsed) {
    if (input.prefix && parsed.prefix !== input.prefix) return false;
    return (
      parsed.conversationId === input.conversationId &&
      parsed.intakeSessionVersion === input.intakeSessionVersion &&
      parsed.effectType === input.effectType
    );
  }
  return (
    input.idempotencyKey ===
    channelOutboundKey(
      input.prefix ?? "ig",
      input.conversationId,
      input.intakeSessionVersion,
      input.effectType,
    )
  );
}
