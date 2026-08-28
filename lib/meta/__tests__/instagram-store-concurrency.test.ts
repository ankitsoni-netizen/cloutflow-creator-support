import { describe, expect, it } from "vitest";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { createSupabaseInstagramStore } from "@/lib/meta/instagram-store";
import type { SupabaseClient } from "@supabase/supabase-js";

function createWebhookEventsClient(rows: Array<Record<string, unknown>>) {
  function matches(
    row: Record<string, unknown>,
    filters: Array<{ kind: string; column: string; value: unknown }>,
  ) {
    return filters.every((filter) => {
      const current = row[filter.column];
      if (filter.kind === "eq") return current === filter.value;
      if (filter.kind === "is") return current == null && filter.value == null;
      if (filter.kind === "lt") {
        return (
          typeof current === "string" &&
          typeof filter.value === "string" &&
          current < filter.value
        );
      }
      return false;
    });
  }

  function query(table: string) {
    if (table !== "webhook_events") {
      throw new Error(`unexpected table ${table}`);
    }
    const filters: Array<{ kind: string; column: string; value: unknown }> = [];
    let pendingInsert: Record<string, unknown> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    const builder = {
      insert(values: Record<string, unknown>) {
        pendingInsert = values;
        return this;
      },
      update(values: Record<string, unknown>) {
        pendingUpdate = values;
        return this;
      },
      select() {
        return this;
      },
      eq(column: string, value: unknown) {
        filters.push({ kind: "eq", column, value });
        return this;
      },
      is(column: string, value: unknown) {
        filters.push({ kind: "is", column, value });
        return this;
      },
      lt(column: string, value: unknown) {
        filters.push({ kind: "lt", column, value });
        return this;
      },
      async single() {
        if (pendingInsert) {
          const inserted = pendingInsert;
          const duplicate = rows.find(
            (row) =>
              row.provider === inserted.provider &&
              row.external_event_id === inserted.external_event_id,
          );
          if (duplicate) {
            return { data: null, error: { code: "23505" } };
          }
          const id = `evt-${rows.length + 1}`;
          rows.push({ id, ...inserted });
          return { data: { id }, error: null };
        }
        return { data: null, error: { message: "missing insert" } };
      },
      async maybeSingle() {
        const found = rows.find((row) => matches(row, filters));
        if (pendingUpdate) {
          if (!found) return { data: null, error: null };
          Object.assign(found, pendingUpdate);
          return { data: { id: found.id }, error: null };
        }
        if (!found) return { data: null, error: null };
        return { data: found, error: null };
      },
    };
    return builder;
  }

  return {
    from(table: string) {
      return query(table);
    },
  } as unknown as SupabaseClient;
}

function ticketsQuery(onStart?: () => void) {
  onStart?.();
  const result = { data: [] as unknown[], error: null };
  const query = {
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    then(
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

describe("instagram store identity-scoped ticket lookup", () => {
  it("looks up active tickets by sender identity, not conversation id alone", async () => {
    const started: string[] = [];
    const supabase = {
      from(table: string) {
        if (table === "tickets") {
          return ticketsQuery(() => started.push("contact"));
        }
        return ticketsQuery();
      },
    } as unknown as SupabaseClient;

    const store = createSupabaseInstagramStore(supabase);
    const found = await store.findActiveInstagramTicket({
      externalConversationId: "page:1",
      externalContactId: "1",
      recipientAccountId: "page",
    });
    expect(found).toBeNull();
    expect(started).toEqual(["contact"]);
  });

  it("fails closed when sender identity is missing", async () => {
    const store = createSupabaseInstagramStore({
      from() {
        throw new Error("tickets must not be queried without identity");
      },
    } as unknown as SupabaseClient);
    const found = await store.findActiveInstagramTicket({
      externalConversationId: "",
      externalContactId: "",
    });
    expect(found).toEqual({ errorCode: "identity_missing" });
  });
});

describe("instagram webhook event reclaim", () => {
  it("atomically reclaims a failed identity_ambiguous row once", async () => {
    const rows: Array<Record<string, unknown>> = [
      {
        id: "evt-1",
        provider: META_INSTAGRAM_PROVIDER,
        external_event_id: "mid.persona",
        processing_status: "failed",
        processed_at: null,
        error_code: "identity_ambiguous",
      },
    ];
    const store = createSupabaseInstagramStore(createWebhookEventsClient(rows));
    const input = {
      provider: META_INSTAGRAM_PROVIDER,
      externalEventId: "mid.persona",
      payload: {},
      payloadHash: null,
    };
    const [first, second] = await Promise.all([
      store.claimWebhookEvent(input),
      store.claimWebhookEvent(input),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["already_processed", "retry"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processing_status).toBe("processing");
  });

  it("does not reclaim a completed event", async () => {
    const rows: Array<Record<string, unknown>> = [
      {
        id: "evt-1",
        provider: META_INSTAGRAM_PROVIDER,
        external_event_id: "mid.hi",
        processing_status: "completed",
        processed_at: "2026-08-28T16:00:00.000Z",
      },
    ];
    const store = createSupabaseInstagramStore(createWebhookEventsClient(rows));
    const result = await store.claimWebhookEvent({
      provider: META_INSTAGRAM_PROVIDER,
      externalEventId: "mid.hi",
      payload: {},
      payloadHash: null,
    });
    expect(result).toEqual({ outcome: "already_processed" });
    expect(rows[0]?.processing_status).toBe("completed");
  });
});
