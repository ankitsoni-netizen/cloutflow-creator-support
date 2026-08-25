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
import type { InstagramTimingSession } from "@/lib/meta/timing";
import {
  sendInstagramQuickReplies,
  sendInstagramText,
  type InstagramSendDeps,
} from "@/lib/meta/instagram-send";
import {
  sendWhatsAppReplyButtons,
  sendWhatsAppText,
  type WhatsAppSendDeps,
} from "@/lib/meta/whatsapp-send";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import type {
  InstagramIngestStore,
  OutboundReserveInput,
  ReservedOutboundRow,
} from "@/lib/meta/instagram-store";
import {
  instagramOutboundAddressesAreAssigned,
  OUTBOUND_IDEMPOTENCY_CONFLICT,
} from "@/lib/meta/instagram-reserve";
import {
  channelOutboundKey,
  channelTicketCreatedKey,
  isSameSessionPrompt,
  type ChatbotIdempotencyPrefix,
} from "@/lib/meta/prompt-keys";
import type { DbTicket } from "@/lib/tickets/types";

export type ChannelEffectChannel = "instagram" | "whatsapp";

export type InstagramEffectDeps = {
  store: InstagramIngestStore;
  recipientId: string;
  conversationId: string;
  outboundSenderAddress?: string | null;
  sendDeps?: InstagramSendDeps | WhatsAppSendDeps;
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
  };
  deps: InstagramEffectDeps;
  snapshotToPersist?: ConversationSnapshot;
  expectedLastProcessedExternalMessageId?: string | null;
  lastMessageAt?: string;
  displayName?: string | null;
  timing?: InstagramTimingSession;
};

export type ApplyEffectsResult = {
  ticketId: string | null;
  ticketCode: string | null;
  retryableFailure: boolean;
  snapshotPersisted: boolean;
  errorCode?: string;
};

function prefixFor(channel: ChannelEffectChannel): ChatbotIdempotencyPrefix {
  return channel === "whatsapp" ? "wa" : "ig";
}

function shouldSendReserved(row: ReservedOutboundRow): boolean {
  if (row.claimed) return true;
  const status = row.deliveryStatus;
  if (status === "sent" || status === "delivered" || status === "read") {
    return false;
  }
  return status === "failed" || status === "pending";
}

async function sendChannelMessage(
  effect: MachineSendEffect,
  deps: InstagramEffectDeps,
  channel: ChannelEffectChannel,
) {
  const sendDeps = deps.sendDeps;
  if (channel === "whatsapp") {
    return effect.type === "send_quick_replies" && effect.quickReplies
      ? sendWhatsAppReplyButtons({
          recipientId: deps.recipientId,
          text: effect.text,
          quickReplies: effect.quickReplies,
          deps: sendDeps,
        })
      : sendWhatsAppText({
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
): Promise<{ retryableFailure: boolean }> {
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
  });
  if (claimed.outcome === "failed") {
    return { retryableFailure: true };
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
      return { retryableFailure: true };
    }
    if (
      claimed.deliveryStatus === "sent" ||
      claimed.deliveryStatus === "delivered" ||
      claimed.deliveryStatus === "read"
    ) {
      return { retryableFailure: false };
    }
    if (claimed.deliveryStatus !== "failed") {
      return { retryableFailure: false };
    }
  }

  const outboundId = claimed.id;
  const result = await sendChannelMessage(effect, deps, channel);

  if (result.ok) {
    await deps.store.markOutboundMessage(outboundId, {
      deliveryStatus: "sent",
      externalMessageId: result.metaMessageId,
      deliveryErrorCode: null,
    });
    return { retryableFailure: false };
  }

  await deps.store.markOutboundMessage(outboundId, {
    deliveryStatus: "failed",
    deliveryErrorCode: result.errorCode,
  });
  return { retryableFailure: true };
}

async function loadCreatedTicket(
  ticketId: string,
  loadTicket?: (id: string) => Promise<DbTicket | null>,
): Promise<DbTicket | null> {
  if (loadTicket) return loadTicket(ticketId);
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { TICKET_SELECT } = await import("@/lib/tickets/select");
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("tickets")
      .select(TICKET_SELECT)
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
  retryableFailure: boolean;
}> {
  const channel = options.channel ?? "instagram";
  let createdId = options.snapshotTicketId;
  let createdCode: string | null = null;

  if (!createdId) {
    const existing = await options.deps.store.findActiveInstagramTicket({
      externalConversationId: options.event.externalConversationId,
      externalContactId: options.event.externalContactId,
      sourceChannel: channel,
    });
    if (existing && "errorCode" in existing) {
      return { ticketId: null, ticketCode: null, retryableFailure: true };
    }
    if (existing) {
      createdId = existing.id;
      createdCode = existing.ticketCode ?? null;
    } else {
      const created = await options.deps.store.insertInstagramTicket(
        mapIntakeToInstagramTicketInsert({
          collected: options.collected,
          externalContactId: options.event.externalContactId,
          externalConversationId: options.event.externalConversationId,
          sourceChannel: channel,
        }),
      );
      if (created.outcome === "failed") {
        return { ticketId: null, ticketCode: null, retryableFailure: true };
      }
      createdId = created.id;
      createdCode = created.ticketCode;
    }
  } else {
    const linked = await options.deps.store.getTicket(createdId);
    if (linked && "errorCode" in linked) {
      return { ticketId: createdId, ticketCode: null, retryableFailure: true };
    }
    createdCode = linked?.ticketCode ?? null;
  }

  return { ticketId: createdId, ticketCode: createdCode, retryableFailure: false };
}

async function sendReservedEffects(input: {
  effects: MachineSendEffect[];
  reserved: ReservedOutboundRow[];
  deps: InstagramEffectDeps;
  channel: ChannelEffectChannel;
  timing?: InstagramTimingSession;
}): Promise<{ retryableFailure: boolean }> {
  let sentAny = false;
  for (let index = 0; index < input.effects.length; index += 1) {
    const effect = input.effects[index];
    const reserved = input.reserved[index];
    if (!effect || !reserved) {
      return { retryableFailure: true };
    }
    if (!shouldSendReserved(reserved)) continue;
    const result = await sendChannelMessage(effect, input.deps, input.channel);
    sentAny = true;
    if (result.ok) {
      await input.deps.store.markOutboundMessage(reserved.id, {
        deliveryStatus: "sent",
        externalMessageId: result.metaMessageId,
        deliveryErrorCode: null,
      });
      continue;
    }
    await input.deps.store.markOutboundMessage(reserved.id, {
      deliveryStatus: "failed",
      deliveryErrorCode: result.errorCode,
    });
    if (sentAny) input.timing?.mark("meta_send_completed");
    return { retryableFailure: true };
  }
  if (sentAny || input.effects.length === 0) {
    input.timing?.mark("meta_send_completed");
  }
  return { retryableFailure: false };
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

  const mail = await import("@/lib/email/instagram-ticket-mail");
  const ticket = await loadCreatedTicket(ticketId, options.deps.loadTicket);
  if (!ticket) return;

  const transcriptRows = await store.listSupportTranscript({
    conversationId: options.deps.conversationId,
    ticketId,
  });
  const transcriptText = formatTranscript(transcriptRows);
  const confirmationClaim = await store.claimEmailDelivery({
    ticketId,
    conversationId: options.deps.conversationId,
    purpose: "instagram-ticket-confirmation",
    idempotencyKey: `email:ig-confirm:${ticketId}`,
  });

  let emailSent = false;
  if (confirmationClaim.outcome === "claimed") {
    const mailed = await mail.sendInstagramTicketConfirmationEmail({
      ticket,
      transcriptText,
    });
    await store.markEmailDelivery(confirmationClaim.id, {
      deliveryStatus:
        mailed.outcome === "sent"
          ? "sent"
          : mailed.outcome === "skipped"
            ? "skipped"
            : "failed",
      brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
      errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
    });
    emailSent = mailed.outcome === "sent";
  } else if (
    confirmationClaim.outcome === "duplicate" &&
    confirmationClaim.deliveryStatus === "sent"
  ) {
    emailSent = true;
  }

  if (!emailSent) return;
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
  const sendEffects: MachineSendEffect[] = [];
  const routingUpdates: Array<{ fromKind: string; toKind: "collaboration" | "support" }> =
    [];
  let createdTicket = false;
  let notifyHelp = false;
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
      const created = await createTicketIfNeeded(options);
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
      createdTicket = Boolean(created.ticketId);
      if (snapshot && created.ticketId) {
        snapshot = {
          ...snapshot,
          ticketId: created.ticketId,
          state: "awaiting_post_completion",
          lastPromptKey: "awaiting_post_completion",
        };
      }
      if (created.ticketId) {
        await deps.store.markMessagesRoutingKind({
          conversationId: deps.conversationId,
          fromKind: "unclassified",
          toKind: "support",
        });
        await deps.store.linkSupportMessagesToTicket({
          conversationId: deps.conversationId,
          ticketId: created.ticketId,
        });
      }
      if (created.ticketCode) {
        sendEffects.push({
          type: "send_quick_replies",
          text: withPostCompletionQuestion(
            creatorTicketRaisedText(created.ticketCode),
          ),
          promptKey: "awaiting_post_completion",
          quickReplies: postCompletionQuickReplies(),
        });
      }
    }
  }

  if (snapshot) {
    if (
      sendEffects.length > 0 &&
      !instagramOutboundAddressesAreAssigned({
        senderAddress: deps.outboundSenderAddress,
        recipientExternalId: deps.recipientId,
      })
    ) {
      return {
        ticketId,
        ticketCode,
        retryableFailure: true,
        snapshotPersisted: false,
        errorCode: "outbound_address_invalid",
      };
    }
    const reserved = await deps.store.reserveOutboundAndSnapshot({
      conversationId: deps.conversationId,
      snapshot,
      lastMessageAt,
      displayName: options.displayName ?? null,
      expectedLastProcessedExternalMessageId:
        options.expectedLastProcessedExternalMessageId ?? null,
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
      } satisfies OutboundReserveInput)),
    });
    if (reserved.outcome === "failed") {
      return {
        ticketId,
        ticketCode,
        retryableFailure: reserved.errorCode !== OUTBOUND_IDEMPOTENCY_CONFLICT,
        snapshotPersisted: false,
        errorCode: reserved.errorCode,
      };
    }
    options.timing?.mark("outbound_reserved");
    const sent = await sendReservedEffects({
      effects: sendEffects,
      reserved: reserved.outbounds,
      deps,
      channel: "instagram",
      timing: options.timing,
    });
    if (sent.retryableFailure) {
      return {
        ticketId,
        ticketCode,
        retryableFailure: true,
        snapshotPersisted: true,
      };
    }
  } else {
    options.timing?.mark("outbound_reserved");
    for (const effect of sendEffects) {
      const sent = await dispatchSend(
        effect,
        deps,
        ticketId,
        options.intakeSessionVersion,
        "instagram",
      );
      if (sent.retryableFailure) {
        options.timing?.mark("meta_send_completed");
        return {
          ticketId,
          ticketCode,
          retryableFailure: true,
          snapshotPersisted: false,
        };
      }
    }
    options.timing?.mark("meta_send_completed");
  }

  await scheduleAfterResponse(async () => {
    for (const update of routingUpdates) {
      await deps.store.markMessagesRoutingKind({
        conversationId: deps.conversationId,
        fromKind: update.fromKind,
        toKind: update.toKind,
      });
    }
    if (createdTicket && ticketId) {
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

  let ticketId = options.snapshotTicketId;
  let ticketCode: string | null = null;

  for (const effect of options.effects) {
    if (effect.type === "send_text" || effect.type === "send_quick_replies") {
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
      let emailSent = false;
      if (ticket) {
        const transcriptRows = await options.deps.store.listSupportTranscript({
          conversationId: options.deps.conversationId,
          ticketId: created.ticketId as string,
        });
        const transcriptText = formatTranscript(transcriptRows);
        const confirmationClaim = await options.deps.store.claimEmailDelivery({
          ticketId: created.ticketId,
          conversationId: options.deps.conversationId,
          purpose: "whatsapp-ticket-confirmation",
          idempotencyKey: `email:wa-confirm:${created.ticketId}`,
        });
        if (confirmationClaim.outcome === "claimed") {
          const mail = await import("@/lib/email/instagram-ticket-mail");
          const mailed = await mail.sendInstagramTicketConfirmationEmail({
            ticket,
            transcriptText,
          });
          await options.deps.store.markEmailDelivery(confirmationClaim.id, {
            deliveryStatus:
              mailed.outcome === "sent"
                ? "sent"
                : mailed.outcome === "skipped"
                  ? "skipped"
                  : "failed",
            brevoMessageId: mailed.outcome === "sent" ? mailed.messageId : null,
            errorCode: mailed.outcome === "sent" ? null : mailed.errorCode,
          });
          emailSent = mailed.outcome === "sent";
        } else if (
          confirmationClaim.outcome === "duplicate" &&
          confirmationClaim.deliveryStatus === "sent"
        ) {
          emailSent = true;
        }
      }

      const firstName = firstNameFromFullName(
        ticket?.creator_name ?? options.collected.creatorName ?? "",
      );
      const confirmCode = created.ticketCode ?? ticket?.ticket_code ?? "";
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
        if (confirmSend.retryableFailure) {
          return { ticketId, ticketCode, retryableFailure: true, snapshotPersisted: false };
        }
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

  return { ticketId, ticketCode, retryableFailure: false, snapshotPersisted: false };
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
  const failed =
    channel === "instagram"
      ? await deps.store.listRetryableOutbounds(deps.conversationId)
      : await deps.store.listFailedOutbounds(deps.conversationId);
  let retryableFailure = false;
  for (const row of failed) {
    const result =
      channel === "whatsapp"
        ? await sendWhatsAppText({
            recipientId: deps.recipientId,
            text: row.messageBody,
            deps: deps.sendDeps,
          })
        : await sendInstagramText({
            recipientId: deps.recipientId,
            text: row.messageBody,
            deps: deps.sendDeps,
          });
    if (result.ok) {
      await deps.store.markOutboundMessage(row.id, {
        deliveryStatus: "sent",
        externalMessageId: result.metaMessageId,
        deliveryErrorCode: null,
      });
      continue;
    }
    await deps.store.markOutboundMessage(row.id, {
      deliveryStatus: "failed",
      deliveryErrorCode: result.errorCode,
    });
    if (result.retryable) retryableFailure = true;
  }
  return { retryableFailure };
}
