import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWatiChannelScopedTarget,
  messageIdFromWatiV3Body,
  normalizeWatiApiEndpoint,
  sendWatiSessionText,
  WATI_V3_TEXT_PATH,
  watiV3TextMessageUrl,
} from "@/lib/wati/send";

const config = {
  apiEndpoint: "https://live-mt-server.wati.io/tenant123",
  apiToken: "wati-secret-token-value",
  channelPhoneNumber: "17435002445",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WATI v3 send client", () => {
  it("posts to the exact v3 URL with channel-scoped JSON body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          message: {
            id: "507f1f77bcf86cd799439011",
            whatsappMessageId: "wamid.out.wati",
            conversation_id: "685bd235e6119686e693a093",
            event_type: "message",
          },
        }),
        { status: 200 },
      ),
    );

    const result = await sendWatiSessionText({
      recipientId: "8618719149214",
      text: "Hello from CRM",
      localMessageId: "wa:crm:comment-1",
      config,
      deps: { fetchImpl, allowHttpInTests: false },
    });

    expect(result).toEqual({
      ok: true,
      metaMessageId: "wamid.out.wati",
      recipientId: "8618719149214",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(url).toBe(
      `https://live-mt-server.wati.io/tenant123${WATI_V3_TEXT_PATH}`,
    );
    expect(url).not.toContain("?");
    expect(url).not.toContain("messageText");
    expect(url).not.toContain("8618719149214");
    expect(url).not.toContain("Hello");
    expect(url).not.toContain("localMessageId");
    expect(url.toLowerCase()).not.toContain("wati-secret-token-value");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer wati-secret-token-value",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      target: "17435002445:8618719149214",
      text: "Hello from CRM",
    });
    expect(body).not.toHaveProperty("localMessageId");
    expect(JSON.stringify(body)).not.toContain("wati-secret-token-value");
  });

  it("treats HTTP 200 as accepted and stores documented identifiers", async () => {
    const withWamid = await sendWatiSessionText({
      recipientId: "8618719149214",
      text: "Hi",
      config,
      deps: {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              message: { whatsappMessageId: "wamid.accepted" },
            }),
            { status: 200 },
          ),
      },
    });
    expect(withWamid).toEqual({
      ok: true,
      metaMessageId: "wamid.accepted",
      recipientId: "8618719149214",
    });

    const withIdOnly = await sendWatiSessionText({
      recipientId: "8618719149214",
      text: "Hi",
      config,
      deps: {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              message: { id: "507f1f77bcf86cd799439011", event_type: "message" },
            }),
            { status: 200 },
          ),
      },
    });
    expect(withIdOnly).toMatchObject({
      ok: true,
      metaMessageId: "507f1f77bcf86cd799439011",
    });
  });

  it("maps 401/403/429/5xx/network/timeout to sanitized failures", async () => {
    for (const [status, code] of [
      [401, "http_401"],
      [403, "http_403"],
      [429, "http_429"],
      [503, "http_5xx"],
    ] as const) {
      const result = await sendWatiSessionText({
        recipientId: "8618719149214",
        text: "Hi",
        config,
        deps: {
          fetchImpl: async () => new Response("{}", { status }),
        },
      });
      expect(result).toMatchObject({ ok: false, errorCode: code });
    }

    const timed = await sendWatiSessionText({
      recipientId: "8618719149214",
      text: "Hi",
      config,
      deps: {
        fetchImpl: async () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        },
      },
    });
    expect(timed).toMatchObject({ ok: false, errorCode: "send_timeout" });

    const network = await sendWatiSessionText({
      recipientId: "8618719149214",
      text: "Hi",
      config,
      deps: {
        fetchImpl: async () => {
          throw new Error("ECONNRESET");
        },
      },
    });
    expect(network).toMatchObject({ ok: false, errorCode: "network_error" });
  });

  it("rejects non-https endpoints outside tests", () => {
    expect(normalizeWatiApiEndpoint("http://evil.example")).toBeNull();
    expect(normalizeWatiApiEndpoint("https://live-server.wati.io")).not.toBeNull();
    expect(
      normalizeWatiApiEndpoint("http://localhost:3999", {
        allowHttpInTests: true,
      }),
    ).not.toBeNull();
  });

  it("builds a stable v3 URL without recipient or token", () => {
    const url = watiV3TextMessageUrl(config);
    expect(url).toBe(
      `https://live-mt-server.wati.io/tenant123${WATI_V3_TEXT_PATH}`,
    );
    expect(url).not.toContain("wati-secret-token-value");
    expect(url).not.toContain("Bearer");
    expect(url).not.toContain("8618719149214");
  });

  it("builds digits-only channel-scoped targets", () => {
    expect(buildWatiChannelScopedTarget("+17435002445", "+8618719149214")).toBe(
      "17435002445:8618719149214",
    );
    expect(buildWatiChannelScopedTarget("abc", "8618719149214")).toBeNull();
  });

  it("parses documented v3 response identifiers only", () => {
    expect(
      messageIdFromWatiV3Body({
        message: { whatsapp_message_id: "wamid.snake", id: "other" },
      }),
    ).toBe("wamid.snake");
    expect(
      messageIdFromWatiV3Body({
        message: { id: "507f1f77bcf86cd799439011" },
      }),
    ).toBe("507f1f77bcf86cd799439011");
    expect(messageIdFromWatiV3Body({ message: {} })).toBeNull();
  });
});
