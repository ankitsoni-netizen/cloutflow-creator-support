import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/tickets/resolution-outbox/drain/route";
import {
  handleTicketResolutionOutboxDrain,
} from "@/lib/tickets/resolution-outbox";
import type { SupabaseClient } from "@supabase/supabase-js";

const DRAIN_SECRET = "resolution-outbox-test-secret";
const DRAIN_ENV = { TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET: DRAIN_SECRET };

function emptySupabase(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        in: () => ({
          or: () => ({
            lt: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: { outcome: "skipped" }, error: null }),
  } as unknown as SupabaseClient;
}

describe("ticket resolution outbox drain endpoint", () => {
  it("rejects missing authorization with 401", async () => {
    const result = await handleTicketResolutionOutboxDrain({
      authorization: null,
      env: DRAIN_ENV,
      deps: { supabase: emptySupabase() },
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
  });

  it("rejects the wrong bearer secret with 401", async () => {
    const result = await handleTicketResolutionOutboxDrain({
      authorization: "Bearer wrong-secret",
      env: DRAIN_ENV,
      deps: { supabase: emptySupabase() },
    });
    expect(result.status).toBe(401);
  });

  it("returns aggregate counts when authorized", async () => {
    const result = await handleTicketResolutionOutboxDrain({
      authorization: `Bearer ${DRAIN_SECRET}`,
      env: DRAIN_ENV,
      deps: { supabase: emptySupabase() },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      claimed: 0,
      sent: 0,
      retryable: 0,
      terminal: 0,
    });
  });

  it("exposes a node runtime POST handler", () => {
    expect(typeof POST).toBe("function");
    const request = new NextRequest(
      "http://localhost:3000/api/internal/tickets/resolution-outbox/drain",
      { method: "POST" },
    );
    expect(request.method).toBe("POST");
  });
});
