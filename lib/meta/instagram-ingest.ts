import "server-only";

import { WEBHOOK_STATUS_FAILED } from "@/lib/meta/constants";
import { sha256Hex } from "@/lib/meta/signature";
import {
  createSupabaseMetaStore,
  type MetaInboundStore,
  type PersistContext,
  type PersistResult,
} from "@/lib/meta/store";
import {
  buildInstagramCollectedData,
  isActiveTicketStatus,
  mapInstagramEventToTicketInsert,
  type InstagramTicketInsert,
} from "@/lib/meta/instagram-ticket";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InstagramTicketRow = {
  id: string;
  status: string;
};

export type InstagramIngestStore = MetaInboundStore & {
  getTicket(id: string): Promise<InstagramTicketRow | null | { errorCode: string }>;
  findActiveInstagramTicket(input: {
    externalConversationId: string;
    externalContactId: string;
  }): Promise<InstagramTicketRow | null | { errorCode: string }>;
  insertInstagramTicket(
    row: InstagramTicketInsert,
  ): Promise<
    | { outcome: "inserted"; id: string }
    | { outcome: "failed"; errorCode: string }
  >;
};

async function resolveActiveTicket(
  store: InstagramIngestStore,
  event: NormalizedMetaInboundText,
  conversationTicketId: string | null,
): Promise<
  | { outcome: "found"; id: string }
  | { outcome: "missing" }
  | { outcome: "failed"; errorCode: string }
> {
  if (conversationTicketId) {
    const linked = await store.getTicket(conversationTicketId);
    if (linked && "errorCode" in linked) {
      return { outcome: "failed", errorCode: linked.errorCode };
    }
    if (linked && isActiveTicketStatus(linked.status)) {
      return { outcome: "found", id: linked.id };
    }
  }

  const found = await store.findActiveInstagramTicket({
    externalConversationId: event.externalConversationId,
    externalContactId: event.externalContactId,
  });
  if (found && "errorCode" in found) {
    return { outcome: "failed", errorCode: found.errorCode };
  }
  if (found) return { outcome: "found", id: found.id };
  return { outcome: "missing" };
}

export async function ingestInstagramInboundMessage(
  event: NormalizedMetaInboundText,
  store: InstagramIngestStore,
  context: PersistContext,
): Promise<PersistResult> {
  if (event.channel !== "instagram") {
    return { outcome: "failed", errorCode: "unsupported_channel" };
  }

  const claim = await store.claimWebhookEvent({
    provider: event.provider,
    externalEventId: event.externalEventId,
    payload: context.webhookPayload,
    payloadHash: (() => {
      try {
        return sha256Hex(JSON.stringify(context.webhookPayload));
      } catch {
        return null;
      }
    })(),
  });

  if (claim.outcome === "already_processed") {
    return { outcome: "duplicate" };
  }
  if (claim.outcome === "failed") {
    return { outcome: "failed", errorCode: claim.errorCode };
  }

  const eventId = claim.id;

  try {
    const existing = await store.getConversation(
      event.channel,
      event.externalConversationId,
    );
    if (existing && "errorCode" in existing) {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, existing.errorCode);
      return { outcome: "failed", errorCode: existing.errorCode };
    }

    let conversationId: string;
    let conversationTicketId: string | null = null;

    if (existing) {
      const updated = await store.updateConversation(existing.id, {
        lastMessageAt: event.timestamp,
        displayName: event.displayName,
      });
      if (updated.outcome === "failed") {
        await store.markWebhookEvent(
          eventId,
          WEBHOOK_STATUS_FAILED,
          updated.errorCode,
        );
        return { outcome: "failed", errorCode: updated.errorCode };
      }
      conversationId = existing.id;
      conversationTicketId = existing.ticketId;
    } else {
      const inserted = await store.insertConversation({
        channel: event.channel,
        externalConversationId: event.externalConversationId,
        externalContactId: event.externalContactId,
        displayName: event.displayName,
        lastMessageAt: event.timestamp,
      });
      if (inserted.outcome === "failed") {
        await store.markWebhookEvent(
          eventId,
          WEBHOOK_STATUS_FAILED,
          inserted.errorCode,
        );
        return { outcome: "failed", errorCode: inserted.errorCode };
      }
      if (inserted.outcome === "duplicate") {
        const raced = await store.getConversation(
          event.channel,
          event.externalConversationId,
        );
        if (!raced || "errorCode" in raced) {
          await store.markWebhookEvent(
            eventId,
            WEBHOOK_STATUS_FAILED,
            "conversation_lookup_failed",
          );
          return { outcome: "failed", errorCode: "conversation_lookup_failed" };
        }
        conversationId = raced.id;
        conversationTicketId = raced.ticketId;
      } else {
        conversationId = inserted.id;
      }
    }

    const active = await resolveActiveTicket(
      store,
      event,
      conversationTicketId,
    );
    if (active.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, active.errorCode);
      return { outcome: "failed", errorCode: active.errorCode };
    }

    let ticketId: string;
    if (active.outcome === "found") {
      ticketId = active.id;
    } else {
      const created = await store.insertInstagramTicket(
        mapInstagramEventToTicketInsert(event),
      );
      if (created.outcome === "failed") {
        await store.markWebhookEvent(
          eventId,
          WEBHOOK_STATUS_FAILED,
          created.errorCode,
        );
        return { outcome: "failed", errorCode: created.errorCode };
      }
      ticketId = created.id;
    }

    const createdNewTicket = active.outcome === "missing";
    const linked = await store.updateConversation(conversationId, {
      lastMessageAt: event.timestamp,
      displayName: event.displayName,
      ticketId,
      state: createdNewTicket ? "ticket_created" : undefined,
      collectedData: createdNewTicket
        ? buildInstagramCollectedData(event)
        : undefined,
    });
    if (linked.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, linked.errorCode);
      return { outcome: "failed", errorCode: linked.errorCode };
    }

    const message = await store.insertInboundMessage({
      conversationId,
      channel: event.channel,
      externalMessageId: event.externalMessageId,
      senderName: event.senderName,
      senderAddress: event.senderAddress,
      messageBody: event.messageBody,
      eventFragment: event.eventFragment,
      ticketId,
    });

    if (message.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, message.errorCode);
      return { outcome: "failed", errorCode: message.errorCode };
    }

    await store.markWebhookEvent(eventId, "completed");
    return {
      outcome: message.outcome === "duplicate" ? "duplicate" : "stored",
    };
  } catch {
    try {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, "unexpected_failure");
    } catch {
      // Keep a sanitized failure for Meta retry.
    }
    return { outcome: "failed", errorCode: "unexpected_failure" };
  }
}

export function createSupabaseInstagramStore(
  supabase: SupabaseClient,
): InstagramIngestStore {
  const base = createSupabaseMetaStore(supabase);
  return {
    ...base,
    async getTicket(id) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, status")
        .eq("id", id)
        .maybeSingle();
      if (error) return { errorCode: "ticket_lookup_failed" };
      if (!data?.id) return null;
      return { id: data.id as string, status: String(data.status ?? "") };
    },
    async findActiveInstagramTicket(input) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, status")
        .eq("source_channel", "instagram")
        .eq("external_conversation_id", input.externalConversationId)
        .in("status", ["open", "in_progress", "waiting"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return { errorCode: "ticket_lookup_failed" };
      if (data?.id) {
        return { id: data.id as string, status: String(data.status ?? "") };
      }

      const byContact = await supabase
        .from("tickets")
        .select("id, status")
        .eq("source_channel", "instagram")
        .eq("external_contact_id", input.externalContactId)
        .in("status", ["open", "in_progress", "waiting"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (byContact.error) return { errorCode: "ticket_lookup_failed" };
      if (!byContact.data?.id) return null;
      return {
        id: byContact.data.id as string,
        status: String(byContact.data.status ?? ""),
      };
    },
    async insertInstagramTicket(row) {
      const { data, error } = await supabase
        .from("tickets")
        .insert(row)
        .select("id")
        .single();
      if (!error && data?.id) {
        return { outcome: "inserted", id: data.id as string };
      }
      return { outcome: "failed", errorCode: "ticket_insert_failed" };
    },
  };
}

export function createAdminInstagramStore(): InstagramIngestStore {
  return createSupabaseInstagramStore(createAdminClient());
}
