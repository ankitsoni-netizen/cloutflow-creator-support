import { afterEach, describe, expect, it, vi } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import {
  IDENTITY_AMBIGUOUS,
  instagramExternalConversationId,
} from "@/lib/meta/conversation-identity";
import { ingestInstagramInboundMessage } from "@/lib/meta/instagram-ingest";
import {
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
} from "@/lib/meta/instagram-persona-copy";
import * as instagramSend from "@/lib/meta/instagram-send";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import { runWithIdentitySchemaPhaseAsync } from "@/lib/meta/identity-schema-phase";
import { createMemoryChatbotStore } from "@/lib/meta/__tests__/chatbot-memory-store";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import {
  identityLookupFromEvent,
  reloadConversationSnapshot,
  withDurableConversationPersistence,
} from "@/lib/meta/__tests__/durable-conversation";
import { instagramTextPayload } from "@/lib/meta/__tests__/fixtures";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";

const PAGE = "17841400008460000";
const SENDER_A = "11111";
const SENDER_B = "22222";
const CONTEXT = { webhookPayload: { object: "instagram" } };

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mockSends() {
  vi.spyOn(instagramSend, "sendInstagramQuickReplies").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.prompt",
    recipientId: SENDER_A,
  });
  vi.spyOn(instagramSend, "sendInstagramText").mockResolvedValue({
    ok: true,
    metaMessageId: "mid.text",
    recipientId: SENDER_A,
  });
}

function eventFromPayload(payload: unknown): NormalizedMetaInboundText {
  const events = normalizeMetaWebhookPayload(payload).filter(
    (item) => item.channel === "instagram",
  );
  expect(events).toHaveLength(1);
  return events[0]!;
}

function personaEvent(senderId: string, mid: string): NormalizedMetaInboundText {
  return eventFromPayload(
    instagramTextPayload({
      senderId,
      recipientId: PAGE,
      mid,
      text: PERSONA_CREATOR_TITLE,
      quickReplyPayload: PERSONA_CREATOR_PAYLOAD,
    }),
  );
}

function canonicalAwaitingPersona(senderId: string, id: string) {
  return {
    id,
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    recipientAccountId: PAGE,
    externalContactId: senderId,
    externalConversationId: instagramExternalConversationId(PAGE, senderId),
    identityStatus: "unambiguous",
    state: "awaiting_persona",
    ticketId: null,
    collectedData: {},
    routingIntent: "unclassified",
    lastProcessedExternalMessageId: "mid.hi",
    intakeSessionVersion: 0,
  };
}

function legacyCompleted(senderId: string, id: string, identityStatus: string) {
  return {
    id,
    channel: "instagram",
    provider: META_INSTAGRAM_PROVIDER,
    recipientAccountId: PAGE,
    externalContactId: senderId,
    externalConversationId: senderId,
    identityStatus,
    state: "completed",
    ticketId: null,
    collectedData: { historical: true },
    routingIntent: "unclassified",
    lastProcessedExternalMessageId: "mid.old",
    intakeSessionVersion: 0,
  };
}

function phaseCStore() {
  return withDurableConversationPersistence(
    createMemoryChatbotStore("instagram", { identitySchema: "expanded" }),
  );
}

pinIdentitySchemaPhase("c");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Phase C canonical-versus-legacy conversation precedence", () => {
  it("selects canonical unambiguous awaiting_persona and leaves legacy ambiguous completed unchanged", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        canonicalAwaitingPersona(SENDER_A, "convo-canonical-a"),
        legacyCompleted(SENDER_A, "convo-legacy-a", "ambiguous"),
      );
      const legacyBefore = cloneJson(
        store.conversations.find((row) => row.id === "convo-legacy-a"),
      );
      const persona = personaEvent(SENDER_A, "mid.persona.a");
      const result = await ingestInstagramInboundMessage(persona, store, CONTEXT);
      expect(result.outcome).toBe("stored");
      const snapshot = await reloadConversationSnapshot(
        store,
        "instagram",
        persona.externalConversationId,
        identityLookupFromEvent(persona),
      );
      expect(snapshot.state).toBe("awaiting_creator_reason");
      expect(snapshot.collected.igPersona).toBe("creator");
      expect(store.conversations.find((row) => row.id === "convo-canonical-a")?.state).toBe(
        "awaiting_creator_reason",
      );
      expect(store.conversations.find((row) => row.id === "convo-legacy-a")).toEqual(
        legacyBefore,
      );
      expect(store.tickets).toHaveLength(0);
      expect(
        store.messages.filter((row) => row.direction === "outbound"),
      ).toHaveLength(1);
    });
  });

  it("keeps two creators on their own canonical rows with this two-row pattern", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        canonicalAwaitingPersona(SENDER_A, "convo-canonical-a"),
        legacyCompleted(SENDER_A, "convo-legacy-a", "ambiguous"),
        canonicalAwaitingPersona(SENDER_B, "convo-canonical-b"),
        legacyCompleted(SENDER_B, "convo-legacy-b", "ambiguous"),
      );
      const legacyA = cloneJson(
        store.conversations.find((row) => row.id === "convo-legacy-a"),
      );
      const legacyB = cloneJson(
        store.conversations.find((row) => row.id === "convo-legacy-b"),
      );
      await ingestInstagramInboundMessage(
        personaEvent(SENDER_A, "mid.persona.a"),
        store,
        CONTEXT,
      );
      await ingestInstagramInboundMessage(
        personaEvent(SENDER_B, "mid.persona.b"),
        store,
        CONTEXT,
      );
      expect(store.conversations.find((row) => row.id === "convo-canonical-a")).toMatchObject({
        state: "awaiting_creator_reason",
        externalContactId: SENDER_A,
      });
      expect(store.conversations.find((row) => row.id === "convo-canonical-b")).toMatchObject({
        state: "awaiting_creator_reason",
        externalContactId: SENDER_B,
      });
      expect(store.conversations.find((row) => row.id === "convo-legacy-a")).toEqual(legacyA);
      expect(store.conversations.find((row) => row.id === "convo-legacy-b")).toEqual(legacyB);
      expect(
        store.messages.filter(
          (row) =>
            row.direction === "outbound" && row.recipientExternalId === SENDER_A,
        ),
      ).toHaveLength(1);
      expect(
        store.messages.filter(
          (row) =>
            row.direction === "outbound" && row.recipientExternalId === SENDER_B,
        ),
      ).toHaveLength(1);
      expect(store.tickets).toHaveLength(0);
    });
  });

  it("selects canonical unambiguous and leaves a quarantined legacy row untouched", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        canonicalAwaitingPersona(SENDER_A, "convo-canonical-a"),
        legacyCompleted(SENDER_A, "convo-legacy-a", "quarantined"),
      );
      const legacyBefore = cloneJson(
        store.conversations.find((row) => row.id === "convo-legacy-a"),
      );
      const result = await ingestInstagramInboundMessage(
        personaEvent(SENDER_A, "mid.persona.q"),
        store,
        CONTEXT,
      );
      expect(result.outcome).toBe("stored");
      expect(store.conversations.find((row) => row.id === "convo-legacy-a")).toEqual(
        legacyBefore,
      );
      expect(store.conversations.find((row) => row.id === "convo-canonical-a")?.state).toBe(
        "awaiting_creator_reason",
      );
    });
  });

  it("fails closed when canonical and legacy are both ambiguous", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        {
          ...canonicalAwaitingPersona(SENDER_A, "convo-canonical-a"),
          identityStatus: "ambiguous",
        },
        legacyCompleted(SENDER_A, "convo-legacy-a", "ambiguous"),
      );
      const before = cloneJson(store.conversations);
      const result = await ingestInstagramInboundMessage(
        personaEvent(SENDER_A, "mid.persona.both"),
        store,
        CONTEXT,
      );
      expect(result).toEqual({
        outcome: "failed",
        errorCode: IDENTITY_AMBIGUOUS,
      });
      expect(store.conversations).toEqual(before);
      expect(store.tickets).toHaveLength(0);
      expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
    });
  });

  it("fails closed when two eligible canonical unambiguous rows exist", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        canonicalAwaitingPersona(SENDER_A, "convo-canonical-a"),
        canonicalAwaitingPersona(SENDER_A, "convo-canonical-a2"),
      );
      const before = cloneJson(store.conversations);
      const result = await ingestInstagramInboundMessage(
        personaEvent(SENDER_A, "mid.persona.dup"),
        store,
        CONTEXT,
      );
      expect(result).toEqual({
        outcome: "failed",
        errorCode: IDENTITY_AMBIGUOUS,
      });
      expect(store.conversations).toEqual(before);
      expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
    });
  });

  it("uses exactly one unambiguous legacy owner when no canonical row exists", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push({
        ...legacyCompleted(SENDER_A, "convo-legacy-a", "unambiguous"),
        state: "awaiting_persona",
        lastProcessedExternalMessageId: "mid.hi",
      });
      const result = await ingestInstagramInboundMessage(
        personaEvent(SENDER_A, "mid.persona.legacy"),
        store,
        CONTEXT,
      );
      expect(result.outcome).toBe("stored");
      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0]).toMatchObject({
        id: "convo-legacy-a",
        state: "awaiting_creator_reason",
        identityStatus: "unambiguous",
      });
    });
  });

  it("fails closed when only an ambiguous legacy row exists", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        legacyCompleted(SENDER_A, "convo-legacy-a", "ambiguous"),
      );
      const before = cloneJson(store.conversations);
      const result = await ingestInstagramInboundMessage(
        personaEvent(SENDER_A, "mid.persona.only-legacy"),
        store,
        CONTEXT,
      );
      expect(result).toEqual({
        outcome: "failed",
        errorCode: IDENTITY_AMBIGUOUS,
      });
      expect(store.conversations).toEqual(before);
      expect(instagramSend.sendInstagramQuickReplies).not.toHaveBeenCalled();
    });
  });

  it("reclaims a failed identity event once the canonical row is eligible beside an ineligible legacy row", async () => {
    await runWithIdentitySchemaPhaseAsync("c", async () => {
      mockSends();
      const store = phaseCStore();
      store.conversations.push(
        canonicalAwaitingPersona(SENDER_A, "convo-canonical-a"),
        legacyCompleted(SENDER_A, "convo-legacy-a", "ambiguous"),
      );
      store.events.push({
        id: "evt-failed",
        provider: META_INSTAGRAM_PROVIDER,
        externalEventId: "mid.persona.reclaim",
        processingStatus: "failed",
        errorCode: IDENTITY_AMBIGUOUS,
        processedAt: null,
      });
      const legacyBefore = cloneJson(
        store.conversations.find((row) => row.id === "convo-legacy-a"),
      );
      const persona = personaEvent(SENDER_A, "mid.persona.reclaim");
      const [first, second] = await Promise.all([
        ingestInstagramInboundMessage(persona, store, CONTEXT),
        ingestInstagramInboundMessage(persona, store, CONTEXT),
      ]);
      const outcomes = [first.outcome, second.outcome].sort();
      expect(outcomes).toEqual(["duplicate", "stored"]);
      expect(store.events[0]?.processingStatus).toBe("completed");
      expect(store.conversations.find((row) => row.id === "convo-legacy-a")).toEqual(
        legacyBefore,
      );
      expect(store.conversations.find((row) => row.id === "convo-canonical-a")?.state).toBe(
        "awaiting_creator_reason",
      );
      expect(
        store.messages.filter((row) => row.direction === "outbound"),
      ).toHaveLength(1);
    });
  });
});
