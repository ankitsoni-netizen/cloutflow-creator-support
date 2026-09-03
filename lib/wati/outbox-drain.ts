import "server-only";

import { verifyWatiOutboxDrainAuth } from "@/lib/wati/outbox-auth";
import {
  drainDueWatiOutbox,
  emptyWatiOutboxDrainCounts,
  WATI_OUTBOX_SEND_BUDGET_MS,
  type DrainClock,
  type WatiOutboxDrainCounts,
} from "@/lib/wati/outbox";
import { createAdminInstagramStore } from "@/lib/meta/instagram-store";
import type { InstagramIngestStore } from "@/lib/meta/instagram-store";
import type { WhatsAppProviderSendDeps } from "@/lib/meta/whatsapp-provider";

export type HandleWatiOutboxDrainInput = {
  authorization: string | null;
  env?: Record<string, string | undefined>;
  store?: InstagramIngestStore;
  sendDeps?: WhatsAppProviderSendDeps;
  now?: Date;
  clock?: DrainClock;
};

export function unauthorizedWatiOutboxDrainBody(): { error: string } {
  return { error: "unauthorized" };
}

/**
 * Server-only WATI outbox drain. Auth is timing-safe Bearer comparison
 * against WATI_OUTBOX_DRAIN_SECRET. Response is aggregate counts only.
 * Never logs creator data or outbound payloads.
 */
export async function handleWatiOutboxDrain(
  input: HandleWatiOutboxDrainInput,
): Promise<
  | { status: 401; body: { error: string } }
  | { status: 200; body: WatiOutboxDrainCounts }
> {
  if (!verifyWatiOutboxDrainAuth(input.authorization, input.env)) {
    return { status: 401, body: unauthorizedWatiOutboxDrainBody() };
  }

  const store = input.store ?? createAdminInstagramStore();
  const clock = input.clock ?? { nowMs: () => Date.now() };
  const started = clock.nowMs();
  const wati = await drainDueWatiOutbox({
    store,
    sendDeps: input.sendDeps,
    now: input.now,
    deadlineAtMs: started + WATI_OUTBOX_SEND_BUDGET_MS,
    clock,
  });

  return {
    status: 200,
    body: wati ?? emptyWatiOutboxDrainCounts(),
  };
}
