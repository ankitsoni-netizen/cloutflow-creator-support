import "server-only";

import {
  WEBHOOK_STATUS_COMPLETED,
  WEBHOOK_STATUS_FAILED,
  WEBHOOK_STATUS_PROCESSING,
} from "@/lib/meta/constants";
import { sha256Hex } from "@/lib/meta/signature";
import {
  IDENTITY_MISSING,
  channelIdentityFromInbound,
  conversationIdentityFromLookup,
  conversationLookupIds,
  findConversationForIdentity,
  type ConversationLookupIdentity,
} from "@/lib/meta/conversation-identity";
import {
  IDENTITY_SCHEMA_UNAVAILABLE,
  isIdentitySchemaPhaseC,
} from "@/lib/meta/identity-schema-phase";
import type {
  ChannelWebhookProvider,
  MetaChannel,
  NormalizedMetaInboundText,
} from "@/lib/meta/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const UNIQUE_VIOLATION = "23505";

export type PersistOutcome = "stored" | "duplicate" | "failed";

export type PersistResult = {
  outcome: PersistOutcome;
  errorCode?: string;
};

export type PersistContext = {
  webhookPayload: unknown;
};

type ConversationRow = {
  id: string;
  displayName: string | null;
  ticketId: string | null;
  externalContactId?: string | null;
};

export type MetaInboundStore = {
  claimWebhookEvent(input: {
    provider: ChannelWebhookProvider;
    externalEventId: string;
    payload: unknown;
    payloadHash: string | null;
  }): Promise<
    | { outcome: "claimed" | "retry"; id: string }
    | { outcome: "already_processed" }
    | { outcome: "failed"; errorCode: string }
  >;
  markWebhookEvent(
    id: string,
    status: "completed" | "failed",
    errorCode?: string | null,
  ): Promise<void>;
  getConversation(
    channel: MetaChannel,
    externalConversationId: string,
    lookup?: ConversationLookupIdentity,
  ): Promise<ConversationRow | null | { errorCode: string }>;
  insertConversation(input: {
    channel: MetaChannel;
    externalConversationId: string;
    externalContactId: string;
    displayName: string | null;
    lastMessageAt: string;
    provider?: string | null;
    recipientAccountId?: string | null;
  }): Promise<
    | { outcome: "inserted"; id: string }
    | { outcome: "duplicate" }
    | { outcome: "failed"; errorCode: string }
  >;
  updateConversation(
    id: string,
    patch: {
      lastMessageAt: string;
      displayName: string | null;
      ticketId?: string | null;
      state?: string;
      collectedData?: Record<string, unknown>;
    },
  ): Promise<{ outcome: "updated" } | { outcome: "failed"; errorCode: string }>;
  insertInboundMessage(input: {
    conversationId: string;
    channel: MetaChannel;
    externalMessageId: string;
    senderName: string | null;
    senderAddress: string;
    messageBody: string;
    eventFragment: Record<string, unknown>;
    ticketId?: string | null;
  }): Promise<
    | { outcome: "inserted" }
    | { outcome: "duplicate" }
    | { outcome: "failed"; errorCode: string }
  >;
};

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

function isAlreadyProcessedStatus(status: string): boolean {
  return status === WEBHOOK_STATUS_COMPLETED || status === "processed";
}

function hashPayload(payload: unknown): string | null {
  try {
    return sha256Hex(JSON.stringify(payload));
  } catch {
    return null;
  }
}

export async function persistNormalizedInboundMessage(
  event: NormalizedMetaInboundText,
  store: MetaInboundStore,
  context: PersistContext,
): Promise<PersistResult> {
  const claim = await store.claimWebhookEvent({
    provider: event.provider,
    externalEventId: event.externalEventId,
    payload: context.webhookPayload,
    payloadHash: hashPayload(context.webhookPayload),
  });

  if (claim.outcome === "already_processed") {
    return { outcome: "duplicate" };
  }
  if (claim.outcome === "failed") {
    return { outcome: "failed", errorCode: claim.errorCode };
  }

  const eventId = claim.id;
  const identity = channelIdentityFromInbound(event);
  if (!identity) {
    await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, IDENTITY_MISSING);
    return { outcome: "failed", errorCode: IDENTITY_MISSING };
  }

  try {
    const existing = await store.getConversation(
      identity.channel,
      identity.externalConversationId,
      {
        externalContactId: identity.externalContactId,
        provider: identity.provider,
        recipientAccountId: identity.recipientAccountId,
      },
    );
    if (existing && "errorCode" in existing) {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, existing.errorCode);
      return { outcome: "failed", errorCode: existing.errorCode };
    }

    let conversationId: string;
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
    } else {
      const inserted = await store.insertConversation({
        channel: identity.channel,
        externalConversationId: identity.externalConversationId,
        externalContactId: identity.externalContactId,
        displayName: event.displayName,
        lastMessageAt: event.timestamp,
        provider: identity.provider,
        recipientAccountId: identity.recipientAccountId,
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
          identity.channel,
          identity.externalConversationId,
          {
            externalContactId: identity.externalContactId,
            provider: identity.provider,
            recipientAccountId: identity.recipientAccountId,
          },
        );
        if (!raced || "errorCode" in raced) {
          await store.markWebhookEvent(
            eventId,
            WEBHOOK_STATUS_FAILED,
            "conversation_lookup_failed",
          );
          return { outcome: "failed", errorCode: "conversation_lookup_failed" };
        }
        const updated = await store.updateConversation(raced.id, {
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
        conversationId = raced.id;
      } else {
        conversationId = inserted.id;
      }
    }

    const message = await store.insertInboundMessage({
      conversationId,
      channel: event.channel,
      externalMessageId: event.externalMessageId,
      senderName: event.senderName,
      senderAddress: event.senderAddress,
      messageBody: event.messageBody,
      eventFragment: event.eventFragment,
    });

    if (message.outcome === "failed") {
      await store.markWebhookEvent(eventId, WEBHOOK_STATUS_FAILED, message.errorCode);
      return { outcome: "failed", errorCode: message.errorCode };
    }

    await store.markWebhookEvent(eventId, WEBHOOK_STATUS_COMPLETED);
    return {
      outcome: message.outcome === "duplicate" ? "duplicate" : "stored",
    };
  } catch {
    try {
      await store.markWebhookEvent(
        eventId,
        WEBHOOK_STATUS_FAILED,
        "unexpected_failure",
      );
    } catch {
      // Event row may already exist; still report failure to the caller.
    }
    return { outcome: "failed", errorCode: "unexpected_failure" };
  }
}

export function createSupabaseMetaStore(
  supabase: SupabaseClient,
): MetaInboundStore {
  return {
    async claimWebhookEvent(input) {
      const { data, error } = await supabase
        .from("webhook_events")
        .insert({
          provider: input.provider,
          external_event_id: input.externalEventId,
          payload: input.payload ?? {},
          payload_hash: input.payloadHash,
          processing_status: WEBHOOK_STATUS_PROCESSING,
        })
        .select("id")
        .single();

      if (!error && data?.id) {
        return { outcome: "claimed", id: data.id as string };
      }

      if (!isUniqueViolation(error)) {
        return { outcome: "failed", errorCode: "webhook_event_insert_failed" };
      }

      const { data: existing, error: lookupError } = await supabase
        .from("webhook_events")
        .select("id, processing_status")
        .eq("provider", input.provider)
        .eq("external_event_id", input.externalEventId)
        .maybeSingle();

      if (lookupError || !existing?.id) {
        return { outcome: "failed", errorCode: "webhook_event_lookup_failed" };
      }

      const status = String(existing.processing_status ?? "");
      if (isAlreadyProcessedStatus(status)) {
        return { outcome: "already_processed" };
      }

      const { error: retryError } = await supabase
        .from("webhook_events")
        .update({
          processing_status: WEBHOOK_STATUS_PROCESSING,
          error_code: null,
          error_message: null,
          processed_at: null,
        })
        .eq("id", existing.id);

      if (retryError) {
        return { outcome: "failed", errorCode: "webhook_event_retry_failed" };
      }

      return { outcome: "retry", id: existing.id as string };
    },

    async markWebhookEvent(id, status, errorCode = null) {
      const failed = status === WEBHOOK_STATUS_FAILED;
      await supabase
        .from("webhook_events")
        .update({
          processing_status: status,
          error_code: failed ? errorCode : null,
          error_message: failed ? errorCode : null,
          processed_at: failed ? null : new Date().toISOString(),
        })
        .eq("id", id);
    },

    async getConversation(channel, externalConversationId, lookup) {
      const identity = conversationIdentityFromLookup({
        channel,
        externalConversationId,
        externalContactId: lookup?.externalContactId,
        provider: lookup?.provider,
        recipientAccountId: lookup?.recipientAccountId,
      });
      if (!identity) {
        return { errorCode: IDENTITY_MISSING };
      }
      const ids = conversationLookupIds(identity);
      const collected: Array<
        ConversationRow & { externalConversationId: string | null }
      > = [];
      for (const conversationId of ids) {
        const { data, error } = await supabase
          .from("channel_conversations")
          .select(
            "id, display_name, ticket_id, external_contact_id, external_conversation_id",
          )
          .eq("channel", channel)
          .eq("external_conversation_id", conversationId)
          .maybeSingle();

        if (error) {
          return { errorCode: "conversation_lookup_failed" };
        }
        if (!data?.id) continue;
        collected.push({
          id: data.id as string,
          displayName: (data.display_name as string | null) ?? null,
          ticketId: (data.ticket_id as string | null) ?? null,
          externalContactId: (data.external_contact_id as string | null) ?? null,
          externalConversationId:
            (data.external_conversation_id as string | null) ?? conversationId,
        });
      }
      const matched = findConversationForIdentity(
        collected.map((row) => ({
          ...row,
          channel,
          external_contact_id: row.externalContactId,
          external_conversation_id: row.externalConversationId,
        })),
        identity,
      );
      if (matched && "errorCode" in matched) return matched;
      if (!matched) return null;
      const found = collected.find((row) => row.id === matched.id);
      if (!found) return null;
      return {
        id: found.id,
        displayName: found.displayName,
        ticketId: found.ticketId,
        externalContactId: found.externalContactId,
      };
    },

    async insertConversation(input) {
      if (!input.externalContactId.trim() || !input.externalConversationId.trim()) {
        return { outcome: "failed", errorCode: IDENTITY_MISSING };
      }
      const insertRow: Record<string, unknown> = {
        channel: input.channel,
        external_conversation_id: input.externalConversationId,
        external_contact_id: input.externalContactId,
        display_name: input.displayName,
        state: "new",
        collected_data: {},
        last_message_at: input.lastMessageAt,
      };
      if (isIdentitySchemaPhaseC()) {
        if (input.provider?.trim()) insertRow.provider = input.provider.trim();
        if (input.recipientAccountId?.trim()) {
          insertRow.recipient_account_id = input.recipientAccountId.trim();
        }
      }
      const { data, error } = await supabase
        .from("channel_conversations")
        .insert(insertRow)
        .select("id")
        .single();

      if (!error && data?.id) {
        return { outcome: "inserted", id: data.id as string };
      }
      if (error?.code === "42703" && isIdentitySchemaPhaseC()) {
        return { outcome: "failed", errorCode: IDENTITY_SCHEMA_UNAVAILABLE };
      }
      if (isUniqueViolation(error)) {
        return { outcome: "duplicate" };
      }
      return { outcome: "failed", errorCode: "conversation_insert_failed" };
    },

    async updateConversation(id, patch) {
      const update: {
        last_message_at: string;
        display_name?: string;
        ticket_id?: string | null;
        state?: string;
        collected_data?: Record<string, unknown>;
      } = {
        last_message_at: patch.lastMessageAt,
      };
      const nextName = patch.displayName?.trim();
      if (nextName) {
        update.display_name = nextName;
      }
      if (patch.ticketId !== undefined) {
        update.ticket_id = patch.ticketId;
      }
      if (patch.state) {
        update.state = patch.state;
      }
      if (patch.collectedData) {
        update.collected_data = patch.collectedData;
      }

      const { error } = await supabase
        .from("channel_conversations")
        .update(update)
        .eq("id", id);

      if (error) {
        return { outcome: "failed", errorCode: "conversation_update_failed" };
      }
      return { outcome: "updated" };
    },

    async insertInboundMessage(input) {
      const { error } = await supabase.from("channel_messages").insert({
        conversation_id: input.conversationId,
        ticket_id: input.ticketId ?? null,
        channel: input.channel,
        direction: "inbound",
        external_message_id: input.externalMessageId,
        sender_name: input.senderName,
        sender_address: input.senderAddress,
        message_body: input.messageBody,
        message_type: "text",
        delivery_status: "received",
        raw_payload: input.eventFragment,
      });

      if (!error) return { outcome: "inserted" };
      if (isUniqueViolation(error)) return { outcome: "duplicate" };
      return { outcome: "failed", errorCode: "message_insert_failed" };
    },
  };
}

export function createAdminMetaStore(): MetaInboundStore {
  return createSupabaseMetaStore(createAdminClient());
}
