import "server-only";

import type { InstagramQuickReply } from "@/lib/meta/conversation-machine";
import {
  sendWhatsAppReplyButtons,
  sendWhatsAppText,
  type WhatsAppSendConfig,
  type WhatsAppSendResult,
} from "@/lib/meta/whatsapp-send";
import {
  resolveWhatsAppProvider,
  WHATSAPP_PROVIDER_NOT_CONFIGURED,
} from "@/lib/wati/config";
import {
  sendWatiInteractiveMessage,
  sendWatiSessionText,
  type WatiSendDeps,
} from "@/lib/wati/send";

export type WhatsAppProviderSendDeps = WatiSendDeps;

function providerNotConfiguredResult(): WhatsAppSendResult {
  return {
    ok: false,
    errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED,
    retryable: false,
    messagingWindowExpired: false,
    httpStatus: null,
  };
}

/**
 * Provider adapter for WhatsApp text sends (fail-closed).
 * - WHATSAPP_PROVIDER=wati → WATI only (no Meta fallback on failure)
 * - WHATSAPP_PROVIDER=meta → Meta Cloud API only
 * - missing/blank/invalid → whatsapp_provider_not_configured (zero network calls)
 */
export async function sendWhatsAppProviderText(options: {
  recipientId: string;
  text: string;
  localMessageId?: string | null;
  deps?: WhatsAppProviderSendDeps;
  metaConfig?: WhatsAppSendConfig | null;
}): Promise<WhatsAppSendResult> {
  const env = options.deps?.env ?? process.env;
  const resolved = resolveWhatsAppProvider(env);
  if (!resolved.ok) {
    return providerNotConfiguredResult();
  }

  if (resolved.provider === "wati") {
    return sendWatiSessionText({
      recipientId: options.recipientId,
      text: options.text,
      deps: options.deps,
    });
  }

  return sendWhatsAppText({
    recipientId: options.recipientId,
    text: options.text,
    deps: options.deps,
    config: options.metaConfig,
  });
}

/**
 * Provider adapter for WhatsApp interactive choices.
 * - WHATSAPP_PROVIDER=wati → one native WATI interactive message (buttons or list)
 *   when the conversation machine supplied quick replies; otherwise WATI text.
 * - WHATSAPP_PROVIDER=meta → Meta Cloud API interactive buttons
 * - missing/blank/invalid → whatsapp_provider_not_configured (zero network calls)
 */
export async function sendWhatsAppProviderReplyButtons(options: {
  recipientId: string;
  text: string;
  quickReplies: InstagramQuickReply[];
  localMessageId?: string | null;
  deps?: WhatsAppProviderSendDeps;
  metaConfig?: WhatsAppSendConfig | null;
}): Promise<WhatsAppSendResult> {
  const env = options.deps?.env ?? process.env;
  const resolved = resolveWhatsAppProvider(env);
  if (!resolved.ok) {
    return providerNotConfiguredResult();
  }

  if (resolved.provider === "wati") {
    if (options.quickReplies.length === 0) {
      return sendWatiSessionText({
        recipientId: options.recipientId,
        text: options.text,
        deps: options.deps,
      });
    }
    return sendWatiInteractiveMessage({
      recipientId: options.recipientId,
      text: options.text,
      quickReplies: options.quickReplies,
      deps: options.deps,
    });
  }

  return sendWhatsAppReplyButtons({
    recipientId: options.recipientId,
    text: options.text,
    quickReplies: options.quickReplies,
    deps: options.deps,
    config: options.metaConfig,
  });
}
