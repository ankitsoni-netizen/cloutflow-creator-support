import {
  recipientAccountIdFromConversationKey,
  type ConversationLookupIdentity,
} from "@/lib/meta/conversation-identity";
import type { DbTicket } from "@/lib/tickets/types";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";

export function whatsappTicketProvider(
  ticket: DbTicket,
): ConversationLookupIdentity["provider"] {
  const metadata = ticket.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const provider = metadata.provider;
    if (provider === WATI_WHATSAPP_PROVIDER || provider === "meta_whatsapp") {
      return provider;
    }
  }
  return null;
}

export function whatsappCrmConversationLookup(
  ticket: DbTicket,
): ConversationLookupIdentity {
  const conversationId = ticket.external_conversation_id?.trim() || "";
  const contactId = ticket.external_contact_id?.trim() || "";
  return {
    externalContactId: contactId || null,
    recipientAccountId: recipientAccountIdFromConversationKey(
      conversationId,
      contactId,
    ),
    provider: whatsappTicketProvider(ticket),
  };
}
