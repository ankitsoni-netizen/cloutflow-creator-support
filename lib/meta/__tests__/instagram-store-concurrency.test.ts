import { describe, expect, it } from "vitest";
import { createSupabaseInstagramStore } from "@/lib/meta/instagram-store";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("instagram store round-trip reduction", () => {
  it("runs independent active-ticket lookups concurrently", async () => {
    const started: string[] = [];
    const inflight = { n: 0, max: 0 };

    function query(label: string) {
      started.push(label);
      inflight.n += 1;
      inflight.max = Math.max(inflight.max, inflight.n);
      return {
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
        async maybeSingle() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          inflight.n -= 1;
          return { data: null, error: null };
        },
      };
    }

    const supabase = {
      from(table: string) {
        if (table === "tickets") {
          return started.length === 0 ? query("conversation") : query("contact");
        }
        return query(table);
      },
    } as unknown as SupabaseClient;

    const store = createSupabaseInstagramStore(supabase);
    const found = await store.findActiveInstagramTicket({
      externalConversationId: "1",
      externalContactId: "1",
    });
    expect(found).toBeNull();
    expect(started).toEqual(["conversation", "contact"]);
    expect(inflight.max).toBeGreaterThanOrEqual(2);
  });
});
