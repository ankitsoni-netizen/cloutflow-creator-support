import { describe, expect, it } from "vitest";
import { lookupInstagramUsername } from "@/lib/meta/instagram-username";

describe("lookupInstagramUsername", () => {
  it("returns the username when Graph allows it", async () => {
    const username = await lookupInstagramUsername("12334", {
      env: {
        META_GRAPH_API_VERSION: "v23.0",
        META_IG_ACCESS_TOKEN: "token",
        META_IG_ACCOUNT_ID: "17841400008460000",
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ username: "riya_creates" }), { status: 200 }),
    });
    expect(username).toBe("riya_creates");
  });

  it("falls back to null on timeout or permission failure without throwing", async () => {
    await expect(
      lookupInstagramUsername("12334", {
        env: {
          META_GRAPH_API_VERSION: "v23.0",
          META_IG_ACCESS_TOKEN: "token",
          META_IG_ACCOUNT_ID: "17841400008460000",
        },
        fetchImpl: async () => {
          throw new Error("network");
        },
      }),
    ).resolves.toBeNull();
    await expect(
      lookupInstagramUsername("12334", {
        env: {
          META_GRAPH_API_VERSION: "v23.0",
          META_IG_ACCESS_TOKEN: "token",
          META_IG_ACCOUNT_ID: "17841400008460000",
        },
        fetchImpl: async () => new Response("{}", { status: 403 }),
      }),
    ).resolves.toBeNull();
  });
});
