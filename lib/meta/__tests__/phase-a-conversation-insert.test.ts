import { describe, expect, it } from "vitest";
import { pinIdentitySchemaPhase } from "@/lib/meta/__tests__/identity-phase-test";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { emptyConversationSnapshot } from "@/lib/meta/conversation-machine";
import { runWithIdentitySchemaPhaseAsync } from "@/lib/meta/identity-schema-phase";
import { createSupabaseInstagramStore } from "@/lib/meta/instagram-store";
import type { SupabaseClient } from "@supabase/supabase-js";

pinIdentitySchemaPhase("c");

const PAGE = "17841400008460000";
const SENDER = "12334";
const CANONICAL = `${PAGE}:${SENDER}`;

function createConversationClient(options: {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
}) {
  const chain = (pending: {
    insert?: Record<string, unknown> | null;
    update?: Record<string, unknown> | null;
  }) => {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      async single() {
        const values = pending.insert ?? {};
        return {
          data: {
            id: "convo-1",
            display_name: values.display_name ?? null,
            ticket_id: null,
            state: values.state ?? "unclassified",
            routing_intent: values.routing_intent ?? "unclassified",
            current_intake_field: null,
            last_prompt_key: null,
            last_activity_at: values.last_activity_at ?? null,
            last_processed_external_message_id: null,
            collected_data: values.collected_data ?? {},
            external_contact_id: values.external_contact_id ?? SENDER,
            external_conversation_id: values.external_conversation_id ?? CANONICAL,
            intake_session_version: 0,
            provider: values.provider ?? null,
            recipient_account_id: values.recipient_account_id ?? null,
            identity_status: values.identity_status ?? null,
          },
          error: null,
        };
      },
      async maybeSingle() {
        return { data: { id: "convo-1" }, error: null };
      },
    };
    return builder;
  };

  return {
    async rpc(name: string, args: Record<string, unknown>) {
      options.rpcs.push({ name, args });
      return {
        data: {
          id: "rpc-convo",
          display_name: args.p_display_name ?? null,
          ticket_id: null,
          state: args.p_state ?? "unclassified",
          routing_intent: "unclassified",
          current_intake_field: null,
          last_prompt_key: null,
          last_activity_at: args.p_last_message_at ?? null,
          last_processed_external_message_id: null,
          collected_data: {},
          external_contact_id: args.p_external_contact_id,
          external_conversation_id: args.p_external_conversation_id,
          intake_session_version: 0,
          provider: args.p_provider,
          recipient_account_id: args.p_recipient_account_id,
          identity_status: "unambiguous",
        },
        error: null,
      };
    },
    from(table: string) {
      if (table !== "channel_conversations") {
        throw new Error(`unexpected table ${table}`);
      }
      const pending: {
        insert?: Record<string, unknown> | null;
        update?: Record<string, unknown> | null;
      } = {};
      return {
        insert(values: Record<string, unknown>) {
          options.inserts.push(values);
          pending.insert = values;
          return chain(pending);
        },
        update(values: Record<string, unknown>) {
          options.updates.push(values);
          pending.update = values;
          return chain(pending);
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("Phase A conversation identity writes", () => {
  it("inserts without provider, recipient_account_id, or identity_status even when ingest supplies them", async () => {
    await runWithIdentitySchemaPhaseAsync("a", async () => {
      const inserts: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
      const store = createSupabaseInstagramStore(
        createConversationClient({ inserts, updates, rpcs }),
      );

      const inserted = await store.insertConversation({
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        recipientAccountId: PAGE,
        externalConversationId: CANONICAL,
        externalContactId: SENDER,
        displayName: "riya_creates",
        lastMessageAt: "2026-09-03T10:00:00.000Z",
        state: "unclassified",
      });

      expect(inserted.outcome).toBe("inserted");
      expect(rpcs).toHaveLength(0);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).not.toHaveProperty("provider");
      expect(inserts[0]).not.toHaveProperty("recipient_account_id");
      expect(inserts[0]).not.toHaveProperty("identity_status");
      expect(inserts[0]?.external_contact_id).toBe(SENDER);
      expect(inserts[0]?.external_conversation_id).toBe(CANONICAL);
      if (inserted.outcome === "inserted") {
        expect(inserted.row.provider).toBeNull();
        expect(inserted.row.recipientAccountId).toBeNull();
        expect(inserted.row.identityStatus).toBeNull();
      }
    });
  });

  it("Phase C insert uses the identity RPC instead of a Phase A column omit", async () => {
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
    const store = createSupabaseInstagramStore(
      createConversationClient({ inserts, updates, rpcs }),
    );

    const inserted = await store.insertConversation({
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      recipientAccountId: PAGE,
      externalConversationId: CANONICAL,
      externalContactId: SENDER,
      displayName: "riya_creates",
      lastMessageAt: "2026-09-03T10:00:00.000Z",
      state: "unclassified",
    });

    expect(inserted.outcome).toBe("inserted");
    expect(inserts).toHaveLength(0);
    expect(rpcs).toEqual([
      expect.objectContaining({
        name: "upsert_channel_conversation_identity",
        args: expect.objectContaining({
          p_provider: META_INSTAGRAM_PROVIDER,
          p_recipient_account_id: PAGE,
          p_external_contact_id: SENDER,
          p_external_conversation_id: CANONICAL,
        }),
      }),
    ]);
    if (inserted.outcome === "inserted") {
      expect(inserted.row.provider).toBe(META_INSTAGRAM_PROVIDER);
      expect(inserted.row.identityStatus).toBe("unambiguous");
    }
  });

  it("snapshot updates never backfill provider or identity_status", async () => {
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
    const store = createSupabaseInstagramStore(
      createConversationClient({ inserts, updates, rpcs }),
    );
    const snapshot = emptyConversationSnapshot({
      state: "awaiting_post_completion",
      lastProcessedExternalMessageId: "mid.1",
    });

    await store.saveConversationSnapshot(
      "convo-1",
      snapshot,
      "2026-09-03T10:00:00.000Z",
      "riya_creates",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("provider");
    expect(updates[0]).not.toHaveProperty("recipient_account_id");
    expect(updates[0]).not.toHaveProperty("identity_status");
  });
});
