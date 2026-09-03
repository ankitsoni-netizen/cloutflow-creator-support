import {
  collectedFromRecord,
  collectedToRecord,
} from "@/lib/meta/intake-collected";
import { snapshotFromConversationRow } from "@/lib/meta/instagram-store";
import type { ConversationSnapshot } from "@/lib/meta/conversation-machine";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type ConversationPersistence = {
  getConversation: (
    channel: "instagram" | "whatsapp",
    externalConversationId: string,
    lookup?: {
      externalContactId?: string | null;
      provider?: string | null;
      recipientAccountId?: string | null;
    },
  ) => Promise<unknown>;
  saveConversationSnapshot: (
    id: string,
    snapshot: ConversationSnapshot,
    lastMessageAt: string,
    displayName: string | null,
  ) => Promise<unknown>;
};

type ReservableStore = ConversationPersistence & {
  reserveOutboundAndSnapshot: (input: {
    snapshot: ConversationSnapshot;
  }) => Promise<unknown>;
};

type WatiReservableStore = ConversationPersistence & {
  reserveWatiOutboundAndSnapshot: (input: {
    snapshot: ConversationSnapshot;
  }) => Promise<unknown>;
};

function hasOutboundReserve(store: ConversationPersistence): store is ReservableStore {
  return (
    "reserveOutboundAndSnapshot" in store &&
    typeof (store as ReservableStore).reserveOutboundAndSnapshot === "function"
  );
}

function hasWatiOutboundReserve(
  store: ConversationPersistence,
): store is WatiReservableStore {
  return (
    "reserveWatiOutboundAndSnapshot" in store &&
    typeof (store as WatiReservableStore).reserveWatiOutboundAndSnapshot ===
      "function"
  );
}

/**
 * Production-like persistence: JSON clone plus collected_data camelCase round-trip.
 * Reloading after each inbound must not depend on in-memory object identity.
 */
export function withDurableConversationPersistence<T extends ConversationPersistence>(
  store: T,
): T {
  const save = store.saveConversationSnapshot.bind(store);
  store.saveConversationSnapshot = async (
    id,
    snapshot,
    lastMessageAt,
    displayName,
  ) => {
    const collected = collectedFromRecord(
      cloneJson(collectedToRecord(snapshot.collected)),
    );
    return save(
      id,
      cloneJson({ ...snapshot, collected }),
      lastMessageAt,
      displayName,
    );
  };

  const get = store.getConversation.bind(store);
  store.getConversation = async (channel, externalConversationId, lookup) => {
    const row = await get(channel, externalConversationId, lookup);
    if (!row || typeof row !== "object" || "errorCode" in row) {
      return row;
    }
    const cloned = cloneJson(row) as Record<string, unknown>;
    cloned.collectedData = collectedToRecord(
      collectedFromRecord(cloned.collectedData),
    );
    return cloned;
  };

  if (hasOutboundReserve(store)) {
    const reserve = store.reserveOutboundAndSnapshot.bind(store);
    store.reserveOutboundAndSnapshot = async (input) => {
      const collected = collectedFromRecord(
        cloneJson(collectedToRecord(input.snapshot.collected)),
      );
      return reserve({
        ...input,
        snapshot: cloneJson({ ...input.snapshot, collected }),
      });
    };
  }

  if (hasWatiOutboundReserve(store)) {
    const reserve = store.reserveWatiOutboundAndSnapshot.bind(store);
    store.reserveWatiOutboundAndSnapshot = async (input) => {
      const collected = collectedFromRecord(
        cloneJson(collectedToRecord(input.snapshot.collected)),
      );
      return reserve({
        ...input,
        snapshot: cloneJson({ ...input.snapshot, collected }),
      });
    };
  }

  return store;
}

export function identityLookupFromEvent(event: {
  externalContactId?: string | null;
  recipientAccountId?: string | null;
  phoneNumberId?: string | null;
  provider?: string | null;
}) {
  return {
    externalContactId: event.externalContactId,
    provider: event.provider,
    recipientAccountId: event.recipientAccountId ?? event.phoneNumberId,
  };
}

export async function reloadConversationSnapshot(
  store: ConversationPersistence,
  channel: "instagram" | "whatsapp",
  externalConversationId: string,
  lookup?: {
    externalContactId?: string | null;
    provider?: string | null;
    recipientAccountId?: string | null;
  },
): Promise<ConversationSnapshot> {
  const row = await store.getConversation(
    channel,
    externalConversationId,
    lookup,
  );
  if (!row || typeof row !== "object" || "errorCode" in row) {
    throw new Error("conversation_reload_failed");
  }
  const record = row as {
    state: string;
    routingIntent: string | null;
    currentIntakeField: string | null;
    lastPromptKey: string | null;
    lastActivityAt: string | null;
    lastProcessedExternalMessageId: string | null;
    collectedData: Record<string, unknown>;
    ticketId: string | null;
    displayName: string | null;
    intakeSessionVersion: number;
    id: string;
    externalContactId: string | null;
  };
  return snapshotFromConversationRow(record, null, record.displayName);
}
