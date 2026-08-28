"use server";

import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { loadTicketById } from "@/lib/tickets/email-delivery";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import { recipientAccountIdFromConversationKey } from "@/lib/meta/conversation-identity";
import type { TimelineItem } from "@/lib/tickets/workflow-types";

export async function fetchInstagramTicketTimelineAction(input: {
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
      "instagram",
      conversationId,
      {
        externalContactId: loaded.data.external_contact_id,
        recipientAccountId: recipientAccountIdFromConversationKey(
          conversationId,
          loaded.data.external_contact_id,
        ),
      },
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
        id: `ig-${loaded.data.id}-${index}-${row.createdAt}`,
        kind: inbound ? "instagram_inbound" : "instagram_outbound",
        timestamp: row.createdAt,
        actor: inbound ? "Creator" : "Cloutflow",
        title: inbound ? "Instagram message" : "Instagram reply",
        detail: row.messageBody,
        visibilityLabel: "Instagram",
      };
    });
    return { items };
  } catch {
    return { error: "Unable to load Instagram messages." };
  }
}
