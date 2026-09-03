import "server-only";

import type {
  ConversationSnapshot,
  MachineEffect,
  MachineSendEffect,
} from "@/lib/meta/conversation-machine";
import {
  firstNameFromFullName,
  ticketCreatedWithEmailText,
  ticketCreatedWithoutEmailText,
} from "@/lib/meta/routing-copy";
import {
  creatorTicketRaisedText,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import { postCompletionQuickReplies } from "@/lib/meta/instagram-persona-machine";
import { scheduleAfterResponse } from "@/lib/meta/after-response";
import { drainInstagramOutbox } from "@/lib/meta/instagram-outbox";
import { durableInstagramOutboundPayload } from "@/lib/meta/instagram-outbound-payload";
import {
  drainWatiConversationOutbox,
  persistWatiSendResult,
  WATI_OUTBOX_MAX_ATTEMPTS,
} from "@/lib/wati/outbox";
import { timeInstagramMetric, type InstagramTimingSession } from "@/lib/meta/timing";
import {
  finishInstagramAttending,
  type InstagramAttendingSession,
} from "@/lib/meta/instagram-sender-actions";
import {
  sendInstagramQuickReplies,
  sendInstagramText,
  type InstagramSendDeps,
} from "@/lib/meta/instagram-send";
import {
  sendWhatsAppProviderReplyButtons,
  sendWhatsAppProviderText,
  type WhatsAppProviderSendDeps,
} from "@/lib/meta/whatsapp-provider";
import { mapIntakeToInstagramTicketInsert, stampWatiTicketIdentity, dbTicketFromIntakeInsert } from "@/lib/meta/instagram-ticket";
import {
  bindCommittedTicketSnapshot,
  INTAKE_STATES_BLOCKED_AFTER_TICKET,
} from "@/lib/meta/ticket-finalization";
import { classifyWatiSendFailureCode } from "@/lib/wati/send";
import { conversationIdentityFromLookup } from "@/lib/meta/conversation-identity";
import type {
  InstagramIngestStore,
  OutboundReserveInput,
} from "@/lib/meta/instagram-store";
import {
  instagramOutboundAddressesAreAssigned,
  OUTBOUND_IDEMPOTENCY_CONFLICT,
} from "@/lib/meta/instagram-reserve";
import {
  channelOutboundKey,
  channelTicketCreatedKey,
  isCreatorConfirmPromptKey,
  isSameSessionPrompt,
  type ChatbotIdempotencyPrefix,
} from "@/lib/meta/prompt-keys";
import type { DbTicket } from "@/lib/tickets/types";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";

export type ChannelEffectChannel = "instagram" | "whatsapp";

export type InstagramEffectDeps = {
  store: InstagramIngestStore;
  recipientId: string;
  conversationId: string;
  outboundSenderAddress?: string | null;
  sendDeps?: InstagramSendDeps | WhatsAppProviderSendDeps;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
};

export type ApplyEffectsOptions = {
  effects: MachineEffect[];
  snapshotTicketId: string | null;
  collected: Parameters<typeof mapIntakeToInstagramTicketInsert>[0]["collected"];
  inboundMessageId: string;
  inboundText: string;
  intakeSessionVersion: number;
  channel?: ChannelEffectChannel;
  event: {
    externalContactId: string;
    externalConversationId: string;
    recipientAccountId?: string | null;
    provider?: string | null;
  };
  deps: InstagramEffectDeps;
  snapshotToPersist?: ConversationSnapshot;
  expectedLastProcessedExternalMessageId?: string | null;
  lastMessageAt?: string;
  displayName?: string | null;
  timing?: InstagramTimingSession;
  attending?: InstagramAttendingSession | null;
};

export type ApplyEffectsResult = {
  ticketId: string | null;
  ticketCode: string | null;
  retryableFailure: boolean;
  snapshotPersisted: boolean;
  errorCode?: string;
  created?: boolean;
  conversationLinked?: boolean;
  closingReserved?: boolean;
  emailClaimed?: boolean;
};

function releaseInstagramAttending(
  attending: InstagramAttendingSession | null | undefined,
): Promise<void> {
  if (!attending?.started) return Promise.resolve();
  return scheduleAfterResponse(async () => {
    await finishInstagramAttending(attending);
  });
}

function prefixFor(channel: ChannelEffectChannel): ChatbotIdempotencyPrefix {
  return channel === "whatsapp" ? "wa" : "ig";
}

function isFinalOutboundDelivery(status: string | null | undefined): boolean {
  return status === "sent" || status === "delivered" || status === "read";
}

function dropObsoleteCreatorConfirmSends(
  effects: MachineSendEffect[],
  ticketId: string | null,
): MachineSendEffect[] {
  if (!ticketId) return effects;
  return effects.filter((effect) => !isCreatorConfirmPromptKey(effect.promptKey));
}

async function existingClosingDeliveryStatus(
  store: InstagramIngestStore,
  idempotencyKey: string,
): Promise<string | null> {
  if (typeof store.findOutboundByIdempotencyKey !== "function") return null;
  const existing = await store.findOutboundByIdempotencyKey(idempotencyKey);
  if (!existing || "errorCode" in existing) return null;
  return existing.deliveryStatus;
}

async function sendChannelMessage(
  effect: MachineSendEffect,
  deps: InstagramEffectDeps,
  channel: ChannelEffectChannel,
) {
  const sendDeps = deps.sendDeps;
  if (channel === "whatsapp") {
    return effect.type === "send_quick_replies" && effect.quickReplies
      ? sendWhatsAppProviderReplyButtons({
          recipientId: deps.recipientId,
          text: effect.text,
          quickReplies: effect.quickReplies,
          deps: sendDeps,
        })
      : sendWhatsAppProviderText({
          recipientId: deps.recipientId,
          text: effect.text,
          deps: sendDeps,
        });
  }
  return effect.type === "send_quick_replies" && effect.quickReplies
    ? sendInstagramQuickReplies({
        recipientId: deps.recipientId,
        text: effect.text,
        quickReplies: effect.quickReplies,
        deps: sendDeps,
      })
    : sendInstagramText({
        recipientId: deps.recipientId,
        text: effect.text,
        deps: sendDeps,
      });
}

async function dispatchSend(
  effect: MachineSendEffect,
  deps: InstagramEffectDeps,
  ticketId: string | null,
  intakeSessionVersion: number,
  channel: ChannelEffectChannel,
): Promise<{
  retryableFailure: boolean;
  outboundClaimed: boolean;
  errorCode?: string;
  httpStatus?: number | null;
  operation?: "text" | "buttons" | "list";
}> {
  const prefix = prefixFor(channel);
  const idempotencyKey = channelOutboundKey(
    prefix,
    deps.conversationId,
    intakeSessionVersion,
    effect.promptKey,
  );
  const claimed = await deps.store.claimOutboundMessage({
    conversationId: deps.conversationId,
    ticketId,
    channel,
    recipientExternalId: deps.recipientId,
    senderAddress: channel === "instagram" ? (deps.outboundSenderAddress ?? null) : undefined,
    messageBody: effect.text,
    idempotencyKey,
    purpose: effect.promptKey.split(":")[0] ?? "prompt",
    rawPayload: durableInstagramOutboundPayload({
      text: effect.text,
      quickReplies:
        effect.type === "send_quick_replies" ? effect.quickReplies : undefined,
    }),
  });
  if (claimed.outcome === "failed") {
    return { retryableFailure: true, outboundClaimed: false };
  }
  if (claimed.outcome === "duplicate") {
    const sameSession =
      claimed.conversationId === deps.conversationId &&
      ((claimed.idempotencyKey ?? idempotencyKey) === idempotencyKey ||
        isSameSessionPrompt({
          idempotencyKey: claimed.idempotencyKey ?? idempotencyKey,
          conversationId: deps.conversationId,
          intakeSessionVersion,
          effectType: effect.promptKey,
          prefix,
        }));
    if (!sameSession) {
      return { retryableFailure: true, outboundClaimed: true };
    }
    if (
      claimed.deliveryStatus === "sent" ||
      claimed.deliveryStatus === "delivered" ||
      claimed.deliveryStatus === "read"
    ) {
      return { retryableFailure: false, outboundClaimed: true };
    }
    if (claimed.deliveryStatus !== "failed") {
      return { retryableFailure: false, outboundClaimed: true };
    }
  }

  const outboundId = claimed.id;
  if (channel === "whatsapp" && typeof deps.store.claimWatiOutboundSend === "function") {
    const now = new Date();
    const leased = await deps.store.claimWatiOutboundSend({
      id: outboundId,
      now: now.toISOString(),
      maxAttempts: WATI_OUTBOX_MAX_ATTEMPTS,
    });
    if (leased.outcome === "failed") {
      return { retryableFailure: true, outboundClaimed: true };
    }
    if (leased.outcome !== "claimed") {
      return { retryableFailure: false, outboundClaimed: true };
    }
    const result = await sendChannelMessage(effect, deps, channel);
    const kind = await persistWatiSendResult(
      deps.store,
      outboundId,
      result,
      leased.attemptCount,
      now,
    );
    if (kind === "sent") {
      return { retryableFailure: false, outboundClaimed: true };
    }
    return {
      retryableFailure: kind === "retryable",
      outboundClaimed: true,
      errorCode: result.ok ? undefined : result.errorCode,
      httpStatus: result.ok ? undefined : result.httpStatus,
      operation: result.ok
        ? undefined
        : (result as { operation?: "text" | "buttons" | "list" }).operation,
    };
  }

  const result = await sendChannelMessage(effect, deps, channel);

  if (result.ok) {
    await deps.store.markOutboundMessage(outboundId, {
      deliveryStatus: "sent",
      externalMessageId: result.metaMessageId,
      deliveryErrorCode: null,
    });
    return { retryableFailure: false, outboundClaimed: true };
  }

  await deps.store.markOutboundMessage(outboundId, {
    deliveryStatus: "failed",
    deliveryErrorCode: result.errorCode,
  });
  return {
    retryableFailure: true,
    outboundClaimed: true,
    errorCode: result.errorCode,
    httpStatus: result.httpStatus,
    operation: (result as { operation?: "text" | "buttons" | "list" }).operation,
  };
}

async function loadCreatedTicket(
  ticketId: string,
  loadTicket?: (id: string) => Promise<DbTicket | null>,
): Promise<DbTicket | null> {
  if (loadTicket) return loadTicket(ticketId);
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { ticketSelect } = await import("@/lib/tickets/select");
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("tickets")
      .select(ticketSelect())
      .eq("id", ticketId)
      .maybeSingle();
    return data ? (data as DbTicket) : null;
  } catch {
    return null;
  }
}

function formatTranscript(
  rows: Array<{ direction: string; messageBody: string; createdAt: string }>,
): string {
  return rows
    .map((row) => {
      const who = row.direction === "inbound" ? "Creator" : "Cloutflow";
      return `${who}: ${row.messageBody}`;
    })
    .join("\n\n");
}

async function createTicketIfNeeded(options: ApplyEffectsOptions): Promise<{
  ticketId: string | null;
  ticketCode: string | null;
  created: boolean;
  retryableFailure: boolean;
}> {
  const channel = options.channel ?? "instagram";
  let createdId = options.snapshotTicketId;
  let createdCode: string | null = null;

  if (!createdId) {
    const identity = conversationIdentityFromLookup({
      channel,
      externalConversationId: options.event.externalConversationId,
      externalContactId: options.event.externalContactId,
      provider: options.event.provider,
      recipientAccountId: options.event.recipientAccountId,
    });
    if (!identity) {
      return {
        ticketId: null,
        ticketCode: null,
        created: false,
        retryableFailure: true,
      };
    }
    const existing = await options.deps.store.findActiveInstagramTicket({
      externalConversationId: identity.externalConversationId,
      externalContactId: identity.externalContactId,
      sourceChannel: channel,
      provider: identity.provider,
      recipientAccountId: identity.recipientAccountId,
    });
    if (existing && "errorCode" in existing) {
      return { ticketId: null, ticketCode: null, created: false, retryableFailure: true };
    }
    if (existing) {
      createdId = existing.id;
      createdCode = existing.ticketCode ?? null;
      return {
        ticketId: createdId,
        ticketCode: createdCode,
        created: false,
        retryableFailure: false,
      };
    }
    let insert = mapIntakeToInstagramTicketInsert({
      collected: options.collected,
      externalContactId: identity.externalContactId,
      externalConversationId: identity.externalConversationId,
      sourceChannel: channel,
      recipientAccountId: identity.recipientAccountId || null,
    });
    if (identity.provider === WATI_WHATSAPP_PROVIDER || channel === "instagram") {
      insert = stampWatiTicketIdentity(insert, {
        provider: identity.provider,
        recipientAccountId: identity.recipientAccountId,
      });
    }
    const created = await options.deps.store.insertInstagramTicket(insert);
    if (created.outcome === "failed") {
      return { ticketId: null, ticketCode: null, created: false, retryableFailure: true };
    }
    return {
      ticketId: created.id,
      ticketCode: created.ticketCode,
      created: created.outcome === "inserted",
      retryableFailure: false,
    };
  }

  const linked = await options.deps.store.getTicket(createdId);
  if (linked && "errorCode" in linked) {
    return { ticketId: createdId, ticketCode: null, created: false, retryableFailure: true };
  }
  createdCode = linked?.ticketCode ?? null;
  return { ticketId: createdId, ticketCode: createdCode, created: false, retryableFailure: false };
}

async function deliverChannelTicketConfirmationEmail(input: {
  store: InstagramIngestStore;
  ticket: DbTicket;
  conversationId: string;
  ticketId: string;
  purpose: "instagram-ticket-confirmation" | "whatsapp-ticket-confirmation";
  transcriptText: string;
}): Promise<boolean> {
  const confirmationClaim = await input.store.claimEmailDelivery({
    ticketId: input.ticketId,
    conversationId: input.conversationId,
    purpose: input.purpose,
    idempotencyKey:
      input.purpose === "whatsapp-ticket-confirmation"
        ? `email:wa-confirm:${input.ticketId}`
        : `email:ig-confirm:${input.ticketId}`,
  });
  if (confirmationClaim.outcome === "duplicate") {
    return confirmationClaim.deliveryStatus === "sent";
  }
  if (confirmationClaim.outcome !== "claimed") return false;

  try {
    const mail = await import("@/lib/email/instagram-ticket-mail");
    const mailed = await mail.sendInstagramTicketConfirmationEmail({
      ticket: input.ticket,
      transcriptText: input.transcriptText,
    });
    await input.store.markEmailDelivery(confirmationClaim.id, {
      deliveryStatus:
        mailed.outcome === "sent"
          ? "sent"
          : mailed.outcome === "skipped"
            ? "skipped"
            : "failed",
      brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
      errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
    });
    return mailed.outcome === "sent";
  } catch {
    await input.store.markEmailDelivery(confirmationClaim.id, {
      deliveryStatus: "failed",
      brevoMessageId: null,
      errorCode: "email_send_failed",
    });
    return false;
  }
}
async function runInstagramTicketBackground(input: {
  options: ApplyEffectsOptions;
  ticketId: string;
  ticketCode: string | null;
  intakeSessionVersion: number;
}): Promise<void> {
  const { options, ticketId } = input;
  const store = options.deps.store;
  await store.linkSupportMessagesToTicket({
    conversationId: options.deps.conversationId,
    ticketId,
  });

  const ticket = await loadCreatedTicket(ticketId, options.deps.loadTicket);
  if (!ticket) return;

  const transcriptRows = await store.listSupportTranscript({
    conversationId: options.deps.conversationId,
    ticketId,
  });
  await deliverChannelTicketConfirmationEmail({
    store,
    ticket,
    conversationId: options.deps.conversationId,
    ticketId,
    purpose: "instagram-ticket-confirmation",
    transcriptText: formatTranscript(transcriptRows),
  });
}

async function runInstagramHelpBackground(input: {
  options: ApplyEffectsOptions;
  ticketId: string;
}): Promise<void> {
  const ticket = await loadCreatedTicket(input.ticketId, input.options.deps.loadTicket);
  if (!ticket) return;
  const store = input.options.deps.store;
  const claim = await store.claimEmailDelivery({
    ticketId: input.ticketId,
    conversationId: input.options.deps.conversationId,
    purpose: "instagram-inbound-notify",
    idempotencyKey: `email:ig-inbound:${input.ticketId}:${input.options.inboundMessageId}`,
  });
  if (claim.outcome !== "claimed") return;
  const mail = await import("@/lib/email/instagram-ticket-mail");
  const mailed = await mail.sendInstagramInboundHelpNotification({
    ticket,
    messagePreview: input.options.inboundText,
    channelLabel: "Instagram",
  });
  await store.markEmailDelivery(claim.id, {
    deliveryStatus:
      mailed.outcome === "sent"
        ? "sent"
        : mailed.outcome === "skipped"
          ? "skipped"
          : "failed",
    brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
    errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
  });
}

async function runInstagramInternalEmailBackground(input: {
  options: ApplyEffectsOptions;
  purpose: "agency" | "other";
  claimId: string;
}): Promise<void> {
  const mail = await import("@/lib/email/instagram-ticket-mail");
  const collected = input.options.collected;
  const conversationRef = input.options.event.externalConversationId;
  const mailed =
    input.purpose === "agency"
      ? await mail.sendInstagramAgencyDetailsEmail({
          agencyName: collected.agencyName,
          contactName: collected.creatorName,
          contactEmail: collected.email,
          rosterUrl: collected.rosterUrl,
          instagramConversationRef: conversationRef,
        })
      : await mail.sendInstagramGeneralInquiryEmail({
          contactName: collected.creatorName,
          contactEmail: collected.email,
          contactPhone: collected.phoneDisplay ?? collected.phoneNormalized,
          inquiryDetails: collected.inquiryDetails,
          instagramConversationRef: conversationRef,
        });
  await input.options.deps.store.markEmailDelivery(input.claimId, {
    deliveryStatus:
      mailed.outcome === "sent"
        ? "sent"
        : mailed.outcome === "skipped"
          ? "skipped"
          : "failed",
    brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
    errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
  });
}

async function applyInstagramCriticalPath(
  options: ApplyEffectsOptions,
): Promise<ApplyEffectsResult> {
  const deps = options.deps;
  let ticketId = options.snapshotTicketId;
  let ticketCode: string | null = null;
  let snapshot = options.snapshotToPersist
    ? { ...options.snapshotToPersist }
    : null;
  const lastMessageAt = options.lastMessageAt ?? new Date().toISOString();
  let sendEffects: MachineSendEffect[] = [];
  const routingUpdates: Array<{ fromKind: string; toKind: "collaboration" | "support" }> =
    [];
  let notifyHelp = false;
  let postCommitSnapshotSaved = false;
  const queuedInternalEmails: Array<{ purpose: "agency" | "other" }> = [];

  for (const effect of options.effects) {
    if (effect.type === "send_text" || effect.type === "send_quick_replies") {
      sendEffects.push(effect);
      continue;
    }
    if (effect.type === "mark_unclassified_as") {
      routingUpdates.push({ fromKind: "unclassified", toKind: effect.routingKind });
      continue;
    }
    if (effect.type === "notify_help_inbound") {
      notifyHelp = true;
      continue;
    }
    if (effect.type === "queue_internal_email") {
      queuedInternalEmails.push({ purpose: effect.purpose });
      continue;
    }
    if (effect.type === "create_ticket") {
      const created = await timeInstagramMetric(
        options.timing,
        "instagram_ticket_create_ms",
        () => createTicketIfNeeded(options),
      );
      if (created.retryableFailure) {
        await releaseInstagramAttending(options.attending);
        return {
          ticketId: created.ticketId,
          ticketCode: created.ticketCode,
          retryableFailure: true,
          snapshotPersisted: false,
        };
      }
      ticketId = created.ticketId;
      ticketCode = created.ticketCode;
      if (snapshot && created.ticketId) {
        const ackKey = channelTicketCreatedKey("ig", created.ticketId);
        snapshot = bindCommittedTicketSnapshot(snapshot, {
          ticketId: created.ticketId,
          ticketCode: created.ticketCode,
          lastPromptKey: ackKey,
        });
        const linked = await deps.store.saveConversationSnapshot(
          deps.conversationId,
          snapshot,
          lastMessageAt,
          options.displayName ?? null,
        );
        if (linked.outcome === "failed") {
          await releaseInstagramAttending(options.attending);
          return {
            ticketId: created.ticketId,
            ticketCode: created.ticketCode,
            retryableFailure: true,
            snapshotPersisted: false,
            errorCode: "conversation_update_failed",
            created: created.created,
            conversationLinked: false,
          };
        }
        postCommitSnapshotSaved = true;
      }
      if (created.ticketCode && created.ticketId) {
        const ackKey = channelTicketCreatedKey("ig", created.ticketId);
        const closingKey = channelOutboundKey(
          "ig",
          deps.conversationId,
          options.intakeSessionVersion,
          ackKey,
        );
        const existingStatus = await existingClosingDeliveryStatus(
          deps.store,
          closingKey,
        );
        if (!isFinalOutboundDelivery(existingStatus)) {
          if (!existingStatus) {
            sendEffects.push({
              type: "send_quick_replies",
              text: withPostCompletionQuestion(
                creatorTicketRaisedText(created.ticketCode),
              ),
              promptKey: ackKey,
              quickReplies: postCompletionQuickReplies(),
            });
          }
        }
      }
    }
  }

  sendEffects = dropObsoleteCreatorConfirmSends(sendEffects, ticketId);

  if (snapshot) {
    if (
      sendEffects.length > 0 &&
      !instagramOutboundAddressesAreAssigned({
        senderAddress: deps.outboundSenderAddress,
        recipientExternalId: deps.recipientId,
      })
    ) {
      await releaseInstagramAttending(options.attending);
      return {
        ticketId,
        ticketCode,
        retryableFailure: true,
        snapshotPersisted: Boolean(ticketId && snapshot),
        errorCode: "outbound_address_invalid",
      };
    }
    const reserved = await timeInstagramMetric(
      options.timing,
      "instagram_reserve_ms",
      () =>
        deps.store.reserveOutboundAndSnapshot({
          conversationId: deps.conversationId,
          snapshot,
          lastMessageAt,
          displayName: options.displayName ?? null,
          expectedLastProcessedExternalMessageId: postCommitSnapshotSaved
            ? (snapshot.lastProcessedExternalMessageId ??
              options.expectedLastProcessedExternalMessageId ??
              null)
            : (options.expectedLastProcessedExternalMessageId ?? null),
          outbounds: sendEffects.map((effect) => ({
            channel: "instagram" as const,
            recipientExternalId: deps.recipientId,
            senderAddress: deps.outboundSenderAddress ?? null,
            messageBody: effect.text,
            idempotencyKey: channelOutboundKey(
              "ig",
              deps.conversationId,
              options.intakeSessionVersion,
              effect.promptKey,
            ),
            purpose: effect.promptKey.split(":")[0] ?? "prompt",
            ticketId,
            routingKind: "support",
            rawPayload: durableInstagramOutboundPayload({
              text: effect.text,
              quickReplies:
                effect.type === "send_quick_replies" ? effect.quickReplies : undefined,
            }),
          } satisfies OutboundReserveInput)),
        }),
    );
    if (reserved.outcome === "failed") {
      await releaseInstagramAttending(options.attending);
      return {
        ticketId,
        ticketCode,
        retryableFailure: reserved.errorCode !== OUTBOUND_IDEMPOTENCY_CONFLICT,
        snapshotPersisted: false,
        errorCode: reserved.errorCode,
      };
    }
    options.timing?.mark("outbound_reserved");
    const newlyReserved = reserved.outbounds.filter(
      (row) =>
        row.deliveryStatus !== "sent" &&
        row.deliveryStatus !== "delivered" &&
        row.deliveryStatus !== "read",
    );
    if (newlyReserved.length === 0) {
      await releaseInstagramAttending(options.attending);
    } else {
      options.timing?.record("instagram_after_scheduled", 1);
      await scheduleAfterResponse(async () => {
        try {
          await drainInstagramOutbox({
            store: deps.store,
            recipientId: deps.recipientId,
            conversationId: deps.conversationId,
            sendDeps: deps.sendDeps,
            reserved: newlyReserved,
            effects: sendEffects,
            attending: options.attending,
            typingMode: "off_only",
            timing: options.timing,
          });
        } catch {
          // Reserved pending/failed rows remain recoverable by the outbox.
        } finally {
          await finishInstagramAttending(options.attending);
          options.timing?.mark("meta_send_completed");
        }
      });
    }
  } else {
    options.timing?.mark("outbound_reserved");
    if (sendEffects.length === 0) {
      await releaseInstagramAttending(options.attending);
    } else {
      options.timing?.record("instagram_after_scheduled", 1);
      await scheduleAfterResponse(async () => {
        try {
          for (const effect of sendEffects) {
            await dispatchSend(
              effect,
              deps,
              ticketId,
              options.intakeSessionVersion,
              "instagram",
            );
          }
        } catch {
          // Unreserved sends are best-effort after HTTP 200.
        } finally {
          await finishInstagramAttending(options.attending);
        }
        options.timing?.mark("meta_send_completed");
      });
    }
  }

  await scheduleAfterResponse(async () => {
    for (const update of routingUpdates) {
      await deps.store.markMessagesRoutingKind({
        conversationId: deps.conversationId,
        fromKind: update.fromKind,
        toKind: update.toKind,
      });
    }
    if (ticketId) {
      await runInstagramTicketBackground({
        options,
        ticketId,
        ticketCode,
        intakeSessionVersion: options.intakeSessionVersion,
      });
    }
    if (notifyHelp && ticketId) {
      await runInstagramHelpBackground({ options, ticketId });
    }
    for (const queued of queuedInternalEmails) {
      const idempotencyKey = `email:ig-${queued.purpose}:${deps.conversationId}:v${options.intakeSessionVersion}`;
      const claimed = await deps.store.claimEmailDelivery({
        ticketId: null,
        conversationId: deps.conversationId,
        purpose:
          queued.purpose === "agency"
            ? "instagram-agency-details"
            : "instagram-general-inquiry",
        idempotencyKey,
      });
      if (claimed.outcome !== "claimed") continue;
      await runInstagramInternalEmailBackground({
        options,
        purpose: queued.purpose,
        claimId: claimed.id,
      });
    }
    options.timing?.mark("background_work_completed");
  });

  return {
    ticketId,
    ticketCode,
    retryableFailure: false,
    snapshotPersisted: Boolean(snapshot),
  };
}

export async function applyInstagramEffects(
  options: ApplyEffectsOptions,
): Promise<ApplyEffectsResult> {
  const channel = options.channel ?? "instagram";
  if (channel === "instagram") {
    return applyInstagramCriticalPath(options);
  }
  if (options.event.provider === WATI_WHATSAPP_PROVIDER) {
    return applyWatiCriticalPath(options);
  }

  let ticketId = options.snapshotTicketId;
  let ticketCode: string | null = null;
  let snapshotPersisted = false;

  for (const effect of options.effects) {
    if (effect.type === "send_text" || effect.type === "send_quick_replies") {
      if (ticketId && isCreatorConfirmPromptKey(effect.promptKey)) {
        continue;
      }
      const sent = await dispatchSend(
        effect,
        options.deps,
        ticketId,
        options.intakeSessionVersion,
        channel,
      );
      if (sent.retryableFailure) {
        return { ticketId, ticketCode, retryableFailure: true, snapshotPersisted: false };
      }
      continue;
    }

    if (effect.type === "mark_unclassified_as") {
      await options.deps.store.markMessagesRoutingKind({
        conversationId: options.deps.conversationId,
        fromKind: "unclassified",
        toKind: effect.routingKind,
      });
      continue;
    }

    if (effect.type === "create_ticket") {
      const created = await createTicketIfNeeded({ ...options, channel });
      if (created.retryableFailure) {
        return {
          ticketId: created.ticketId,
          ticketCode: created.ticketCode,
          retryableFailure: true,
          snapshotPersisted: false,
        };
      }
      ticketId = created.ticketId;
      ticketCode = created.ticketCode;

      await options.deps.store.linkSupportMessagesToTicket({
        conversationId: options.deps.conversationId,
        ticketId: created.ticketId as string,
      });

      const ticket = await loadCreatedTicket(
        created.ticketId as string,
        options.deps.loadTicket,
      );
      const isWati = options.event.provider === WATI_WHATSAPP_PROVIDER;
      const mailTicket =
        ticket ??
        (isWati && created.ticketId && created.ticketCode
          ? dbTicketFromIntakeInsert({
              id: created.ticketId,
              ticketCode: created.ticketCode,
              insert: stampWatiTicketIdentity(
                mapIntakeToInstagramTicketInsert({
                  collected: options.collected,
                  externalContactId: options.event.externalContactId,
                  externalConversationId: options.event.externalConversationId,
                  sourceChannel: "whatsapp",
                  recipientAccountId: options.event.recipientAccountId ?? null,
                }),
                {
                  provider: WATI_WHATSAPP_PROVIDER,
                  recipientAccountId: options.event.recipientAccountId ?? "",
                },
              ),
            })
          : null);

      const confirmCode = created.ticketCode ?? mailTicket?.ticket_code ?? "";
      const watiAckKey = created.ticketId
        ? channelTicketCreatedKey("wa", created.ticketId)
        : "";

      if (isWati && created.ticketId && options.snapshotToPersist) {
        const postSnapshot = bindCommittedTicketSnapshot(options.snapshotToPersist, {
          ticketId: created.ticketId,
          ticketCode: created.ticketCode,
          lastPromptKey: watiAckKey,
        });
        const linked = await options.deps.store.saveConversationSnapshot(
          options.deps.conversationId,
          postSnapshot,
          options.lastMessageAt ??
            postSnapshot.lastActivityAt ??
            new Date().toISOString(),
          options.displayName ?? null,
        );
        snapshotPersisted = linked.outcome !== "failed";
        if (!snapshotPersisted) {
          return {
            ticketId,
            ticketCode,
            retryableFailure: true,
            snapshotPersisted: false,
            errorCode: "conversation_update_failed",
            created: created.created,
            conversationLinked: false,
          };
        }
      }

      let emailClaimed = false;
      let emailSent = false;
      if (mailTicket && created.ticketId) {
        const transcriptRows = await options.deps.store.listSupportTranscript({
          conversationId: options.deps.conversationId,
          ticketId: created.ticketId,
        });
        emailSent = await deliverChannelTicketConfirmationEmail({
          store: options.deps.store,
          ticket: mailTicket,
          conversationId: options.deps.conversationId,
          ticketId: created.ticketId,
          purpose: "whatsapp-ticket-confirmation",
          transcriptText: formatTranscript(transcriptRows),
        });
        emailClaimed = true;
      }

      let dmFailed = false;
      let outboundClaimed = false;
      let sendErrorCode: string | undefined;
      let confirmSendHttpStatus: number | null = null;
      let confirmSendOperation: "text" | "buttons" | "list" | undefined;
      if (isWati) {
        if (confirmCode && created.ticketId) {
          const closingKey = channelOutboundKey(
            "wa",
            options.deps.conversationId,
            options.intakeSessionVersion,
            watiAckKey,
          );
          const existingStatus = await existingClosingDeliveryStatus(
            options.deps.store,
            closingKey,
          );
          if (isFinalOutboundDelivery(existingStatus)) {
            outboundClaimed = true;
          } else {
            const confirmSend = await dispatchSend(
              {
                type: "send_quick_replies",
                text: withPostCompletionQuestion(
                  creatorTicketRaisedText(confirmCode),
                ),
                promptKey: watiAckKey,
                quickReplies: postCompletionQuickReplies(),
              },
              options.deps,
              created.ticketId,
              options.intakeSessionVersion,
              channel,
            );
            dmFailed = confirmSend.retryableFailure;
            outboundClaimed = confirmSend.outboundClaimed;
            sendErrorCode = confirmSend.errorCode;
            confirmSendHttpStatus = confirmSend.httpStatus ?? null;
            confirmSendOperation = confirmSend.operation;
          }
        }
      } else {
        const firstName = firstNameFromFullName(
          mailTicket?.creator_name ?? options.collected.creatorName ?? "",
        );
        if (confirmCode && created.ticketId) {
          const confirmSend = await dispatchSend(
            {
              type: "send_text",
              text: emailSent
                ? ticketCreatedWithEmailText(firstName, confirmCode)
                : ticketCreatedWithoutEmailText(firstName, confirmCode),
              promptKey: channelTicketCreatedKey("wa", created.ticketId),
            },
            options.deps,
            created.ticketId,
            options.intakeSessionVersion,
            channel,
          );
          dmFailed = confirmSend.retryableFailure;
          outboundClaimed = confirmSend.outboundClaimed;
          sendErrorCode = confirmSend.errorCode;
        }
      }

      if (dmFailed) {
        const operation =
          isWati ? ("buttons" as const) : ("text" as const);
        return {
          ticketId,
          ticketCode,
          retryableFailure: true,
          snapshotPersisted,
          created: created.created,
          conversationLinked: snapshotPersisted,
          closingReserved: outboundClaimed,
          emailClaimed,
          errorCode: isWati
            ? classifyWatiSendFailureCode({
                operation: confirmSendOperation ?? operation,
                httpStatus: confirmSendHttpStatus ?? null,
                retryable: true,
                stage: "post_ticket_closing",
              })
            : sendErrorCode ?? "whatsapp_send_failed",
        };
      }
      continue;
    }

    if (effect.type === "notify_help_inbound" && ticketId) {
      const ticket = await loadCreatedTicket(ticketId, options.deps.loadTicket);
      if (!ticket) continue;
      const claim = await options.deps.store.claimEmailDelivery({
        ticketId,
        conversationId: options.deps.conversationId,
        purpose: "whatsapp-inbound-notify",
        idempotencyKey: `email:wa-inbound:${ticketId}:${options.inboundMessageId}`,
      });
      if (claim.outcome !== "claimed") continue;
      const mail = await import("@/lib/email/instagram-ticket-mail");
      const mailed = await mail.sendInstagramInboundHelpNotification({
        ticket,
        messagePreview: options.inboundText,
        channelLabel: "WhatsApp",
      });
      await options.deps.store.markEmailDelivery(claim.id, {
        deliveryStatus:
          mailed.outcome === "sent"
            ? "sent"
            : mailed.outcome === "skipped"
              ? "skipped"
              : "failed",
        brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
        errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
      });
    }
  }

  return { ticketId, ticketCode, retryableFailure: false, snapshotPersisted };
}

async function applyWatiCriticalPath(
  options: ApplyEffectsOptions,
): Promise<ApplyEffectsResult> {
  const deps = options.deps;
  const snapshot = options.snapshotToPersist
    ? { ...options.snapshotToPersist }
    : null;
  let ticketId = options.snapshotTicketId;
  let ticketCode: string | null = null;
  let sendEffects: MachineSendEffect[] = [];
  const routingUpdates: Array<{ fromKind: string; toKind: "collaboration" | "support" }> =
    [];
  let notifyHelp = false;
  let createdTicket = false;
  let shouldSendConfirmationEmail = false;
  const lastMessageAt = options.lastMessageAt ?? new Date().toISOString();

  for (const effect of options.effects) {
    if (effect.type === "send_text" || effect.type === "send_quick_replies") {
      if (ticketId && isCreatorConfirmPromptKey(effect.promptKey)) continue;
      sendEffects.push(effect);
      continue;
    }
    if (effect.type === "mark_unclassified_as") {
      routingUpdates.push({ fromKind: "unclassified", toKind: effect.routingKind });
      continue;
    }
    if (effect.type === "notify_help_inbound") {
      notifyHelp = true;
      continue;
    }
    if (effect.type === "create_ticket") {
      const created = await createTicketIfNeeded({ ...options, channel: "whatsapp" });
      if (created.retryableFailure) {
        return {
          ticketId: created.ticketId,
          ticketCode: created.ticketCode,
          retryableFailure: true,
          snapshotPersisted: false,
        };
      }
      ticketId = created.ticketId;
      ticketCode = created.ticketCode;
      createdTicket = created.created;
      shouldSendConfirmationEmail = true;
      await deps.store.linkSupportMessagesToTicket({
        conversationId: deps.conversationId,
        ticketId: created.ticketId as string,
      });
      const watiAckKey = created.ticketId
        ? channelTicketCreatedKey("wa", created.ticketId)
        : "";
      if (snapshot && created.ticketId) {
        Object.assign(
          snapshot,
          bindCommittedTicketSnapshot(snapshot, {
            ticketId: created.ticketId,
            ticketCode: created.ticketCode,
            lastPromptKey: watiAckKey,
          }),
        );
      }
      if (created.ticketCode && created.ticketId) {
        const closingKey = channelOutboundKey(
          "wa",
          deps.conversationId,
          options.intakeSessionVersion,
          watiAckKey,
        );
        const existingStatus = await existingClosingDeliveryStatus(
          deps.store,
          closingKey,
        );
        if (!isFinalOutboundDelivery(existingStatus)) {
          sendEffects.push({
            type: "send_quick_replies",
            text: withPostCompletionQuestion(
              creatorTicketRaisedText(created.ticketCode),
            ),
            promptKey: watiAckKey,
            quickReplies: postCompletionQuickReplies(),
          });
        }
      }
    }
  }

  sendEffects = dropObsoleteCreatorConfirmSends(sendEffects, ticketId);

  if (snapshot && ticketId && snapshot.state !== "completed") {
    if (
      createdTicket ||
      INTAKE_STATES_BLOCKED_AFTER_TICKET.has(snapshot.state) ||
      snapshot.state === "ticket_open"
    ) {
      const ackKey = channelTicketCreatedKey("wa", ticketId);
      Object.assign(
        snapshot,
        bindCommittedTicketSnapshot(snapshot, {
          ticketId,
          ticketCode: ticketCode ?? snapshot.ticketCode,
          lastPromptKey:
            snapshot.lastPromptKey &&
            !isCreatorConfirmPromptKey(snapshot.lastPromptKey)
              ? snapshot.lastPromptKey
              : ackKey,
        }),
      );
    }
  }

  if (!snapshot) {
    if (sendEffects.length > 0) {
      return {
        ticketId,
        ticketCode,
        retryableFailure: true,
        snapshotPersisted: false,
        errorCode: "conversation_update_failed",
      };
    }
    await scheduleWatiOutboxDrain(options);
    return { ticketId, ticketCode, retryableFailure: false, snapshotPersisted: false };
  }

  if (typeof deps.store.reserveWatiOutboundAndSnapshot !== "function") {
    return {
      ticketId,
      ticketCode,
      retryableFailure: true,
      snapshotPersisted: false,
      errorCode: "outbound_reserve_failed",
    };
  }

  const reserved = await deps.store.reserveWatiOutboundAndSnapshot({
    conversationId: deps.conversationId,
    snapshot,
    lastMessageAt,
    displayName: options.displayName ?? null,
    expectedLastProcessedExternalMessageId:
      options.expectedLastProcessedExternalMessageId ?? null,
    outbounds: sendEffects.map((effect) => ({
      channel: "whatsapp" as const,
      recipientExternalId: deps.recipientId,
      senderAddress: options.event.recipientAccountId ?? deps.recipientId,
      messageBody: effect.text,
      idempotencyKey: channelOutboundKey(
        "wa",
        deps.conversationId,
        options.intakeSessionVersion,
        effect.promptKey,
      ),
      purpose: effect.promptKey.split(":")[0] ?? "prompt",
      ticketId,
      routingKind: "support",
      rawPayload: durableInstagramOutboundPayload({
        text: effect.text,
        quickReplies:
          effect.type === "send_quick_replies" ? effect.quickReplies : undefined,
      }),
    })),
  });

  if (reserved.outcome === "failed") {
    return {
      ticketId,
      ticketCode,
      retryableFailure: reserved.errorCode !== OUTBOUND_IDEMPOTENCY_CONFLICT,
      snapshotPersisted: false,
      errorCode: reserved.errorCode,
      created: createdTicket,
      conversationLinked: false,
    };
  }

  let emailClaimed = false;
  if (shouldSendConfirmationEmail && ticketId) {
    const ticket = await loadCreatedTicket(ticketId, deps.loadTicket);
    const mailTicket =
      ticket ??
      (ticketId && ticketCode
        ? dbTicketFromIntakeInsert({
            id: ticketId,
            ticketCode,
            insert: stampWatiTicketIdentity(
              mapIntakeToInstagramTicketInsert({
                collected: options.collected,
                externalContactId: options.event.externalContactId,
                externalConversationId: options.event.externalConversationId,
                sourceChannel: "whatsapp",
                recipientAccountId: options.event.recipientAccountId ?? null,
              }),
              {
                provider: WATI_WHATSAPP_PROVIDER,
                recipientAccountId: options.event.recipientAccountId ?? "",
              },
            ),
          })
        : null);
    if (mailTicket) {
      const transcriptRows = await deps.store.listSupportTranscript({
        conversationId: deps.conversationId,
        ticketId,
      });
      await deliverChannelTicketConfirmationEmail({
        store: deps.store,
        ticket: mailTicket,
        conversationId: deps.conversationId,
        ticketId,
        purpose: "whatsapp-ticket-confirmation",
        transcriptText: formatTranscript(transcriptRows),
      });
      emailClaimed = true;
    }
  }

  const newlyReserved = reserved.outbounds.filter(
    (row) =>
      row.deliveryStatus !== "sent" &&
      row.deliveryStatus !== "delivered" &&
      row.deliveryStatus !== "read",
  );
  let sendFailed = false;
  let confirmSendHttpStatus: number | null = null;
  let confirmSendOperation: "text" | "buttons" | "list" | undefined;
  if (newlyReserved.length > 0) {
    const drained = await drainWatiConversationOutbox({
      store: deps.store,
      recipientId: deps.recipientId,
      conversationId: deps.conversationId,
      sendDeps: deps.sendDeps,
      reserved: reserved.outbounds,
      effects: sendEffects,
    });
    sendFailed = drained.retryableFailure;
    if (sendFailed) {
      confirmSendHttpStatus = 500;
      confirmSendOperation = "buttons";
    }
  }

  if (notifyHelp && ticketId) {
    const ticket = await loadCreatedTicket(ticketId, deps.loadTicket);
    if (ticket) {
      const claim = await deps.store.claimEmailDelivery({
        ticketId,
        conversationId: deps.conversationId,
        purpose: "whatsapp-inbound-notify",
        idempotencyKey: `email:wa-inbound:${ticketId}:${options.inboundMessageId}`,
      });
      if (claim.outcome === "claimed") {
        const mail = await import("@/lib/email/instagram-ticket-mail");
        const mailed = await mail.sendInstagramInboundHelpNotification({
          ticket,
          messagePreview: options.inboundText,
          channelLabel: "WhatsApp",
        });
        await deps.store.markEmailDelivery(claim.id, {
          deliveryStatus:
            mailed.outcome === "sent"
              ? "sent"
              : mailed.outcome === "skipped"
                ? "skipped"
                : "failed",
          brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
          errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
        });
      }
    }
  }

  for (const update of routingUpdates) {
    await deps.store.markMessagesRoutingKind({
      conversationId: deps.conversationId,
      fromKind: update.fromKind,
      toKind: update.toKind,
    });
  }

  await scheduleWatiOutboxDrain(options);

  if (sendFailed) {
    return {
      ticketId,
      ticketCode,
      retryableFailure: true,
      snapshotPersisted: true,
      created: createdTicket,
      conversationLinked: true,
      closingReserved: newlyReserved.length > 0 || reserved.outbounds.length > 0,
      emailClaimed,
      errorCode: classifyWatiSendFailureCode({
        operation: confirmSendOperation ?? "buttons",
        httpStatus: confirmSendHttpStatus,
        retryable: true,
        stage: shouldSendConfirmationEmail ? "post_ticket_closing" : "pre_ticket",
      }),
    };
  }

  return {
    ticketId,
    ticketCode,
    retryableFailure: false,
    snapshotPersisted: true,
    created: createdTicket,
    conversationLinked: true,
    closingReserved: reserved.outbounds.length > 0,
    emailClaimed,
  };
}

function scheduleWatiOutboxDrain(options: ApplyEffectsOptions): Promise<void> {
  return scheduleAfterResponse(async () => {
    try {
      await drainWatiConversationOutbox({
        store: options.deps.store,
        recipientId: options.deps.recipientId,
        conversationId: options.deps.conversationId,
        sendDeps: options.deps.sendDeps,
      });
    } catch {
      // Reserved pending/failed rows remain recoverable by the outbox.
    }
  });
}

export async function applyWhatsAppEffects(
  options: Omit<ApplyEffectsOptions, "channel">,
) {
  return applyInstagramEffects({ ...options, channel: "whatsapp" });
}

export async function retryFailedInstagramOutbounds(
  deps: InstagramEffectDeps,
  channel: ChannelEffectChannel = "instagram",
): Promise<{ retryableFailure: boolean }> {
  if (channel === "instagram") {
    await drainInstagramOutbox({
      store: deps.store,
      recipientId: deps.recipientId,
      conversationId: deps.conversationId,
      sendDeps: deps.sendDeps,
    });
    return { retryableFailure: false };
  }
  return drainWatiConversationOutbox({
    store: deps.store,
    recipientId: deps.recipientId,
    conversationId: deps.conversationId,
    sendDeps: deps.sendDeps,
  });
}
