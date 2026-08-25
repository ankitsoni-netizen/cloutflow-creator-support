import "server-only";

import {
  sendInstagramInboundHelpNotification,
  sendInstagramTicketConfirmationEmail,
} from "@/lib/email/instagram-ticket-mail";
import type { MachineEffect, MachineSendEffect } from "@/lib/meta/conversation-machine";
import {
  firstNameFromFullName,
  ticketCreatedWithEmailText,
  ticketCreatedWithoutEmailText,
} from "@/lib/meta/routing-copy";
import {
  sendInstagramQuickReplies,
  sendInstagramText,
  type InstagramSendDeps,
} from "@/lib/meta/instagram-send";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import { TICKET_SELECT } from "@/lib/tickets/select";
import type { DbTicket } from "@/lib/tickets/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type InstagramEffectDeps = {
  store: InstagramIngestStore;
  recipientId: string;
  conversationId: string;
  sendDeps?: InstagramSendDeps;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
};

function outboundIdempotency(
  conversationId: string,
  promptKey: string,
): string {
  return `ig:prompt:${conversationId}:${promptKey}`;
}

async function dispatchSend(
  effect: MachineSendEffect,
  deps: InstagramEffectDeps,
  ticketId: string | null,
): Promise<{ retryableFailure: boolean }> {
  const claimed = await deps.store.claimOutboundMessage({
    conversationId: deps.conversationId,
    ticketId,
    channel: "instagram",
    recipientExternalId: deps.recipientId,
    messageBody: effect.text,
    idempotencyKey: outboundIdempotency(deps.conversationId, effect.promptKey),
    purpose: effect.promptKey.split(":")[0] ?? "prompt",
  });
  if (claimed.outcome === "failed") {
    return { retryableFailure: true };
  }
  if (claimed.outcome === "duplicate") {
    if (
      claimed.deliveryStatus === "sent" ||
      claimed.deliveryStatus === "delivered"
    ) {
      return { retryableFailure: false };
    }
    if (claimed.deliveryStatus !== "failed") {
      return { retryableFailure: false };
    }
  }

  const outboundId = claimed.id;
  const result =
    effect.type === "send_quick_replies" && effect.quickReplies
      ? await sendInstagramQuickReplies({
          recipientId: deps.recipientId,
          text: effect.text,
          quickReplies: effect.quickReplies,
          deps: deps.sendDeps,
        })
      : await sendInstagramText({
          recipientId: deps.recipientId,
          text: effect.text,
          deps: deps.sendDeps,
        });

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
  return { retryableFailure: result.retryable };
}

async function loadCreatedTicket(
  ticketId: string,
  loadTicket?: (id: string) => Promise<DbTicket | null>,
): Promise<DbTicket | null> {
  if (loadTicket) return loadTicket(ticketId);
  try {
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

export async function applyInstagramEffects(options: {
  effects: MachineEffect[];
  snapshotTicketId: string | null;
  collected: Parameters<typeof mapIntakeToInstagramTicketInsert>[0]["collected"];
  inboundMessageId: string;
  inboundText: string;
  event: {
    externalContactId: string;
    externalConversationId: string;
  };
  deps: InstagramEffectDeps;
}): Promise<{
  ticketId: string | null;
  ticketCode: string | null;
  retryableFailure: boolean;
}> {
  let ticketId = options.snapshotTicketId;
  let ticketCode: string | null = null;
  let retryableFailure = false;

  for (const effect of options.effects) {
    if (effect.type === "send_text" || effect.type === "send_quick_replies") {
      const sent = await dispatchSend(effect, options.deps, ticketId);
      if (sent.retryableFailure) retryableFailure = true;
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
      let createdId = options.snapshotTicketId;
      let createdCode: string | null = ticketCode;

      if (!createdId) {
        const existing = await options.deps.store.findActiveInstagramTicket({
          externalConversationId: options.event.externalConversationId,
          externalContactId: options.event.externalContactId,
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
            }),
          );
          if (created.outcome === "failed") {
            return { ticketId: null, ticketCode: null, retryableFailure: true };
          }
          createdId = created.id;
          createdCode = created.ticketCode;
        }
      } else if (!createdCode) {
        const linked = await options.deps.store.getTicket(createdId);
        if (linked && "errorCode" in linked) {
          return { ticketId: createdId, ticketCode: null, retryableFailure: true };
        }
        createdCode = linked?.ticketCode ?? null;
      }

      ticketId = createdId;
      ticketCode = createdCode;

      await options.deps.store.linkSupportMessagesToTicket({
        conversationId: options.deps.conversationId,
        ticketId: createdId,
      });

      const ticket = await loadCreatedTicket(createdId, options.deps.loadTicket);
      let emailSent = false;
      if (ticket) {
        const transcriptRows = await options.deps.store.listSupportTranscript({
          conversationId: options.deps.conversationId,
          ticketId: createdId,
        });
        const transcriptText = formatTranscript(transcriptRows);

        const confirmationClaim = await options.deps.store.claimEmailDelivery({
          ticketId: createdId,
          conversationId: options.deps.conversationId,
          purpose: "instagram-ticket-confirmation",
          idempotencyKey: `email:ig-confirm:${createdId}`,
        });
        if (confirmationClaim.outcome === "claimed") {
          const mailed = await sendInstagramTicketConfirmationEmail({
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
            brevoMessageId:
              mailed.outcome === "sent" ? mailed.messageId : null,
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
      const confirmCode = createdCode ?? ticket?.ticket_code ?? "";
      if (confirmCode) {
        const confirmKey = `ticket_created:${createdId}`;
        const confirmSend = await dispatchSend(
          {
            type: "send_text",
            text: emailSent
              ? ticketCreatedWithEmailText(firstName, confirmCode)
              : ticketCreatedWithoutEmailText(firstName, confirmCode),
            promptKey: confirmKey,
          },
          options.deps,
          createdId,
        );
        if (confirmSend.retryableFailure) retryableFailure = true;
      }
      continue;
    }

    if (effect.type === "notify_help_inbound" && ticketId) {
      const ticket = await loadCreatedTicket(ticketId, options.deps.loadTicket);
      if (!ticket) continue;
      const claim = await options.deps.store.claimEmailDelivery({
        ticketId,
        conversationId: options.deps.conversationId,
        purpose: "instagram-inbound-notify",
        idempotencyKey: `email:ig-inbound:${ticketId}:${options.inboundMessageId}`,
      });
      if (claim.outcome !== "claimed") continue;
      const mailed = await sendInstagramInboundHelpNotification({
        ticket,
        messagePreview: options.inboundText,
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

  return { ticketId, ticketCode, retryableFailure };
}

export async function retryFailedInstagramOutbounds(
  deps: InstagramEffectDeps,
): Promise<{ retryableFailure: boolean }> {
  const failed = await deps.store.listFailedOutbounds(deps.conversationId);
  let retryableFailure = false;
  for (const row of failed) {
    const result = await sendInstagramText({
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
