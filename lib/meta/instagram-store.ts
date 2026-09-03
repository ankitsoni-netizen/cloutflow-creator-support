import "server-only";

import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";
import { collectedFromRecord, collectedToRecord, parseIntakeField, parseRoutingIntent } from "@/lib/meta/intake-collected";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import type { InstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import {
  IDENTITY_AMBIGUOUS,
  IDENTITY_MISSING,
  conversationLookupIds,
  conversationIdentityFromLookup,
  decidePhaseACanonicalIdentityPromotion,
  findActiveTicketForIdentity,
  findConversationForIdentity,
  outboundIdentityAllowsReply,
  type ConversationIdentity,
  type ConversationLookupIdentity,
} from "@/lib/meta/conversation-identity";
import {
  IDENTITY_SCHEMA_UNAVAILABLE,
  isIdentitySchemaPhaseC,
} from "@/lib/meta/identity-schema-phase";
import {
  INSTAGRAM_EMAIL_DRAIN_PURPOSES,
  isInstagramEmailDrainPurpose,
  isInstagramEmailTerminalError,
} from "@/lib/meta/email-drain-purposes";
import {
  isCompatibleInstagramOutboundDuplicate,
  instagramOutboundAddressesAreAssigned,
  parseReserveRpcError,
  shouldFallbackReserveRpc,
} from "@/lib/meta/instagram-reserve";
import { parseWatiReserveRpcError } from "@/lib/wati/reserve";
import { isInstagramTerminalSendError } from "@/lib/meta/instagram-send";
import { isWatiTerminalSendError } from "@/lib/wati/outbox-errors";
import {
  durableInstagramOutboundPayload,
  type SanitizedInstagramOutboundPayload,
} from "@/lib/meta/instagram-outbound-payload";
import {
  WEBHOOK_PROCESSING_LEASE_MS,
  WEBHOOK_STATUS_PROCESSING,
} from "@/lib/meta/constants";
import {
  createSupabaseMetaStore,
  type MetaInboundStore,
} from "@/lib/meta/store";
import { decideExistingWebhookEventClaim } from "@/lib/meta/webhook-event-claim";
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
  intakeSessionVersion: number;
  provider?: string | null;
  recipientAccountId?: string | null;
  externalConversationId?: string | null;
  identityStatus?: string | null;
};

export type OutboundMessageRow = {
  id: string;
  externalMessageId: string | null;
  deliveryStatus: string;
  idempotencyKey: string | null;
  recipientExternalId: string | null;
  conversationId: string | null;
};

export type ReservedOutboundRow = {
  id: string;
  idempotencyKey: string;
  deliveryStatus: string;
  claimed: boolean;
};

export type DueInstagramOutboundRow = {
  id: string;
  conversationId: string;
  recipientExternalId: string;
  messageBody: string;
  purpose: string | null;
  deliveryStatus: string;
  deliveryErrorCode: string | null;
  deliveryAttemptCount: number;
  nextAttemptAt: string | null;
  rawPayload: unknown;
};

export type OutboundReserveInput = {
  channel: "instagram" | "whatsapp";
  recipientExternalId: string;
  senderAddress?: string | null;
  messageBody: string;
  idempotencyKey: string;
  purpose: string;
  ticketId?: string | null;
  routingKind?: string | null;
  rawPayload?: SanitizedInstagramOutboundPayload | Record<string, unknown> | null;
};

const CONVERSATION_SELECT_PHASE_A =
  "id, display_name, ticket_id, state, routing_intent, current_intake_field, last_prompt_key, last_activity_at, last_processed_external_message_id, collected_data, external_contact_id, external_conversation_id, intake_session_version";

const CONVERSATION_SELECT_PHASE_C = `${CONVERSATION_SELECT_PHASE_A}, provider, recipient_account_id, identity_status`;

function conversationSelect(): typeof CONVERSATION_SELECT_PHASE_A {
  return (isIdentitySchemaPhaseC()
    ? CONVERSATION_SELECT_PHASE_C
    : CONVERSATION_SELECT_PHASE_A) as typeof CONVERSATION_SELECT_PHASE_A;
}

export type DueInstagramEmailDeliveryRow = {
  id: string;
  ticketId: string | null;
  conversationId: string | null;
  purpose: string;
  deliveryStatus: string;
  errorCode: string | null;
  updatedAt: string | null;
};

export type InstagramEmailConversationContext = {
  id: string;
  collectedData: Record<string, unknown>;
  externalConversationId: string | null;
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
    lookup?: ConversationLookupIdentity,
  ): Promise<InstagramConversationRow | null | { errorCode: string }>;
  promoteEligiblePhaseACanonicalIdentity(
    identity: ConversationIdentity,
  ): Promise<
    | { outcome: "promoted"; row: InstagramConversationRow }
    | { outcome: "already_promoted"; row: InstagramConversationRow }
    | { outcome: "not_found" }
    | { outcome: "not_eligible"; errorCode: string }
  >;
  insertConversation(input: {
    channel: "instagram" | "whatsapp";
    externalConversationId: string;
    externalContactId: string;
    displayName: string | null;
    lastMessageAt: string;
    state?: string;
    provider?: string | null;
    recipientAccountId?: string | null;
  }): Promise<
    | { outcome: "inserted"; id: string; row: InstagramConversationRow }
    | { outcome: "duplicate" }
    | { outcome: "failed"; errorCode: string }
  >;
  reserveOutboundAndSnapshot(input: {
    conversationId: string;
    snapshot: ConversationSnapshot;
    lastMessageAt: string;
    displayName: string | null;
    expectedLastProcessedExternalMessageId: string | null;
    outbounds: OutboundReserveInput[];
  }): Promise<
    | { outcome: "reserved"; outbounds: ReservedOutboundRow[] }
    | { outcome: "failed"; errorCode: string }
  >;
  reserveWatiOutboundAndSnapshot(input: {
    conversationId: string;
    snapshot: ConversationSnapshot;
    lastMessageAt: string;
    displayName: string | null;
    expectedLastProcessedExternalMessageId: string | null;
    outbounds: OutboundReserveInput[];
  }): Promise<
    | { outcome: "reserved"; outbounds: ReservedOutboundRow[] }
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
    sourceChannel?: "instagram" | "whatsapp";
    provider?: string | null;
    recipientAccountId?: string | null;
  }): Promise<InstagramTicketRow | null | { errorCode: string }>;
  insertInstagramTicket(
    row: InstagramTicketInsert,
  ): Promise<
    | { outcome: "inserted"; id: string; ticketCode: string }
    | { outcome: "duplicate"; id: string; ticketCode: string }
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
    channel: "instagram" | "whatsapp";
    recipientExternalId: string;
    senderAddress?: string | null;
    messageBody: string;
    idempotencyKey: string;
    purpose: string;
    commentId?: string | null;
    rawPayload?: unknown;
  }  ): Promise<
    | { outcome: "claimed"; id: string }
    | {
        outcome: "duplicate";
        id: string;
        deliveryStatus: string;
        externalMessageId: string | null;
        conversationId: string | null;
        idempotencyKey: string | null;
      }
    | { outcome: "failed"; errorCode: string }
  >;
  markOutboundMessage(
    id: string,
    patch: {
      deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed";
      externalMessageId?: string | null;
      deliveryErrorCode?: string | null;
      nextAttemptAt?: string | null;
      lastAttemptAt?: string | null;
      deliveryAttemptCount?: number;
    },
  ): Promise<void>;
  findOutboundByExternalMessageId(
    externalMessageId: string,
  ): Promise<OutboundMessageRow | null | { errorCode: string }>;
  findOutboundByIdempotencyKey(
    idempotencyKey: string,
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
  listRetryableOutbounds(conversationId: string): Promise<
    Array<{
      id: string;
      messageBody: string;
      purpose: string | null;
      rawPayload?: unknown;
      recipientExternalId?: string | null;
      deliveryStatus?: string;
    }>
  >;
  listDueInstagramOutbounds(
    conversationId: string,
    nowIso: string,
  ): Promise<DueInstagramOutboundRow[] | { errorCode: string }>;
  listDueInstagramOutboxBatch(input: {
    nowIso: string;
    limit: number;
  }): Promise<DueInstagramOutboundRow[] | { errorCode: string }>;
  getConversationEmailContext(
    conversationId: string,
  ): Promise<InstagramEmailConversationContext | null | { errorCode: string }>;
  listDueInstagramEmailDeliveries(input: {
    nowIso: string;
    limit: number;
  }): Promise<DueInstagramEmailDeliveryRow[] | { errorCode: string }>;
  claimInstagramEmailRetry(input: {
    id: string;
    observedUpdatedAt: string | null;
    nowIso: string;
  }): Promise<
    | { outcome: "claimed"; id: string }
    | { outcome: "skipped" }
    | { outcome: "failed"; errorCode: string }
  >;
  claimInstagramOutboundSend(input: {
    id: string;
    now: string;
    maxAttempts: number;
  }): Promise<
    | { outcome: "claimed"; attemptCount: number }
    | { outcome: "skipped" }
    | { outcome: "failed"; errorCode: string }
  >;
  listDueWatiOutbounds(
    conversationId: string,
    nowIso: string,
  ): Promise<DueInstagramOutboundRow[] | { errorCode: string }>;
  listDueWatiOutboxBatch(input: {
    nowIso: string;
    limit: number;
  }): Promise<DueInstagramOutboundRow[] | { errorCode: string }>;
  claimWatiOutboundSend(input: {
    id: string;
    now: string;
    maxAttempts: number;
  }): Promise<
    | { outcome: "claimed"; attemptCount: number }
    | { outcome: "skipped" }
    | { outcome: "failed"; errorCode: string }
  >;
  findPendingTimeoutOutbound(input: {
    conversationId: string;
    messageBody: string;
  }): Promise<OutboundMessageRow | null | { errorCode: string }>;
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

function parseReservedOutbounds(data: unknown): ReservedOutboundRow[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rows = (data as Record<string, unknown>).outbounds;
  if (!Array.isArray(rows)) return null;
  const parsed: ReservedOutboundRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) return null;
    if (typeof record.idempotency_key !== "string") return null;
    parsed.push({
      id: record.id,
      idempotencyKey: record.idempotency_key,
      deliveryStatus: String(record.delivery_status ?? "pending"),
      claimed: record.claimed === true,
    });
  }
  return parsed;
}

function mapConversationRow(
  data: Record<string, unknown>,
): InstagramConversationRow {
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
    intakeSessionVersion:
      typeof data.intake_session_version === "number"
        ? data.intake_session_version
        : Number(data.intake_session_version ?? 0) || 0,
    provider: (data.provider as string | null) ?? null,
    recipientAccountId: (data.recipient_account_id as string | null) ?? null,
    externalConversationId:
      (data.external_conversation_id as string | null) ?? null,
    identityStatus: (data.identity_status as string | null) ?? null,
  };
}

const INSTAGRAM_OUTBOX_MAX_ATTEMPTS_DEFAULT = 5;

const DUE_OUTBOUND_SELECT =
  "id, conversation_id, recipient_external_id, message_body, purpose, delivery_status, delivery_error_code, delivery_attempt_count, next_attempt_at, raw_payload";

const DUE_OUTBOUND_SELECT_LEGACY =
  "id, conversation_id, recipient_external_id, message_body, purpose, delivery_status, delivery_error_code, raw_payload";

function mapDueInstagramOutboundRow(
  row: Record<string, unknown>,
  attemptFallback = 0,
): DueInstagramOutboundRow {
  return {
    id: String(row.id ?? ""),
    conversationId: String(row.conversation_id ?? ""),
    recipientExternalId: String(row.recipient_external_id ?? ""),
    messageBody: String(row.message_body ?? ""),
    purpose: (row.purpose as string | null) ?? null,
    deliveryStatus: String(row.delivery_status ?? "pending"),
    deliveryErrorCode: (row.delivery_error_code as string | null) ?? null,
    deliveryAttemptCount:
      Number(row.delivery_attempt_count ?? attemptFallback) || attemptFallback,
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    rawPayload: row.raw_payload ?? null,
  };
}

function isDueOutboundRecord(
  row: Record<string, unknown>,
  now: number,
  maxAttempts: number,
  isTerminal: (code: string | null) => boolean,
): boolean {
  const attempts = Number(row.delivery_attempt_count ?? 0) || 0;
  const nextAt = row.next_attempt_at ? Date.parse(String(row.next_attempt_at)) : 0;
  const due = !row.next_attempt_at || (!Number.isNaN(nextAt) && nextAt <= now);
  const terminal = isTerminal((row.delivery_error_code as string | null) ?? null);
  return attempts < maxAttempts && due && !terminal;
}

async function listDueChannelOutboundRows(
  supabase: SupabaseClient,
  input: {
    channel: "instagram" | "whatsapp";
    conversationId?: string;
    nowIso: string;
    limit: number;
    isTerminal: (code: string | null) => boolean;
  },
): Promise<DueInstagramOutboundRow[] | { errorCode: string }> {
  let query = supabase
    .from("channel_messages")
    .select(DUE_OUTBOUND_SELECT)
    .eq("channel", input.channel)
    .eq("direction", "outbound")
    .in("delivery_status", ["pending", "failed"])
    .neq("purpose", "staff_reply")
    .order("created_at", { ascending: true })
    .limit(Math.max(1, input.limit));
  if (input.conversationId) {
    query = query.eq("conversation_id", input.conversationId);
  }
  const { data, error } = await query;
  if (error) {
    if (error.code === "42703") {
      let fallbackQuery = supabase
        .from("channel_messages")
        .select(DUE_OUTBOUND_SELECT_LEGACY)
        .eq("channel", input.channel)
        .eq("direction", "outbound")
        .in("delivery_status", ["pending", "failed"])
        .neq("purpose", "staff_reply")
        .order("created_at", { ascending: true })
        .limit(Math.max(1, input.limit));
      if (input.conversationId) {
        fallbackQuery = fallbackQuery.eq("conversation_id", input.conversationId);
      }
      const fallback = await fallbackQuery;
      if (fallback.error || !fallback.data) {
        return { errorCode: "outbound_lookup_failed" };
      }
      return fallback.data.map((row) =>
        mapDueInstagramOutboundRow(row as Record<string, unknown>, 0),
      );
    }
    return { errorCode: "outbound_lookup_failed" };
  }
  const now = Date.parse(input.nowIso);
  return (data ?? [])
    .filter((row) =>
      isDueOutboundRecord(
        row as Record<string, unknown>,
        now,
        INSTAGRAM_OUTBOX_MAX_ATTEMPTS_DEFAULT,
        input.isTerminal,
      ),
    )
    .map((row) => mapDueInstagramOutboundRow(row as Record<string, unknown>));
}

async function listDueInstagramRows(
  supabase: SupabaseClient,
  input: { conversationId?: string; nowIso: string; limit: number },
): Promise<DueInstagramOutboundRow[] | { errorCode: string }> {
  return listDueChannelOutboundRows(supabase, {
    ...input,
    channel: "instagram",
    isTerminal: isInstagramTerminalSendError,
  });
}

async function listDueWatiRows(
  supabase: SupabaseClient,
  input: { conversationId?: string; nowIso: string; limit: number },
): Promise<DueInstagramOutboundRow[] | { errorCode: string }> {
  return listDueChannelOutboundRows(supabase, {
    ...input,
    channel: "whatsapp",
    isTerminal: isWatiTerminalSendError,
  });
}

function durableReservePayload(outbound: OutboundReserveInput) {
  return durableInstagramOutboundPayload({
    text: outbound.messageBody,
    rawPayload: outbound.rawPayload,
  });
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
    ticketCode: null,
    suggestedSocialHandle,
    suggestedPhone: null,
    intakeSessionVersion: row.intakeSessionVersion,
  };
}

export function createSupabaseInstagramStore(
  supabase: SupabaseClient,
): InstagramIngestStore {
  const base = createSupabaseMetaStore(supabase);
  return {
    ...base,
    async claimWebhookEvent(input) {
      const nowMs = Date.now();
      const leaseAt = new Date(nowMs).toISOString();
      const { data, error } = await supabase
        .from("webhook_events")
        .insert({
          provider: input.provider,
          external_event_id: input.externalEventId,
          payload: input.payload ?? {},
          payload_hash: input.payloadHash,
          processing_status: WEBHOOK_STATUS_PROCESSING,
          processed_at: leaseAt,
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
        .select("id, processing_status, processed_at")
        .eq("provider", input.provider)
        .eq("external_event_id", input.externalEventId)
        .maybeSingle();

      if (lookupError || !existing?.id) {
        return { outcome: "failed", errorCode: "webhook_event_lookup_failed" };
      }

      const decision = decideExistingWebhookEventClaim(
        {
          id: String(existing.id),
          processingStatus: String(existing.processing_status ?? ""),
          processedAt:
            (existing.processed_at as string | null | undefined) ?? null,
        },
        nowMs,
      );
      if (
        decision.action === "already_processed" ||
        decision.action === "lease_held"
      ) {
        return { outcome: "already_processed" };
      }

      const status = String(existing.processing_status ?? "");
      let reclaim = supabase
        .from("webhook_events")
        .update({
          processing_status: WEBHOOK_STATUS_PROCESSING,
          error_code: null,
          error_message: null,
          processed_at: leaseAt,
        })
        .eq("id", existing.id);

      if (status === WEBHOOK_STATUS_PROCESSING) {
        const expiredIso = new Date(
          nowMs - WEBHOOK_PROCESSING_LEASE_MS,
        ).toISOString();
        reclaim = reclaim.eq("processing_status", WEBHOOK_STATUS_PROCESSING);
        const processedAt =
          (existing.processed_at as string | null | undefined) ?? null;
        reclaim = processedAt
          ? reclaim.lt("processed_at", expiredIso)
          : reclaim.is("processed_at", null);
      } else {
        reclaim = reclaim.eq("processing_status", status);
      }

      const { data: reclaimed, error: retryError } = await reclaim
        .select("id")
        .maybeSingle();
      if (retryError) {
        return { outcome: "failed", errorCode: "webhook_event_retry_failed" };
      }
      if (!reclaimed?.id) {
        return { outcome: "already_processed" };
      }
      return { outcome: "retry", id: existing.id as string };
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

      const collected: InstagramConversationRow[] = [];
      for (const conversationId of ids) {
        const { data, error } = await supabase
          .from("channel_conversations")
          .select(conversationSelect())
          .eq("channel", channel)
          .eq("external_conversation_id", conversationId)
          .maybeSingle();
        if (error) {
          if (error.code === "42703" && isIdentitySchemaPhaseC()) {
            return { errorCode: IDENTITY_SCHEMA_UNAVAILABLE };
          }
          return { errorCode: "conversation_lookup_failed" };
        }
        if (!data?.id) continue;
        collected.push(mapConversationRow(data as Record<string, unknown>));
      }

      const matched = findConversationForIdentity(
        collected.map((row) => ({
          ...row,
          channel,
          external_contact_id: row.externalContactId,
          external_conversation_id: row.externalConversationId,
          recipient_account_id: row.recipientAccountId,
          provider: row.provider,
        })),
        identity,
      );
      if (matched && "errorCode" in matched) return matched;
      if (matched) {
        const row = collected.find((item) => item.id === matched.id) ?? null;
        if (
          row &&
          isIdentitySchemaPhaseC() &&
          !outboundIdentityAllowsReply(row.identityStatus)
        ) {
          return { errorCode: IDENTITY_AMBIGUOUS };
        }
        return row;
      }

      const byContact = await supabase
        .from("channel_conversations")
        .select(conversationSelect())
        .eq("channel", channel)
        .eq("external_contact_id", identity.externalContactId)
        .limit(5);
      if (byContact.error) {
        if (byContact.error.code === "42703" && isIdentitySchemaPhaseC()) {
          return { errorCode: IDENTITY_SCHEMA_UNAVAILABLE };
        }
        return { errorCode: "conversation_lookup_failed" };
      }
      const contactRows = (byContact.data ?? []).map((row) =>
        mapConversationRow(row as Record<string, unknown>),
      );
      const contactMatched = findConversationForIdentity(
        contactRows.map((row) => ({
          ...row,
          channel,
          external_contact_id: row.externalContactId,
          external_conversation_id: row.externalConversationId,
          recipient_account_id: row.recipientAccountId,
          provider: row.provider,
        })),
        identity,
      );
      if (contactMatched && "errorCode" in contactMatched) return contactMatched;
      if (!contactMatched) return null;
      const contactRow =
        contactRows.find((row) => row.id === contactMatched.id) ?? null;
      if (contactRow &&
        isIdentitySchemaPhaseC() &&
        !outboundIdentityAllowsReply(contactRow.identityStatus)
      ) {
        return { errorCode: IDENTITY_AMBIGUOUS };
      }
      return contactRow;
    },
    async promoteEligiblePhaseACanonicalIdentity(identity) {
      if (!isIdentitySchemaPhaseC()) {
        return { outcome: "not_found" as const };
      }
      const ticket = await this.findActiveInstagramTicket({
        externalConversationId: identity.externalConversationId,
        externalContactId: identity.externalContactId,
        sourceChannel: identity.channel,
        provider: identity.provider,
        recipientAccountId: identity.recipientAccountId,
      });
      const byContact = await supabase
        .from("channel_conversations")
        .select(conversationSelect())
        .eq("channel", identity.channel)
        .eq("external_contact_id", identity.externalContactId)
        .limit(5);
      if (byContact.error) {
        if (byContact.error.code === "42703") {
          return {
            outcome: "not_eligible" as const,
            errorCode: IDENTITY_SCHEMA_UNAVAILABLE,
          };
        }
        return {
          outcome: "not_eligible" as const,
          errorCode: "conversation_lookup_failed",
        };
      }
      const contactRows = (byContact.data ?? []).map((row) =>
        mapConversationRow(row as Record<string, unknown>),
      );
      if (contactRows.length === 0) {
        return { outcome: "not_found" as const };
      }
      const decision = decidePhaseACanonicalIdentityPromotion(
        contactRows,
        identity,
        { hasCompetingTicketCandidate: ticket !== null },
      );
      if (decision.outcome !== "promote") {
        return {
          outcome: "not_eligible" as const,
          errorCode: IDENTITY_AMBIGUOUS,
        };
      }
      const candidate = decision.row;
      const updated = await supabase
        .from("channel_conversations")
        .update({
          provider: identity.provider,
          recipient_account_id: identity.recipientAccountId,
          identity_status: "unambiguous",
        })
        .eq("id", candidate.id)
        .eq("channel", identity.channel)
        .eq("external_contact_id", identity.externalContactId)
        .eq("external_conversation_id", identity.externalConversationId)
        .is("ticket_id", null)
        .is("provider", null)
        .is("recipient_account_id", null)
        .is("identity_status", null)
        .select(conversationSelect())
        .maybeSingle();
      if (updated.error) {
        if (isUniqueViolation(updated.error)) {
          return {
            outcome: "not_eligible" as const,
            errorCode: IDENTITY_AMBIGUOUS,
          };
        }
        if (updated.error.code === "42703") {
          return {
            outcome: "not_eligible" as const,
            errorCode: IDENTITY_SCHEMA_UNAVAILABLE,
          };
        }
        return {
          outcome: "not_eligible" as const,
          errorCode: "conversation_update_failed",
        };
      }
      if (updated.data?.id) {
        return {
          outcome: "promoted" as const,
          row: mapConversationRow(updated.data as Record<string, unknown>),
        };
      }
      const reread = await supabase
        .from("channel_conversations")
        .select(conversationSelect())
        .eq("id", candidate.id)
        .maybeSingle();
      if (reread.error || !reread.data?.id) {
        return {
          outcome: "not_eligible" as const,
          errorCode: IDENTITY_AMBIGUOUS,
        };
      }
      const current = mapConversationRow(reread.data as Record<string, unknown>);
      if (
        current.identityStatus === "unambiguous" &&
        current.provider === identity.provider &&
        current.recipientAccountId === identity.recipientAccountId &&
        current.externalContactId === identity.externalContactId &&
        current.externalConversationId === identity.externalConversationId
      ) {
        return { outcome: "already_promoted" as const, row: current };
      }
      return {
        outcome: "not_eligible" as const,
        errorCode: IDENTITY_AMBIGUOUS,
      };
    },
    async insertConversation(input) {
      if (!input.externalContactId.trim() || !input.externalConversationId.trim()) {
        return { outcome: "failed", errorCode: IDENTITY_MISSING };
      }
      if (isIdentitySchemaPhaseC()) {
        if (!input.provider?.trim() || !input.recipientAccountId?.trim()) {
          return { outcome: "failed", errorCode: IDENTITY_MISSING };
        }
        const rpc = await supabase.rpc("upsert_channel_conversation_identity", {
          p_provider: input.provider.trim(),
          p_channel: input.channel,
          p_recipient_account_id: input.recipientAccountId.trim(),
          p_external_contact_id: input.externalContactId.trim(),
          p_external_conversation_id: input.externalConversationId.trim(),
          p_display_name: input.displayName,
          p_last_message_at: input.lastMessageAt,
          p_state: input.state ?? "unclassified",
        });
        if (rpc.error?.code === "42883" || rpc.error?.code === "42703") {
          return { outcome: "failed", errorCode: IDENTITY_SCHEMA_UNAVAILABLE };
        }
        if (!rpc.error && rpc.data) {
          const row = mapConversationRow(rpc.data as Record<string, unknown>);
          return { outcome: "inserted", id: row.id, row };
        }
        if (isUniqueViolation(rpc.error)) return { outcome: "duplicate" };
        return { outcome: "failed", errorCode: "conversation_insert_failed" };
      }

      const insertRow: Record<string, unknown> = {
        channel: input.channel,
        external_conversation_id: input.externalConversationId,
        external_contact_id: input.externalContactId,
        display_name: input.displayName,
        state: input.state ?? "unclassified",
        routing_intent: "unclassified",
        collected_data: collectedToRecord(emptyIntakeCollected()),
        last_message_at: input.lastMessageAt,
        last_activity_at: input.lastMessageAt,
      };
      const { data, error } = await supabase
        .from("channel_conversations")
        .insert(insertRow)
        .select(conversationSelect())
        .single();
      if (!error && data?.id) {
        const row = mapConversationRow(data as Record<string, unknown>);
        return { outcome: "inserted", id: row.id, row };
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
        intake_session_version: snapshot.intakeSessionVersion,
      };
      const nextName = displayName?.trim();
      if (nextName) update.display_name = nextName;
      const { data, error } = await supabase
        .from("channel_conversations")
        .update(update)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error || !data?.id) {
        return { outcome: "failed", errorCode: "conversation_update_failed" };
      }
      return { outcome: "updated" };
    },
    async reserveOutboundAndSnapshot(input) {
      const rpc = await supabase.rpc("reserve_instagram_outbound_and_snapshot", {
        p_conversation_id: input.conversationId,
        p_state: input.snapshot.state,
        p_routing_intent: input.snapshot.routingIntent,
        p_current_intake_field: input.snapshot.currentIntakeField,
        p_last_prompt_key: input.snapshot.lastPromptKey,
        p_last_activity_at: input.snapshot.lastActivityAt ?? input.lastMessageAt,
        p_last_processed_external_message_id:
          input.snapshot.lastProcessedExternalMessageId,
        p_expected_last_processed_external_message_id:
          input.expectedLastProcessedExternalMessageId,
        p_collected_data: collectedToRecord(input.snapshot.collected),
        p_ticket_id: input.snapshot.ticketId,
        p_intake_session_version: input.snapshot.intakeSessionVersion,
        p_last_message_at: input.lastMessageAt,
        p_display_name: input.displayName,
        p_outbounds: input.outbounds.map((outbound) => ({
          channel: outbound.channel,
          sender_address: outbound.senderAddress ?? null,
          recipient_external_id: outbound.recipientExternalId,
          message_body: outbound.messageBody,
          idempotency_key: outbound.idempotencyKey,
          purpose: outbound.purpose,
          ticket_id: outbound.ticketId ?? null,
          routing_kind: outbound.routingKind ?? "support",
          raw_payload: durableReservePayload(outbound),
        })),
      });
      const parsed = parseReservedOutbounds(rpc.data);
      if (!rpc.error && parsed) {
        return { outcome: "reserved", outbounds: parsed };
      }
      const rpcCode = parseReserveRpcError(rpc.error);
      if (rpcCode) {
        return { outcome: "failed", errorCode: rpcCode };
      }
      if (rpc.error && !shouldFallbackReserveRpc(rpc.error)) {
        return { outcome: "failed", errorCode: "outbound_reserve_failed" };
      }

      for (const outbound of input.outbounds) {
        if (
          outbound.channel === "instagram" &&
          !instagramOutboundAddressesAreAssigned({
            senderAddress: outbound.senderAddress,
            recipientExternalId: outbound.recipientExternalId,
          })
        ) {
          return { outcome: "failed", errorCode: "outbound_address_invalid" };
        }
      }

      const snapshotUpdate: Record<string, unknown> = {
        last_message_at: input.lastMessageAt,
        last_activity_at: input.snapshot.lastActivityAt ?? input.lastMessageAt,
        state: input.snapshot.state,
        routing_intent: input.snapshot.routingIntent,
        current_intake_field: input.snapshot.currentIntakeField,
        last_prompt_key: input.snapshot.lastPromptKey,
        last_processed_external_message_id:
          input.snapshot.lastProcessedExternalMessageId,
        collected_data: collectedToRecord(input.snapshot.collected),
        ticket_id: input.snapshot.ticketId,
        intake_session_version: input.snapshot.intakeSessionVersion,
        ...(input.displayName?.trim()
          ? { display_name: input.displayName.trim() }
          : {}),
      };
      const occBase = supabase
        .from("channel_conversations")
        .update(snapshotUpdate)
        .eq("id", input.conversationId);
      const occQuery =
        input.expectedLastProcessedExternalMessageId == null
          ? occBase.is("last_processed_external_message_id", null)
          : occBase.eq(
              "last_processed_external_message_id",
              input.expectedLastProcessedExternalMessageId,
            );
      const saved = await occQuery.select("id").maybeSingle();
      if (saved.error) {
        return { outcome: "failed", errorCode: "conversation_update_failed" };
      }
      if (!saved.data?.id) {
        const existing = await supabase
          .from("channel_conversations")
          .select("id")
          .eq("id", input.conversationId)
          .maybeSingle();
        if (existing.error || !existing.data?.id) {
          return { outcome: "failed", errorCode: "conversation_not_found" };
        }
        return { outcome: "failed", errorCode: "conversation_state_conflict" };
      }

      const reserved: ReservedOutboundRow[] = [];
      for (const outbound of input.outbounds) {
        const inserted = await supabase
          .from("channel_messages")
          .insert({
            conversation_id: input.conversationId,
            ticket_id: outbound.ticketId ?? null,
            channel: outbound.channel,
            direction: "outbound",
            sender_name: "Cloutflow",
            sender_address: outbound.senderAddress ?? null,
            recipient_external_id: outbound.recipientExternalId,
            message_body: outbound.messageBody,
            message_type: "text",
            delivery_status: "pending",
            idempotency_key: outbound.idempotencyKey,
            purpose: outbound.purpose,
            routing_kind: outbound.routingKind ?? "support",
            raw_payload: durableReservePayload(outbound),
          })
          .select("id")
          .single();
        if (!inserted.error && inserted.data?.id) {
          reserved.push({
            id: inserted.data.id as string,
            idempotencyKey: outbound.idempotencyKey,
            deliveryStatus: "pending",
            claimed: true,
          });
          continue;
        }
        if (!isUniqueViolation(inserted.error)) {
          return { outcome: "failed", errorCode: "outbound_insert_failed" };
        }
        const existing = await supabase
          .from("channel_messages")
          .select(
            "id, delivery_status, idempotency_key, conversation_id, channel, recipient_external_id, sender_address, purpose, message_body, ticket_id, routing_kind, raw_payload",
          )
          .eq("idempotency_key", outbound.idempotencyKey)
          .maybeSingle();
        if (existing.error || !existing.data?.id) {
          return { outcome: "failed", errorCode: "outbound_lookup_failed" };
        }
        if (
          !isCompatibleInstagramOutboundDuplicate(
            {
              conversationId: (existing.data.conversation_id as string | null) ?? null,
              channel: (existing.data.channel as string | null) ?? null,
              recipientExternalId:
                (existing.data.recipient_external_id as string | null) ?? null,
              senderAddress:
                (existing.data.sender_address as string | null) ?? null,
              purpose: (existing.data.purpose as string | null) ?? null,
              messageBody: (existing.data.message_body as string | null) ?? null,
              routingKind: (existing.data.routing_kind as string | null) ?? null,
              ticketId: (existing.data.ticket_id as string | null) ?? null,
              rawPayload: existing.data.raw_payload ?? null,
            },
            {
              conversationId: input.conversationId,
              channel: outbound.channel,
              recipientExternalId: outbound.recipientExternalId,
              senderAddress: outbound.senderAddress ?? null,
              purpose: outbound.purpose,
              messageBody: outbound.messageBody,
              routingKind: outbound.routingKind ?? "support",
              ticketId: outbound.ticketId ?? null,
              rawPayload: durableReservePayload(outbound),
            },
          )
        ) {
          return { outcome: "failed", errorCode: "outbound_idempotency_conflict" };
        }
        reserved.push({
          id: existing.data.id as string,
          idempotencyKey: outbound.idempotencyKey,
          deliveryStatus: String(existing.data.delivery_status ?? "pending"),
          claimed: false,
        });
      }

      return { outcome: "reserved", outbounds: reserved };
    },
    async reserveWatiOutboundAndSnapshot(input) {
      const rpc = await supabase.rpc("reserve_wati_outbound_and_snapshot", {
        p_conversation_id: input.conversationId,
        p_state: input.snapshot.state,
        p_routing_intent: input.snapshot.routingIntent,
        p_current_intake_field: input.snapshot.currentIntakeField,
        p_last_prompt_key: input.snapshot.lastPromptKey,
        p_last_activity_at: input.snapshot.lastActivityAt ?? input.lastMessageAt,
        p_last_processed_external_message_id:
          input.snapshot.lastProcessedExternalMessageId,
        p_expected_last_processed_external_message_id:
          input.expectedLastProcessedExternalMessageId,
        p_collected_data: collectedToRecord(input.snapshot.collected),
        p_ticket_id: input.snapshot.ticketId,
        p_intake_session_version: input.snapshot.intakeSessionVersion,
        p_last_message_at: input.lastMessageAt,
        p_display_name: input.displayName,
        p_outbounds: input.outbounds.map((outbound) => ({
          channel: "whatsapp",
          sender_address: outbound.senderAddress ?? null,
          recipient_external_id: outbound.recipientExternalId,
          message_body: outbound.messageBody,
          idempotency_key: outbound.idempotencyKey,
          purpose: outbound.purpose,
          ticket_id: outbound.ticketId ?? null,
          routing_kind: outbound.routingKind ?? "support",
          raw_payload: durableReservePayload(outbound),
        })),
      });
      const rpcCode = parseWatiReserveRpcError(rpc.error);
      if (rpcCode) {
        return { outcome: "failed", errorCode: rpcCode };
      }
      if (rpc.error) {
        return { outcome: "failed", errorCode: "outbound_reserve_failed" };
      }
      const raw = rpc.data;
      const rawOutbounds =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>).outbounds
          : null;
      const normalized =
        Array.isArray(rawOutbounds)
          ? rawOutbounds.map((row) => {
              if (!row || typeof row !== "object" || Array.isArray(row)) return row;
              const record = row as Record<string, unknown>;
              return { ...record, id: String(record.id ?? "") };
            })
          : rawOutbounds;
      const parsed = parseReservedOutbounds({ outbounds: normalized });
      if (!parsed) {
        return { outcome: "failed", errorCode: "outbound_reserve_failed" };
      }
      return { outcome: "reserved", outbounds: parsed };
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
      const sourceChannel = input.sourceChannel ?? "instagram";
      const identity = conversationIdentityFromLookup({
        channel: sourceChannel,
        externalConversationId: input.externalConversationId,
        externalContactId: input.externalContactId,
        provider: input.provider,
        recipientAccountId: input.recipientAccountId,
      });
      if (!identity) {
        return { errorCode: IDENTITY_MISSING };
      }
      const select =
        "id, status, ticket_code, external_contact_id, external_conversation_id" as const;
      const statuses = ["open", "in_progress", "waiting"] as const;
      const { data, error } = await supabase
        .from("tickets")
        .select(
          isIdentitySchemaPhaseC()
            ? (`${select}, identity_status, recipient_account_id` as typeof select)
            : select,
        )
        .eq("source_channel", sourceChannel)
        .eq("external_contact_id", identity.externalContactId)
        .in("status", [...statuses])
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) {
        if (error.code === "42703" && isIdentitySchemaPhaseC()) {
          return { errorCode: IDENTITY_SCHEMA_UNAVAILABLE };
        }
        return { errorCode: "ticket_lookup_failed" };
      }

      const matched = findActiveTicketForIdentity(
        (data ?? []) as Array<Record<string, unknown>>,
        identity,
        sourceChannel,
        (row) =>
          ["open", "in_progress", "waiting"].includes(String(row.status ?? "")),
      );
      if (matched && "errorCode" in matched) {
        return { errorCode: String(matched.errorCode) };
      }
      if (!matched) return null;
      return {
        id: String(matched.id ?? ""),
        status: String(matched.status ?? ""),
        ticketCode: (matched.ticket_code as string | null) ?? null,
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
      if (isUniqueViolation(error)) {
        const existing = await this.findActiveInstagramTicket({
          externalConversationId: row.external_conversation_id,
          externalContactId: row.external_contact_id,
          sourceChannel: row.source_channel === "whatsapp" ? "whatsapp" : "instagram",
          recipientAccountId:
            typeof row.metadata === "object" &&
            row.metadata &&
            "recipientAccountId" in row.metadata
              ? String(
                  (row.metadata as { recipientAccountId?: unknown })
                    .recipientAccountId ?? "",
                ) || null
              : null,
        });
        if (existing && "errorCode" in existing) {
          return { outcome: "failed", errorCode: existing.errorCode };
        }
        if (existing) {
          return {
            outcome: "duplicate",
            id: existing.id,
            ticketCode: existing.ticketCode ?? "",
          };
        }
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
      const senderAddress =
        input.channel === "instagram"
          ? (input.senderAddress ?? null)
          : (input.senderAddress ?? input.recipientExternalId);
      const { data, error } = await supabase
        .from("channel_messages")
        .insert({
          conversation_id: input.conversationId,
          ticket_id: input.ticketId ?? null,
          channel: input.channel,
          direction: "outbound",
          sender_name: "Cloutflow",
          sender_address: senderAddress,
          recipient_external_id: input.recipientExternalId,
          message_body: input.messageBody,
          message_type: "text",
          delivery_status: "pending",
          idempotency_key: input.idempotencyKey,
          purpose: input.purpose,
          comment_id: input.commentId ?? null,
          routing_kind: "support",
          raw_payload: input.rawPayload ?? null,
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
        .select(
          "id, delivery_status, external_message_id, conversation_id, idempotency_key, channel, recipient_external_id, sender_address, purpose, message_body, ticket_id, routing_kind",
        )
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (lookupError || !existing?.id) {
        return { outcome: "failed", errorCode: "outbound_lookup_failed" };
      }
      if (
        input.channel === "instagram" &&
        !isCompatibleInstagramOutboundDuplicate(
          {
            conversationId: (existing.conversation_id as string | null) ?? null,
            channel: (existing.channel as string | null) ?? null,
            recipientExternalId:
              (existing.recipient_external_id as string | null) ?? null,
            senderAddress: (existing.sender_address as string | null) ?? null,
            purpose: (existing.purpose as string | null) ?? null,
            messageBody: (existing.message_body as string | null) ?? null,
            routingKind: (existing.routing_kind as string | null) ?? null,
            ticketId: (existing.ticket_id as string | null) ?? null,
          },
          {
            conversationId: input.conversationId,
            channel: input.channel,
            recipientExternalId: input.recipientExternalId,
            senderAddress: input.senderAddress ?? null,
            purpose: input.purpose,
            messageBody: input.messageBody,
            routingKind: "support",
            ticketId: input.ticketId ?? null,
          },
        )
      ) {
        return { outcome: "failed", errorCode: "outbound_idempotency_conflict" };
      }
      return {
        outcome: "duplicate",
        id: existing.id as string,
        deliveryStatus: String(existing.delivery_status ?? "pending"),
        externalMessageId: (existing.external_message_id as string | null) ?? null,
        conversationId: (existing.conversation_id as string | null) ?? null,
        idempotencyKey: (existing.idempotency_key as string | null) ?? null,
      };
    },
    async markOutboundMessage(id, patch) {
      const update: Record<string, unknown> = {
        delivery_status: patch.deliveryStatus,
        delivery_error_code: patch.deliveryErrorCode ?? null,
      };
      if (patch.externalMessageId !== undefined) {
        update.external_message_id = patch.externalMessageId;
      }
      if (patch.nextAttemptAt !== undefined) {
        update.next_attempt_at = patch.nextAttemptAt;
      }
      if (patch.lastAttemptAt !== undefined) {
        update.last_attempt_at = patch.lastAttemptAt;
      }
      if (patch.deliveryAttemptCount !== undefined) {
        update.delivery_attempt_count = patch.deliveryAttemptCount;
      }
      await supabase.from("channel_messages").update(update).eq("id", id);
    },
    async findOutboundByExternalMessageId(externalMessageId) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select("id, external_message_id, delivery_status, idempotency_key, recipient_external_id, conversation_id")
        .eq("direction", "outbound")
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
        conversationId: (data.conversation_id as string | null) ?? null,
      };
    },
    async findOutboundByIdempotencyKey(idempotencyKey) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select("id, external_message_id, delivery_status, idempotency_key, recipient_external_id, conversation_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) return { errorCode: "message_lookup_failed" };
      if (!data?.id) return null;
      return {
        id: data.id as string,
        externalMessageId: (data.external_message_id as string | null) ?? null,
        deliveryStatus: String(data.delivery_status ?? ""),
        idempotencyKey: (data.idempotency_key as string | null) ?? null,
        recipientExternalId: (data.recipient_external_id as string | null) ?? null,
        conversationId: (data.conversation_id as string | null) ?? null,
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
    async listRetryableOutbounds(conversationId) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select(
          "id, message_body, purpose, raw_payload, recipient_external_id, delivery_status",
        )
        .eq("conversation_id", conversationId)
        .eq("direction", "outbound")
        .in("delivery_status", ["pending", "failed"])
        .neq("purpose", "staff_reply")
        .order("created_at", { ascending: true });
      if (error || !data) return [];
      return data.map((row) => ({
        id: row.id as string,
        messageBody: String(row.message_body ?? ""),
        purpose: (row.purpose as string | null) ?? null,
        rawPayload: row.raw_payload ?? null,
        recipientExternalId:
          (row.recipient_external_id as string | null) ?? null,
        deliveryStatus: String(row.delivery_status ?? ""),
      }));
    },
    async listDueInstagramOutbounds(conversationId, nowIso) {
      const listed = await listDueInstagramRows(supabase, {
        conversationId,
        nowIso,
        limit: 100,
      });
      return listed;
    },
    async listDueInstagramOutboxBatch(input) {
      return listDueInstagramRows(supabase, {
        nowIso: input.nowIso,
        limit: input.limit,
      });
    },
    async listDueWatiOutbounds(conversationId, nowIso) {
      return listDueWatiRows(supabase, {
        conversationId,
        nowIso,
        limit: 100,
      });
    },
    async listDueWatiOutboxBatch(input) {
      return listDueWatiRows(supabase, {
        nowIso: input.nowIso,
        limit: input.limit,
      });
    },
    async getConversationEmailContext(conversationId) {
      const { data, error } = await supabase
        .from("channel_conversations")
        .select("id, collected_data, external_conversation_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) return { errorCode: "conversation_lookup_failed" };
      if (!data?.id) return null;
      return {
        id: data.id as string,
        collectedData:
          data.collected_data &&
          typeof data.collected_data === "object" &&
          !Array.isArray(data.collected_data)
            ? (data.collected_data as Record<string, unknown>)
            : {},
        externalConversationId:
          (data.external_conversation_id as string | null) ?? null,
      };
    },
    async listDueInstagramEmailDeliveries(input) {
      const { data, error } = await supabase
        .from("channel_email_deliveries")
        .select(
          "id, ticket_id, conversation_id, purpose, delivery_status, error_code, updated_at",
        )
        .in("delivery_status", ["pending", "failed", "skipped"])
        .in("purpose", [...INSTAGRAM_EMAIL_DRAIN_PURPOSES])
        .order("created_at", { ascending: true })
        .limit(Math.max(1, input.limit));
      if (error || !data) return { errorCode: "email_outbox_lookup_failed" };
      return data.map((row) => ({
        id: row.id as string,
        ticketId: (row.ticket_id as string | null) ?? null,
        conversationId: (row.conversation_id as string | null) ?? null,
        purpose: String(row.purpose ?? ""),
        deliveryStatus: String(row.delivery_status ?? "pending"),
        errorCode: (row.error_code as string | null) ?? null,
        updatedAt: (row.updated_at as string | null) ?? null,
      }));
    },
    async claimInstagramEmailRetry(input) {
      const current = await supabase
        .from("channel_email_deliveries")
        .select("id, delivery_status, error_code, updated_at, purpose")
        .eq("id", input.id)
        .maybeSingle();
      if (current.error || !current.data?.id) {
        return { outcome: "failed", errorCode: "email_outbox_lookup_failed" };
      }
      const status = String(current.data.delivery_status ?? "");
      const purpose = String(current.data.purpose ?? "");
      if (isInstagramEmailTerminalError(current.data.error_code as string | null)) {
        return { outcome: "skipped" };
      }
      if (
        !["pending", "failed", "skipped"].includes(status) ||
        !isInstagramEmailDrainPurpose(purpose)
      ) {
        return { outcome: "skipped" };
      }
      if (status === "pending") {
        let pendingQuery = supabase
          .from("channel_email_deliveries")
          .update({ updated_at: input.nowIso })
          .eq("id", input.id)
          .eq("delivery_status", "pending");
        pendingQuery = input.observedUpdatedAt
          ? pendingQuery.eq("updated_at", input.observedUpdatedAt)
          : pendingQuery.is("updated_at", null);
        const claimed = await pendingQuery.select("id").maybeSingle();
        if (claimed.error || !claimed.data?.id) return { outcome: "skipped" };
        return { outcome: "claimed", id: claimed.data.id as string };
      }
      const claimed = await supabase
        .from("channel_email_deliveries")
        .update({
          delivery_status: "pending",
          error_code: null,
          updated_at: input.nowIso,
        })
        .eq("id", input.id)
        .in("delivery_status", ["failed", "skipped"])
        .select("id")
        .maybeSingle();
      if (claimed.error || !claimed.data?.id) return { outcome: "skipped" };
      return { outcome: "claimed", id: claimed.data.id as string };
    },
    async claimInstagramOutboundSend(input) {
      const rpc = await supabase.rpc("claim_instagram_outbound_send", {
        p_id: input.id,
        p_now: input.now,
        p_max_attempts: input.maxAttempts,
      });
      if (!rpc.error && rpc.data && typeof rpc.data === "object" && !Array.isArray(rpc.data)) {
        const record = rpc.data as Record<string, unknown>;
        if (record.outcome === "skipped") return { outcome: "skipped" };
        if (record.outcome === "claimed") {
          return {
            outcome: "claimed",
            attemptCount: Number(record.attempt_count ?? 1) || 1,
          };
        }
      }
      const current = await supabase
        .from("channel_messages")
        .select(
          "id, delivery_status, delivery_error_code, delivery_attempt_count, next_attempt_at, purpose, channel, direction",
        )
        .eq("id", input.id)
        .maybeSingle();
      if (current.error || !current.data?.id) {
        if (current.error?.code === "42703") {
          return { outcome: "skipped" };
        }
        return { outcome: "failed", errorCode: "outbound_lookup_failed" };
      }
      const row = current.data;
      const attempts = Number(row.delivery_attempt_count ?? 0) || 0;
      const nextAt = row.next_attempt_at ? Date.parse(String(row.next_attempt_at)) : 0;
      const now = Date.parse(input.now);
      if (
        row.direction !== "outbound" ||
        row.channel !== "instagram" ||
        row.purpose === "staff_reply" ||
        !["pending", "failed"].includes(String(row.delivery_status)) ||
        attempts >= input.maxAttempts ||
        isInstagramTerminalSendError((row.delivery_error_code as string | null) ?? null) ||
        (row.next_attempt_at && !Number.isNaN(nextAt) && nextAt > now)
      ) {
        return { outcome: "skipped" };
      }
      const nextCount = attempts + 1;
      const leaseUntil = new Date(
        now + 60_000,
      ).toISOString();
      const claimed = await supabase
        .from("channel_messages")
        .update({
          delivery_attempt_count: nextCount,
          last_attempt_at: input.now,
          next_attempt_at: leaseUntil,
        })
        .eq("id", input.id)
        .eq("delivery_attempt_count", attempts)
        .in("delivery_status", ["pending", "failed"])
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${input.now}`)
        .select("id")
        .maybeSingle();
      if (claimed.error?.code === "42703") {
        return { outcome: "skipped" };
      }
      if (claimed.error || !claimed.data?.id) {
        return { outcome: "skipped" };
      }
      return { outcome: "claimed", attemptCount: nextCount };
    },
    async claimWatiOutboundSend(input) {
      const rpc = await supabase.rpc("claim_wati_outbound_send", {
        p_id: input.id,
        p_now: input.now,
        p_max_attempts: input.maxAttempts,
      });
      if (!rpc.error && rpc.data && typeof rpc.data === "object" && !Array.isArray(rpc.data)) {
        const record = rpc.data as Record<string, unknown>;
        if (record.outcome === "skipped") return { outcome: "skipped" };
        if (record.outcome === "claimed") {
          return {
            outcome: "claimed",
            attemptCount: Number(record.attempt_count ?? 1) || 1,
          };
        }
      }
      const current = await supabase
        .from("channel_messages")
        .select(
          "id, delivery_status, delivery_error_code, delivery_attempt_count, next_attempt_at, purpose, channel, direction",
        )
        .eq("id", input.id)
        .maybeSingle();
      if (current.error || !current.data?.id) {
        if (current.error?.code === "42703") {
          return { outcome: "skipped" };
        }
        return { outcome: "failed", errorCode: "outbound_lookup_failed" };
      }
      const row = current.data;
      const attempts = Number(row.delivery_attempt_count ?? 0) || 0;
      const nextAt = row.next_attempt_at ? Date.parse(String(row.next_attempt_at)) : 0;
      const now = Date.parse(input.now);
      if (
        row.direction !== "outbound" ||
        row.channel !== "whatsapp" ||
        row.purpose === "staff_reply" ||
        !["pending", "failed"].includes(String(row.delivery_status)) ||
        attempts >= input.maxAttempts ||
        isWatiTerminalSendError((row.delivery_error_code as string | null) ?? null) ||
        (row.next_attempt_at && !Number.isNaN(nextAt) && nextAt > now)
      ) {
        return { outcome: "skipped" };
      }
      const nextCount = attempts + 1;
      const leaseUntil = new Date(now + 60_000).toISOString();
      const claimed = await supabase
        .from("channel_messages")
        .update({
          delivery_attempt_count: nextCount,
          last_attempt_at: input.now,
          next_attempt_at: leaseUntil,
        })
        .eq("id", input.id)
        .eq("channel", "whatsapp")
        .eq("delivery_attempt_count", attempts)
        .in("delivery_status", ["pending", "failed"])
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${input.now}`)
        .select("id")
        .maybeSingle();
      if (claimed.error?.code === "42703") {
        return { outcome: "skipped" };
      }
      if (claimed.error || !claimed.data?.id) {
        return { outcome: "skipped" };
      }
      return { outcome: "claimed", attemptCount: nextCount };
    },
    async findPendingTimeoutOutbound(input) {
      const { data, error } = await supabase
        .from("channel_messages")
        .select(
          "id, external_message_id, delivery_status, idempotency_key, recipient_external_id, conversation_id, message_body, delivery_error_code",
        )
        .eq("conversation_id", input.conversationId)
        .eq("channel", "instagram")
        .eq("direction", "outbound")
        .eq("delivery_status", "pending")
        .eq("delivery_error_code", "timeout_unknown")
        .is("external_message_id", null)
        .neq("purpose", "staff_reply")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        if (error.code === "42703") return null;
        return { errorCode: "outbound_lookup_failed" };
      }
      const rows = data ?? [];
      const body = input.messageBody.trim();
      const matched =
        rows.find((row) => String(row.message_body ?? "").trim() === body) ??
        rows[0];
      if (!matched?.id) return null;
      return {
        id: matched.id as string,
        externalMessageId: (matched.external_message_id as string | null) ?? null,
        deliveryStatus: String(matched.delivery_status ?? "pending"),
        idempotencyKey: (matched.idempotency_key as string | null) ?? null,
        recipientExternalId:
          (matched.recipient_external_id as string | null) ?? null,
        conversationId: (matched.conversation_id as string | null) ?? null,
      };
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
        .select("id, delivery_status, error_code")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.error || !existing.data?.id) {
        return { outcome: "failed", errorCode: "email_outbox_lookup_failed" };
      }
      const status = String(existing.data.delivery_status ?? "pending");
      if (isInstagramEmailTerminalError(existing.data.error_code as string | null)) {
        return {
          outcome: "duplicate",
          id: existing.data.id as string,
          deliveryStatus: status,
        };
      }
      if (status === "failed" || status === "skipped") {
        const reclaimed = await supabase
          .from("channel_email_deliveries")
          .update({ delivery_status: "pending", error_code: null })
          .eq("id", existing.data.id)
          .in("delivery_status", ["failed", "skipped"])
          .select("id")
          .maybeSingle();
        if (!reclaimed.error && reclaimed.data?.id) {
          return { outcome: "claimed", id: reclaimed.data.id as string };
        }
      }
      return {
        outcome: "duplicate",
        id: existing.data.id as string,
        deliveryStatus: status,
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
