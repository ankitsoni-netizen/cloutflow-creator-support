import type { IntakeField } from "@/lib/meta/intake-validate";

export function chatbotOutboundIdempotencyKey(
  conversationId: string,
  intakeSessionVersion: number,
  effectType: string,
): string {
  return `ig:prompt:${conversationId}:v${intakeSessionVersion}:${effectType}`;
}

export function intakeEffectType(
  field: IntakeField,
  followup: string | null = null,
): string {
  return followup ? `intake:${field}:${followup}` : `intake:${field}`;
}

export function parseChatbotIdempotencyKey(key: string): {
  conversationId: string;
  intakeSessionVersion: number;
  effectType: string;
} | null {
  const match = key.match(/^ig:prompt:([^:]+):v(\d+):(.+)$/);
  if (!match) return null;
  return {
    conversationId: match[1] ?? "",
    intakeSessionVersion: Number(match[2]),
    effectType: match[3] ?? "",
  };
}

export function isSameSessionPrompt(input: {
  idempotencyKey: string;
  conversationId: string;
  intakeSessionVersion: number;
  effectType: string;
}): boolean {
  const parsed = parseChatbotIdempotencyKey(input.idempotencyKey);
  if (!parsed) return false;
  return (
    parsed.conversationId === input.conversationId &&
    parsed.intakeSessionVersion === input.intakeSessionVersion &&
    parsed.effectType === input.effectType
  );
}
