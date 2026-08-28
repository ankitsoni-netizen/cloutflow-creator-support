import { describe, expect, it } from "vitest";
import { createSupabaseInstagramStore } from "@/lib/meta/instagram-store";
import type { SupabaseClient } from "@supabase/supabase-js";

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
