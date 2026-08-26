import "server-only";

import { verifyInstagramOutboxDrainAuth } from "@/lib/meta/instagram-outbox-auth";
import {
  drainDueInstagramOutbox,
  emptyInstagramOutboxDrainCounts,
  INSTAGRAM_OUTBOX_DRAIN_DEADLINE_MS,
  INSTAGRAM_OUTBOX_GRAPH_BUDGET_MS,
  type DrainClock,
  type InstagramOutboxDrainCounts,
} from "@/lib/meta/instagram-outbox";
import { drainDueInstagramEmails } from "@/lib/meta/instagram-email-outbox";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import type { InstagramSendDeps } from "@/lib/meta/instagram-send";
import type { DbTicket } from "@/lib/tickets/types";

export type InstagramOutboxDrainResponse = InstagramOutboxDrainCounts & {
  email: InstagramOutboxDrainCounts;
};

export type HandleInstagramOutboxDrainInput = {
  authorization: string | null;
  env?: Record<string, string | undefined>;
  store?: InstagramIngestStore;
  sendDeps?: InstagramSendDeps;
  now?: Date;
  clock?: DrainClock;
  loadTicket?: (id: string) => Promise<DbTicket | null>;
};

export function unauthorizedInstagramOutboxDrainBody(): { error: string } {
  return { error: "unauthorized" };
}

/**
 * Server-only Instagram outbox drain. Auth is timing-safe Bearer comparison
 * against INSTAGRAM_OUTBOX_DRAIN_SECRET. Response is aggregate counts only.
 */
export async function handleInstagramOutboxDrain(
  input: HandleInstagramOutboxDrainInput,
): Promise<
  | { status: 401; body: { error: string } }
  | { status: 200; body: InstagramOutboxDrainResponse }
> {
  if (!verifyInstagramOutboxDrainAuth(input.authorization, input.env)) {
    return { status: 401, body: unauthorizedInstagramOutboxDrainBody() };
  }

  const store = input.store ?? createAdminInstagramStore();
  const clock = input.clock ?? { nowMs: () => Date.now() };
  const started = clock.nowMs();
  const instagram = await drainDueInstagramOutbox({
    store,
    sendDeps: input.sendDeps,
    now: input.now,
    deadlineAtMs: started + INSTAGRAM_OUTBOX_GRAPH_BUDGET_MS,
    clock,
  });
  let email = emptyInstagramOutboxDrainCounts();
  try {
    email = await drainDueInstagramEmails({
      store,
      now: input.now,
      loadTicket: input.loadTicket,
      deadlineAtMs: started + INSTAGRAM_OUTBOX_DRAIN_DEADLINE_MS,
      clock,
    });
  } catch {
    email = emptyInstagramOutboxDrainCounts();
  }

  return {
    status: 200,
    body: {
      claimed: instagram.claimed,
      sent: instagram.sent,
      retryable: instagram.retryable,
      terminal: instagram.terminal,
      email,
    },
  };
}
