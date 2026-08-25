export function whatsappExternalConversationId(
  phoneNumberId: string,
  waId: string,
): string {
  return `${phoneNumberId}:${waId}`;
}
