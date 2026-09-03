"use server";

import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { loadTicketById } from "@/lib/tickets/email-delivery";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import { whatsappCrmConversationLookup } from "@/lib/tickets/whatsapp-crm-identity";
import type { TimelineItem } from "@/lib/tickets/workflow-types";

export async function fetchWhatsAppTicketTimelineAction(input: {
  ticketId: string;
  externalConversationId: string | null;
}): Promise<{ items: TimelineItem[] } | { error: string }> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };

  const loaded = await loadTicketById(context.supabase, input.ticketId);
  if ("error" in loaded) return { error: loaded.error };

  const conversationId =
    loaded.data.external_conversation_id?.trim() ||
    input.externalConversationId?.trim() ||
    "";
  if (!conversationId) return { items: [] };

  try {
    const store = createAdminInstagramStore();
    const conversation = await store.getConversation(
      "whatsapp",
      conversationId,
      whatsappCrmConversationLookup(loaded.data),
    );
    if (!conversation || "errorCode" in conversation) return { items: [] };
    if (
      conversation.externalContactId &&
      loaded.data.external_contact_id &&
      conversation.externalContactId !== loaded.data.external_contact_id
    ) {
      return { items: [] };
    }

    const rows = await store.listSupportTranscript({
      conversationId: conversation.id,
      ticketId: loaded.data.id,
    });

    const items: TimelineItem[] = rows.map((row, index) => {
      const inbound = row.direction === "inbound";
      return {
        id: `wa-${loaded.data.id}-${index}-${row.createdAt}`,
        kind: inbound ? "whatsapp_inbound" : "whatsapp_outbound",
        timestamp: row.createdAt,
        actor: inbound ? "Creator" : "Cloutflow",
        title: inbound ? "WhatsApp message" : "WhatsApp reply",
        detail: row.messageBody,
        visibilityLabel: "WhatsApp",
      };
    });
    return { items };
  } catch {
    return { error: "Unable to load WhatsApp messages." };
  }
}
