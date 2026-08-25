"use server";

import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import type { TimelineItem } from "@/lib/tickets/workflow-types";

export async function fetchWhatsAppTicketTimelineAction(input: {
  ticketId: string;
  externalConversationId: string | null;
}): Promise<{ items: TimelineItem[] } | { error: string }> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };
  if (!input.externalConversationId) return { items: [] };

  try {
    const store = createAdminInstagramStore();
    const conversation = await store.getConversation(
      "whatsapp",
      input.externalConversationId,
    );
    if (!conversation || "errorCode" in conversation) return { items: [] };

    const rows = await store.listSupportTranscript({
      conversationId: conversation.id,
      ticketId: input.ticketId,
    });

    const items: TimelineItem[] = rows.map((row, index) => {
      const inbound = row.direction === "inbound";
      return {
        id: `wa-${input.ticketId}-${index}-${row.createdAt}`,
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
