import "server-only";

import {
  INSTAGRAM_GRAPH_BASE,
  resolveInstagramGraphSendConfig,
  type InstagramSendConfig,
  type InstagramSendDeps,
} from "@/lib/meta/instagram-send";
import type { InstagramTimingSession } from "@/lib/meta/timing";

export const INSTAGRAM_SENDER_ACTIONS = [
  "mark_seen",
  "typing_on",
  "typing_off",
] as const;

export type InstagramSenderAction = (typeof INSTAGRAM_SENDER_ACTIONS)[number];

export const INSTAGRAM_SENDER_ACTION_TIMEOUT_MS = 750;

const NUMERIC_ID_PATTERN = /^\d+$/;
const SENDER_ACTION_SET = new Set<string>(INSTAGRAM_SENDER_ACTIONS);

export type InstagramSenderActionResult = {
  ok: boolean;
  errorCode?: string;
};

export type InstagramAttendingSession = {
  recipientId: string;
  sendDeps?: InstagramSendDeps;
  started: boolean;
  done: Promise<void>;
  finishPromise: Promise<void> | null;
  actionStartedAt?: number;
  timing?: InstagramTimingSession;
};

export function isInstagramSenderAction(
  value: string,
): value is InstagramSenderAction {
  return SENDER_ACTION_SET.has(value);
}

export function instagramSenderActionUrl(config: InstagramSendConfig): string {
  return `${INSTAGRAM_GRAPH_BASE}/${config.graphVersion}/me/messages`;
}

function isNumericRecipient(recipientId: string): boolean {
  return NUMERIC_ID_PATTERN.test(recipientId.trim());
}

function createAttendingSession(input: {
  recipientId: string;
  sendDeps?: InstagramSendDeps;
  done: Promise<void>;
  timing?: InstagramTimingSession;
  actionStartedAt?: number;
}): InstagramAttendingSession {
  return {
    recipientId: input.recipientId,
    sendDeps: input.sendDeps,
    started: true,
    done: input.done,
    finishPromise: null,
    timing: input.timing,
    actionStartedAt: input.actionStartedAt,
  };
}

/**
 * Best-effort Instagram sender action (mark_seen / typing_on / typing_off).
 * One attempt, 750ms abort, never retries. Failure must not fail ingest or Graph
 * message delivery. Never logs token, IGSID, payload, or message content.
 */
export async function sendInstagramSenderAction(options: {
  recipientId: string;
  action: string;
  deps?: InstagramSendDeps;
  config?: InstagramSendConfig | null;
}): Promise<InstagramSenderActionResult> {
  if (!isInstagramSenderAction(options.action)) {
    return { ok: false, errorCode: "invalid_sender_action" };
  }
  const recipientId = options.recipientId.trim();
  if (!isNumericRecipient(recipientId)) {
    return { ok: false, errorCode: "invalid_recipient" };
  }
  const config =
    options.config ?? resolveInstagramGraphSendConfig(options.deps ?? {});
  if (!config) {
    return { ok: false, errorCode: "instagram_send_not_configured" };
  }

  const fetchImpl = options.deps?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    INSTAGRAM_SENDER_ACTION_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(instagramSenderActionUrl(config), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        sender_action: options.action,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, errorCode: `http_${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, errorCode: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

export function startInstagramAttendingIndicators(options: {
  recipientId: string;
  deps?: InstagramSendDeps;
  config?: InstagramSendConfig | null;
  timing?: InstagramTimingSession;
}): InstagramAttendingSession {
  const actionStartedAt = options.timing?.now();
  const sendDeps: InstagramSendDeps = {
    ...options.deps,
    graphConfig:
      options.config ??
      options.deps?.graphConfig ??
      resolveInstagramGraphSendConfig(options.deps ?? {}),
  };
  const done = Promise.all([
    sendInstagramSenderAction({
      recipientId: options.recipientId,
      action: "mark_seen",
      deps: sendDeps,
      config: options.config,
    }),
    sendInstagramSenderAction({
      recipientId: options.recipientId,
      action: "typing_on",
      deps: sendDeps,
      config: options.config,
    }),
  ]).then(() => undefined);
  return createAttendingSession({
    recipientId: options.recipientId,
    sendDeps,
    done,
    timing: options.timing,
    actionStartedAt,
  });
}

export function startInstagramRetryTyping(options: {
  recipientId: string;
  deps?: InstagramSendDeps;
  timing?: InstagramTimingSession;
}): InstagramAttendingSession {
  const actionStartedAt = options.timing?.now();
  const done = sendInstagramSenderAction({
    recipientId: options.recipientId,
    action: "typing_on",
    deps: options.deps,
  }).then(() => undefined);
  return createAttendingSession({
    recipientId: options.recipientId,
    sendDeps: options.deps,
    done,
    timing: options.timing,
    actionStartedAt,
  });
}

async function runFinishInstagramAttending(
  session: InstagramAttendingSession,
): Promise<void> {
  try {
    await session.done;
    if (session.timing && session.actionStartedAt != null) {
      session.timing.record(
        "instagram_sender_action_ms",
        session.timing.now() - session.actionStartedAt,
      );
    }
  } catch {
    // Best-effort: typing_on/mark_seen must never fail delivery.
  }
  try {
    await sendInstagramSenderAction({
      recipientId: session.recipientId,
      action: "typing_off",
      deps: session.sendDeps,
    });
  } catch {
    // Best-effort.
  }
}

/**
 * Idempotent typing cleanup. Concurrent and repeated calls share one promise
 * and send typing_off exactly once. Never throws into webhook or delivery.
 */
export function finishInstagramAttending(
  session: InstagramAttendingSession | null | undefined,
): Promise<void> {
  if (!session?.started) return Promise.resolve();
  if (!session.finishPromise) {
    session.finishPromise = runFinishInstagramAttending(session).catch(
      () => undefined,
    );
  }
  return session.finishPromise;
}
