import "server-only";

import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";
import { collectedFromRecord, collectedToRecord, parseIntakeField, parseRoutingIntent } from "@/lib/meta/intake-collected";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import type { InstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import {
  createSupabaseMetaStore,
  type MetaInboundStore,
} from "@/lib/meta/store";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const UNIQUE_VIOLATION = "23505";

export type InstagramTicketRow = {
  id: string;
  status: string;
  ticketCode?: string | null;
};

export type InstagramConversationRow = {
  id: string;
  displayName: string | null;
  ticketId: string | null;
  state: string;
  routingIntent: string | null;
  currentIntakeField: string | null;
  lastPromptKey: string | null;
  lastActivityAt: string | null;
  lastProcessedExternalMessageId: string | null;
  collectedData: Record<string, unknown>;
  externalContactId: string | null;
};

export type OutboundMessageRow = {
  id: string;
  externalMessageId: string | null;
  deliveryStatus: string;
  idempotencyKey: string | null;
  recipientExternalId: string | null;
};

export type EmailDeliveryInsert = {
  ticketId: string | null;
  conversationId: string | null;
  commentId?: string | null;
  purpose: string;
  idempotencyKey: string;
};

export type InstagramIngestStore = Omit<
  MetaInboundStore,
  "getConversation" | "insertConversation" | "insertInboundMessage"
> & {
  getConversation(
    channel: "instagram" | "whatsapp",
    externalConversationId: string,
  ): Promise<InstagramConversationRow | null | { errorCode: string }>;
  insertConversation(input: {
    channel: "instagram" | "whatsapp";
    externalConversationId: string;
    externalContactId: string;
    displayName: string | null;
    lastMessageAt: string;
    state?: string;
  }): Promise<
    | { outcome: "inserted"; id: string }
    | { outcome: "duplicate" }
    | { outcome: "failed"; errorCode: string }
  >;
  saveConversationSnapshot(
    id: string,
    snapshot: ConversationSnapshot,
    lastMessageAt: string,
    displayName: string | null,
  ): Promise<{ outcome: "updated" } | { outcome: "failed"; errorCode: string }>;
  getTicket(id: string): Promise<InstagramTicketRow | null | { errorCode: string }>;
  findActiveInstagramTicket(input: {
    externalConversationId: string;
    externalContactId: string;
  }): Promise<InstagramTicketRow | null | { errorCode: string }>;
  insertInstagramTicket(
    row: InstagramTicketInsert,
  ): Promise<
    | { outcome: "inserted"; id: string; ticketCode: string }
    | { outcome: "failed"; errorCode: string }
  >;
  insertInboundMessage(input: {
    conversationId: string;
    channel: "instagram" | "whatsapp";
    externalMessageId: string;
    senderName: string | null;
    senderAddress: string;
    messageBody: string;
    eventFragment: Record<string, unknown>;
    ticketId?: string | null;
    routingKind?: string | null;
    purpose?: string | null;
  }): Promise<
    | { outcome: "inserted"; id: string }
    | { outcome: "duplicate"; id?: string }
    | { outcome: "failed"; errorCode: string }
  >;
  claimOutboundMessage(input: {
    conversationId: string;
    ticketId?: string | null;
    channel: "instagram";
    recipientExternalId: string;
    messageBody: string;
    idempotencyKey: string;
    purpose: string;
    commentId?: string | null;
  }): Promise<
    | { outcome: "claimed"; id: string }
    | { outcome: "duplicate"; id: string; deliveryStatus: string; externalMessageId: string | null }
    | { outcome: "failed"; errorCode: string }
  >;
  markOutboundMessage(
    id: string,
    patch: {
      deliveryStatus: "pending" | "sent" | "delivered" | "failed";
      externalMessageId?: string | null;
      deliveryErrorCode?: string | null;
    },
  ): Promise<void>;
  findOutboundByExternalMessageId(
    externalMessageId: string,
  ): Promise<OutboundMessageRow | null | { errorCode: string }>;
  insertEchoOutboundMessage(input: {
    conversationId: string;
    ticketId?: string | null;
    externalMessageId: string;
    recipientExternalId: string;
    senderAddress: string;
    messageBody: string;
    eventFragment: Record<string, unknown>;
  }): Promise<{ outcome: "inserted" | "duplicate" | "failed"; errorCode?: string }>;
  markMessagesRoutingKind(input: {
    conversationId: string;
    fromKind: string;
    toKind: "collaboration" | "support";
  }): Promise<void>;
  linkSupportMessagesToTicket(input: {
    conversationId: string;
    ticketId: string;
  }): Promise<void>;
  listSupportTranscript(input: {
    conversationId: string;
    ticketId: string;
  }): Promise<Array<{ direction: string; messageBody: string; createdAt: string }>>;
  listFailedOutbounds(conversationId: string): Promise<
    Array<{
      id: string;
      messageBody: string;
      purpose: string | null;
    }>
  >;
  claimEmailDelivery(
    input: EmailDeliveryInsert,
  ): Promise<
    | { outcome: "claimed"; id: string }
    | { outcome: "duplicate"; id: string; deliveryStatus: string }
    | { outcome: "failed"; errorCode: string }
  >;
  markEmailDelivery(
    id: string,
    patch: {
      deliveryStatus: "sent" | "failed" | "skipped";
      brevoMessageId?: string | null;
      errorCode?: string | null;
    },
  ): Promise<void>;
};

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

export function snapshotFromConversationRow(
  row: InstagramConversationRow,
  ticketStatus: string | null,
  suggestedSocialHandle: string | null,
): ConversationSnapshot {
  return {
    state: row.state || "unclassified",
    routingIntent: parseRoutingIntent(row.routingIntent),
    currentIntakeField: parseIntakeField(row.currentIntakeField),
    collected: collectedFromRecord(row.collectedData),
    lastPromptKey: row.lastPromptKey,
    lastActivityAt: row.lastActivityAt,
    lastProcessedExternalMessageId: row.lastProcessedExternalMessageId,
    ticketId: row.ticketId,
    ticketStatus,
    suggestedSocialHandle,
  };
}

export function createSupabaseInstagramStore(
  supabase: SupabaseClient,
): InstagramIngestStore {
  const base = createSupabaseMetaStore(supabase);
  return {
    ...base,
    async getConversation(channel, externalConversationId) {
      const { data, error } = await supabase
        .from("channel_conversations")
        .select(
          "id, display_name, ticket_id, state, routing_intent, current_intake_field, last_prompt_key, last_activity_at, last_processed_external_message_id, collected_data, external_contact_id",
        )
        .eq("channel", channel)
        .eq("external_conversation_id", externalConversationId)
        .maybeSingle();
      if (error) return { errorCode: "conversation_lookup_failed" };
      if (!data?.id) return null;
      return {
        id: data.id as string,
        displayName: (data.display_name as string | null) ?? null,
        ticketId: (data.ticket_id as string | null) ?? null,
        state: String(data.state ?? "unclassified"),
        routingIntent: (data.routing_intent as string | null) ?? null,
        currentIntakeField: (data.current_intake_field as string | null) ?? null,
        lastPromptKey: (data.last_prompt_key as string | null) ?? null,
        lastActivityAt: (data.last_activity_at as string | null) ?? null,
        lastProcessedExternalMessageId:
          (data.last_processed_external_message_id as string | null) ?? null,
        collectedData:
          data.collected_data && typeof data.collected_data === "object"
            ? (data.collected_data as Record<string, unknown>)
            : {},
        externalContactId: (data.external_contact_id as string | null) ?? null,
      };
    },
    async insertConversation(input) {
      const { data, error } = await supabase
        .from("channel_conversations")
        .insert({
          channel: input.channel,
          external_conversation_id: input.externalConversationId,
          external_contact_id: input.externalContactId,
          display_name: input.displayName,
          state: input.state ?? "unclassified",
          routing_intent: "unclassified",
          collected_data: collectedToRecord(emptyIntakeCollected()),
          last_message_at: input.lastMessageAt,
          last_activity_at: input.lastMessageAt,
        })
        .select("id")
        .single();
      if (!error && data?.id) {
        return { outcome: "inserted", id: data.id as string };
      }
      if (isUniqueViolation(error)) return { outcome: "duplicate" };
      return { outcome: "failed", errorCode: "conversation_insert_failed" };
    },
    async saveConversationSnapshot(id, snapshot, lastMessageAt, displayName) {
      const update: Record<string, unknown> = {
        last_message_at: lastMessageAt,
        last_activity_at: snapshot.lastActivityAt ?? lastMessageAt,
        state: snapshot.state,
        routing_intent: snapshot.routingIntent,
        current_intake_field: snapshot.currentIntakeField,
        last_prompt_key: snapshot.lastPromptKey,
        last_processed_external_message_id:
          snapshot.lastProcessedExternalMessageId,
        collected_data: collectedToRecord(snapshot.collected),
        ticket_id: snapshot.ticketId,
      };
      const nextName = displayName?.trim();
      if (nextName) update.display_name = nextName;
      const { error } = await supabase
        .from("channel_conversations")
        .update(update)
        .eq("id", id);
      if (error) return { outcome: "failed", errorCode: "conversation_update_failed" };
      return { outcome: "updated" };
    },
    async getTicket(id) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, status, ticket_code")
        .eq("id", id)
        .maybeSingle();
      if (error) return { errorCode: "ticket_lookup_failed" };
      if (!data?.id) return null;
      return {
        id: data.id as string,
        status: String(data.status ?? ""),
        ticketCode: (data.ticket_code as string | null) ?? null,
      };
    },
    async findActiveInstagramTicket(input) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, status, ticket_code")
        .eq("source_channel", "instagram")
        .eq("external_conversation_id", input.externalConversationId)
        .in("status", ["open", "in_progress", "waiting"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { errorCode: "ticket_lookup_failed" };
      if (data?.id) {
        return {
          id: data.id as string,
          status: String(data.status ?? ""),
          ticketCode: (data.ticket_code as string | null) ?? null,
        };
      }
      const byContact = await supabase
        .from("tickets")
        .select("id, status, ticket_code")
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
        ticketCode: (byContact.data.ticket_code as string | null) ?? null,
      };
    },
    async insertInstagramTicket(row) {
      const { data, error } = await supabase
        .from("tickets")
        .insert(row)
        .select("id, ticket_code")
        .single();
      if (!error && data?.id) {
        return {
          outcome: "inserted",
          id: data.id as string,
          ticketCode: String(data.ticket_code ?? ""),
        };
      }
      return { outcome: "failed", errorCode: "ticket_insert_failed" };
    },
    async insertInboundMessage(input) {
      const { data, error } = await supabase
        .from("channel_messages")
        .insert({
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
          routing_kind: input.routingKind ?? null,
          purpose: input.purpose ?? null,
        })
        .select("id")
        .maybeSingle();
      if (!error) {
        return { outcome: "inserted", id: (data?.id as string | undefined) ?? "" };
      }
      if (isUniqueViolation(error)) {
        const existing = await supabase
          .from("channel_messages")
          .select("id")
          .eq("channel", input.channel)
          .eq("external_message_id", input.externalMessageId)
          .maybeSingle();
        return {
          outcome: "duplicate",
          id: (existing.data?.id as string | undefined) ?? undefined,
        };
      }
      return { outcome: "failed", errorCode: "message_insert_failed" };
    },
    async claimOutboundMessage(input) {
      const { data, error } = await supabase
        .from("channel_messages")
        .insert({
          conversation_id: input.conversationId,
          ticket_id: input.ticketId ?? null,
          channel: input.channel,
          direction: "outbound",
          sender_name: "Cloutflow",
          sender_address: input.recipientExternalId,
          recipient_external_id: input.recipientExternalId,
          message_body: input.messageBody,
          message_type: "text",
          delivery_status: "pending",
          idempotency_key: input.idempotencyKey,
          purpose: input.purpose,
          comment_id: input.commentId ?? null,
          routing_kind: "support",
        })
        .select("id")
        .single();
      if (!error && data?.id) {
        return { outcome: "claimed", id: data.id as string };
      }
      if (!isUniqueViolation(error)) {
        return { outcome: "failed", errorCode: "outbound_insert_failed" };
      }
      const { data: existing, error: lookupError } = await supabase
        .from("channel_messages")
        .select("id, delivery_status, external_message_id")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (lookupError || !existing?.id) {
        return { outcome: "failed", errorCode: "outbound_lookup_failed" };
      }
      return {
        outcome: "duplicate",
        id: existing.id as string,
        deliveryStatus: String(existing.delivery_status ?? "pending"),
        externalMessageId: (existing.external_message_id as string | null) ?? null,
      };
    },
    async markOutboundMessage(id, patch) {
      await supabase
        .from("channel_messages")
        .update({
          delivery_status: patch.deliveryStatus,
          external_message_id: patch.externalMessageId,
          delivery_error_code: patch.deliveryErrorCode ?? null,
        })
        .eq("id", id);
    },
    async findOutboundByExternalMessageId(externalMessageId) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select("id, external_message_id, delivery_status, idempotency_key, recipient_external_id")
        .eq("channel", "instagram")
        .eq("external_message_id", externalMessageId)
        .maybeSingle();
      if (error) return { errorCode: "message_lookup_failed" };
      if (!data?.id) return null;
      return {
        id: data.id as string,
        externalMessageId: (data.external_message_id as string | null) ?? null,
        deliveryStatus: String(data.delivery_status ?? ""),
        idempotencyKey: (data.idempotency_key as string | null) ?? null,
        recipientExternalId: (data.recipient_external_id as string | null) ?? null,
      };
    },
    async insertEchoOutboundMessage(input) {
      const { error } = await supabase.from("channel_messages").insert({
        conversation_id: input.conversationId,
        ticket_id: input.ticketId ?? null,
        channel: "instagram",
        direction: "outbound",
        external_message_id: input.externalMessageId,
        sender_name: "Instagram",
        sender_address: input.senderAddress,
        recipient_external_id: input.recipientExternalId,
        message_body: input.messageBody,
        message_type: "text",
        delivery_status: "sent",
        purpose: "echo_unmatched",
        raw_payload: input.eventFragment,
      });
      if (!error) return { outcome: "inserted" };
      if (isUniqueViolation(error)) return { outcome: "duplicate" };
      return { outcome: "failed", errorCode: "echo_insert_failed" };
    },
    async markMessagesRoutingKind(input) {
      await supabase
        .from("channel_messages")
        .update({ routing_kind: input.toKind })
        .eq("conversation_id", input.conversationId)
        .eq("routing_kind", input.fromKind);
    },
    async linkSupportMessagesToTicket(input) {
      await supabase
        .from("channel_messages")
        .update({ ticket_id: input.ticketId })
        .eq("conversation_id", input.conversationId)
        .eq("routing_kind", "support")
        .is("ticket_id", null);
    },
    async listSupportTranscript(input) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select("direction, message_body, created_at")
        .eq("conversation_id", input.conversationId)
        .eq("ticket_id", input.ticketId)
        .neq("purpose", "internal_note")
        .order("created_at", { ascending: true });
      if (error || !data) return [];
      return data.map((row) => ({
        direction: String(row.direction ?? ""),
        messageBody: String(row.message_body ?? ""),
        createdAt: String(row.created_at ?? ""),
      }));
    },
    async listFailedOutbounds(conversationId) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select("id, message_body, purpose")
        .eq("conversation_id", conversationId)
        .eq("channel", "instagram")
        .eq("direction", "outbound")
        .eq("delivery_status", "failed")
        .order("created_at", { ascending: true });
      if (error || !data) return [];
      return data.map((row) => ({
        id: row.id as string,
        messageBody: String(row.message_body ?? ""),
        purpose: (row.purpose as string | null) ?? null,
      }));
    },
    async claimEmailDelivery(input) {
      const { data, error } = await supabase
        .from("channel_email_deliveries")
        .insert({
          ticket_id: input.ticketId,
          conversation_id: input.conversationId,
          comment_id: input.commentId ?? null,
          purpose: input.purpose,
          idempotency_key: input.idempotencyKey,
          delivery_status: "pending",
        })
        .select("id")
        .single();
      if (!error && data?.id) {
        return { outcome: "claimed", id: data.id as string };
      }
      if (!isUniqueViolation(error)) {
        return { outcome: "failed", errorCode: "email_outbox_insert_failed" };
      }
      const existing = await supabase
        .from("channel_email_deliveries")
        .select("id, delivery_status")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.error || !existing.data?.id) {
        return { outcome: "failed", errorCode: "email_outbox_lookup_failed" };
      }
      return {
        outcome: "duplicate",
        id: existing.data.id as string,
        deliveryStatus: String(existing.data.delivery_status ?? "pending"),
      };
    },
    async markEmailDelivery(id, patch) {
      await supabase
        .from("channel_email_deliveries")
        .update({
          delivery_status: patch.deliveryStatus,
          brevo_message_id: patch.brevoMessageId ?? null,
          error_code: patch.errorCode ?? null,
        })
        .eq("id", id);
    },
  };
}

export function createAdminInstagramStore(): InstagramIngestStore {
  return createSupabaseInstagramStore(createAdminClient());
}
