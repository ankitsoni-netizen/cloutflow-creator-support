"use server";

import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import type { TimelineItem } from "@/lib/tickets/workflow-types";

export async function fetchInstagramTicketTimelineAction(input: {
  ticketId: string;
  externalConversationId: string | null;
}): Promise<{ items: TimelineItem[] } | { error: string }> {
  const context = await getActiveStaffContext();
  if (!context.ok) return { error: context.error };
  if (!input.externalConversationId) return { items: [] };

  try {
    const store = createAdminInstagramStore();
    const conversation = await store.getConversation(
      "instagram",
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
        id: `ig-${input.ticketId}-${index}-${row.createdAt}`,
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
