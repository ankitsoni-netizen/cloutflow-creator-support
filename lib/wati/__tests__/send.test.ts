import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWatiChannelScopedTarget,
  buildWatiConversationTarget,
  messageIdFromWatiV3Body,
  normalizeWatiApiEndpoint,
  sendWatiInteractiveMessage,
  sendWatiSessionText,
  WATI_V3_INTERACTIVE_PATH,
  WATI_V3_TEXT_PATH,
  watiV3InteractiveMessageUrl,
  watiV3TextMessageUrl,
} from "@/lib/wati/send";
import { INVALID_WATI_CONVERSATION_TARGET_MODE } from "@/lib/wati/config";
import {
  PERSONA_AGENCY_PAYLOAD,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_OTHER_PAYLOAD,
} from "@/lib/meta/instagram-persona-copy";
import {
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
} from "@/lib/meta/routing-copy";

const config = {
  apiEndpoint: "https://live-mt-server.wati.io/101197",
  apiToken: "wati-secret-token-value",
  channelPhoneNumber: "17435002445",
};

const RECIPIENT_ID = "8618719149214";

function sendEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    WATI_API_ENDPOINT: config.apiEndpoint,
    WATI_API_TOKEN: config.apiToken,
    WATI_CHANNEL_PHONE_NUMBER: config.channelPhoneNumber,
    ...overrides,
  };
}

function acceptedResponse() {
  return new Response(
    JSON.stringify({
      message: { whatsappMessageId: "wamid.out.wati" },
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WATI v3 send client", () => {
  it("posts to the origin-only v3 URL with channel-scoped JSON body", async () => {
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
      `https://live-mt-server.wati.io${WATI_V3_TEXT_PATH}`,
    );
    expect(url).not.toContain("?");
    expect(url).not.toContain("101197");
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
    expect(Object.keys(body).sort()).toEqual(["target", "text"]);
    expect(body).not.toHaveProperty("localMessageId");
    expect(JSON.stringify(body)).not.toContain("wati-secret-token-value");
  });

  it("discards tenant path and trailing slash from the configured endpoint", () => {
    expect(
      watiV3TextMessageUrl({
        ...config,
        apiEndpoint: "https://live-mt-server.wati.io/101197/",
      }),
    ).toBe(`https://live-mt-server.wati.io${WATI_V3_TEXT_PATH}`);
    expect(
      watiV3TextMessageUrl({
        ...config,
        apiEndpoint: "https://live-mt-server.wati.io/101197",
      }),
    ).toBe(`https://live-mt-server.wati.io${WATI_V3_TEXT_PATH}`);
  });

  it("preserves dedicated hostnames while discarding legacy path segments", () => {
    const url = watiV3TextMessageUrl({
      ...config,
      apiEndpoint: "https://live-mt-server-example.wati.io/some-legacy-path",
    });
    expect(url).toBe(
      `https://live-mt-server-example.wati.io${WATI_V3_TEXT_PATH}`,
    );
    expect(url).not.toContain("some-legacy-path");
  });

  it("uses the stable v3 path exactly once with no query string", () => {
    const url = watiV3TextMessageUrl(config)!;
    expect(url.endsWith(WATI_V3_TEXT_PATH)).toBe(true);
    expect(url.split(WATI_V3_TEXT_PATH).length - 1).toBe(1);
    expect(url).not.toContain("?");
    expect(new URL(url).search).toBe("");
  });

  it("never puts message, recipient, token, localMessageId or tenant id in the URL", () => {
    const url = watiV3TextMessageUrl(config)!;
    expect(url).not.toContain("101197");
    expect(url).not.toContain("Hello");
    expect(url).not.toContain("8618719149214");
    expect(url).not.toContain("localMessageId");
    expect(url).not.toContain("wati-secret-token-value");
    expect(url).not.toContain("Bearer");
    expect(url).not.toContain("messageText");
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

  it("builds digits-only channel-scoped targets", () => {
    expect(buildWatiChannelScopedTarget("+17435002445", "+8618719149214")).toBe(
      "17435002445:8618719149214",
    );
    expect(buildWatiChannelScopedTarget("abc", "8618719149214")).toBeNull();
  });

  it("builds conversation targets from the shared helper", () => {
    expect(
      buildWatiConversationTarget({
        channelPhoneNumber: "+17435002445",
        recipientWaId: "+8618719149214",
        mode: "channel_recipient",
      }),
    ).toBe("17435002445:8618719149214");
    expect(
      buildWatiConversationTarget({
        channelPhoneNumber: "+17435002445",
        recipientWaId: "+8618719149214",
        mode: "recipient",
      }),
    ).toBe("8618719149214");
    expect(
      buildWatiConversationTarget({
        channelPhoneNumber: "",
        recipientWaId: "8618719149214",
        mode: "recipient",
      }),
    ).toBeNull();
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

describe("WATI v3 interactive send", () => {
  function jsonResponse(status = 200) {
    return new Response(
      JSON.stringify({
        message: { whatsappMessageId: "wamid.interactive.1" },
      }),
      { status },
    );
  }

  it("posts buttons to the origin-only interactive URL without a duplicate text send", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse());
    const result = await sendWatiInteractiveMessage({
      recipientId: "8618719149214",
      text: "Please choose one of the options below so we can route your message correctly.",
      quickReplies: [
        {
          content_type: "text",
          title: "Campaign / Collab",
          payload: ROUTE_COLLABORATION_PAYLOAD,
        },
        {
          content_type: "text",
          title: "Creator Support",
          payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
        },
      ],
      config,
      deps: { fetchImpl },
    });
    expect(result).toEqual({
      ok: true,
      metaMessageId: "wamid.interactive.1",
      recipientId: "8618719149214",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(url).toBe(`https://live-mt-server.wati.io${WATI_V3_INTERACTIVE_PATH}`);
    expect(url).not.toContain(WATI_V3_TEXT_PATH);
    expect(url).not.toContain("101197");
    expect(url).not.toContain("?");
    expect(url).not.toContain("8618719149214");
    expect(url.toLowerCase()).not.toContain("wati-secret-token-value");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer wati-secret-token-value",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      target: "17435002445:8618719149214",
      type: "buttons",
      button_message: {
        body: "Please choose one of the options below so we can route your message correctly.",
        buttons: [{ text: "Campaign / Collab" }, { text: "Creator Support" }],
      },
    });
    expect(JSON.stringify(body)).not.toContain("wati-secret-token-value");
  });

  it("posts a list for 4 Instagram persona options", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse());
    const result = await sendWatiInteractiveMessage({
      recipientId: "8618719149214",
      text: "Tell me a bit about yourself so I can point you to the right place.",
      quickReplies: [
        {
          content_type: "text",
          title: "I'm a creator",
          payload: PERSONA_CREATOR_PAYLOAD,
        },
        {
          content_type: "text",
          title: "I'm a brand",
          payload: PERSONA_BRAND_PAYLOAD,
        },
        {
          content_type: "text",
          title: "I'm an agency",
          payload: PERSONA_AGENCY_PAYLOAD,
        },
        {
          content_type: "text",
          title: "Something else",
          payload: PERSONA_OTHER_PAYLOAD,
        },
      ],
      config,
      deps: { fetchImpl },
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe(`https://live-mt-server.wati.io${WATI_V3_INTERACTIVE_PATH}`);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      target: "17435002445:8618719149214",
      type: "list",
      list_message: {
        body: "Tell me a bit about yourself so I can point you to the right place.",
        button_text: "Choose an option",
        sections: [
          {
            title: "Options",
            rows: [
              { title: "I'm a creator" },
              { title: "I'm a brand" },
              { title: "I'm an agency" },
              { title: "Something else" },
            ],
          },
        ],
      },
    });
  });

  it("discards the legacy tenant path for the interactive URL", () => {
    expect(
      watiV3InteractiveMessageUrl({
        ...config,
        apiEndpoint: "https://live-mt-server.wati.io/101197/",
      }),
    ).toBe(`https://live-mt-server.wati.io${WATI_V3_INTERACTIVE_PATH}`);
    expect(watiV3InteractiveMessageUrl(config)).not.toContain("101197");
  });

  it("maps 401/timeout to sanitized failures without logging secrets", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unauthorized = await sendWatiInteractiveMessage({
      recipientId: "8618719149214",
      text: "Choose",
      quickReplies: [
        {
          content_type: "text",
          title: "Creator Support",
          payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
        },
      ],
      config,
      deps: { fetchImpl: async () => new Response("{}", { status: 401 }) },
    });
    expect(unauthorized).toMatchObject({ ok: false, errorCode: "http_401" });

    const timed = await sendWatiInteractiveMessage({
      recipientId: "8618719149214",
      text: "Choose",
      quickReplies: [
        {
          content_type: "text",
          title: "Creator Support",
          payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
        },
      ],
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
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("wati-secret-token-value");
    expect(logged).not.toContain("8618719149214");
    expect(logged).not.toContain("Creator Support");
  });

  it("rejects an unrepresentable option set without calling WATI", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await sendWatiInteractiveMessage({
      recipientId: "8618719149214",
      text: "Choose",
      quickReplies: [
        {
          content_type: "text",
          title: "this title is far too long for whatsapp lists",
          payload: "TOO_LONG",
        },
      ],
      config,
      deps: { fetchImpl },
    });
    expect(result).toMatchObject({
      ok: false,
      errorCode: "wati_interactive_option_too_long",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("WATI conversation target modes", () => {
  const routingButtons = [
    {
      content_type: "text" as const,
      title: "Campaign / Collab",
      payload: ROUTE_COLLABORATION_PAYLOAD,
    },
    {
      content_type: "text" as const,
      title: "Creator Support",
      payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
    },
  ];

  const personaList = [
    {
      content_type: "text" as const,
      title: "I'm a creator",
      payload: PERSONA_CREATOR_PAYLOAD,
    },
    {
      content_type: "text" as const,
      title: "I'm a brand",
      payload: PERSONA_BRAND_PAYLOAD,
    },
    {
      content_type: "text" as const,
      title: "I'm an agency",
      payload: PERSONA_AGENCY_PAYLOAD,
    },
    {
      content_type: "text" as const,
      title: "Something else",
      payload: PERSONA_OTHER_PAYLOAD,
    },
  ];

  it("preserves channel_recipient when the mode env is unset", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: { fetchImpl, env: sendEnv() },
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.target).toBe(
      buildWatiConversationTarget({
        channelPhoneNumber: config.channelPhoneNumber,
        recipientWaId: RECIPIENT_ID,
        mode: "channel_recipient",
      }),
    );
    expect(body.target).toBe("17435002445:8618719149214");
  });

  it("uses channel:recipient when mode is explicitly channel_recipient", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: {
        fetchImpl,
        env: sendEnv({ WATI_CONVERSATION_TARGET_MODE: "channel_recipient" }),
      },
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.target).toBe("17435002445:8618719149214");
  });

  it("uses recipient only when mode is recipient", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const result = await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: {
        fetchImpl,
        env: sendEnv({ WATI_CONVERSATION_TARGET_MODE: "recipient" }),
      },
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.target).toBe("8618719149214");
    expect(body.target).not.toContain(":");
    expect(body.target).not.toContain("17435002445");
  });

  it("uses the same helper target for text and interactive sends", async () => {
    const expected = buildWatiConversationTarget({
      channelPhoneNumber: config.channelPhoneNumber,
      recipientWaId: RECIPIENT_ID,
      mode: "recipient",
    });
    const textFetch = vi.fn<typeof fetch>(async () => acceptedResponse());
    const interactiveFetch = vi.fn<typeof fetch>(async () => acceptedResponse());
    const env = sendEnv({ WATI_CONVERSATION_TARGET_MODE: "recipient" });

    await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: { fetchImpl: textFetch, env },
    });
    await sendWatiInteractiveMessage({
      recipientId: RECIPIENT_ID,
      text: "Choose",
      quickReplies: routingButtons,
      deps: { fetchImpl: interactiveFetch, env },
    });

    expect(JSON.parse(String(textFetch.mock.calls[0]?.[1]?.body)).target).toBe(
      expected,
    );
    expect(
      JSON.parse(String(interactiveFetch.mock.calls[0]?.[1]?.body)).target,
    ).toBe(expected);
  });

  it("sends buttons and lists with recipient-only targets", async () => {
    const buttonFetch = vi.fn<typeof fetch>(async () => acceptedResponse());
    const listFetch = vi.fn<typeof fetch>(async () => acceptedResponse());
    const env = sendEnv({ WATI_CONVERSATION_TARGET_MODE: "recipient" });

    const buttons = await sendWatiInteractiveMessage({
      recipientId: RECIPIENT_ID,
      text: "Please choose one of the options below so we can route your message correctly.",
      quickReplies: routingButtons,
      deps: { fetchImpl: buttonFetch, env },
    });
    const list = await sendWatiInteractiveMessage({
      recipientId: RECIPIENT_ID,
      text: "Tell me a bit about yourself so I can point you to the right place.",
      quickReplies: personaList,
      deps: { fetchImpl: listFetch, env },
    });

    expect(buttons.ok).toBe(true);
    expect(list.ok).toBe(true);
    const buttonBody = JSON.parse(String(buttonFetch.mock.calls[0]?.[1]?.body));
    const listBody = JSON.parse(String(listFetch.mock.calls[0]?.[1]?.body));
    expect(buttonBody.type).toBe("buttons");
    expect(buttonBody.target).toBe(RECIPIENT_ID);
    expect(listBody.type).toBe("list");
    expect(listBody.target).toBe(RECIPIENT_ID);
  });

  it("fails closed on invalid mode before fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: {
        fetchImpl,
        env: sendEnv({ WATI_CONVERSATION_TARGET_MODE: "auto" }),
      },
    });
    expect(result).toEqual({
      ok: false,
      errorCode: INVALID_WATI_CONVERSATION_TARGET_MODE,
      retryable: false,
      messagingWindowExpired: false,
      httpStatus: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("auto");
    expect(logged).not.toContain(RECIPIENT_ID);
    expect(logged).not.toContain("wati-secret-token-value");
  });

  it("fails closed without a channel even in recipient mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: {
        fetchImpl,
        env: sendEnv({
          WATI_CHANNEL_PHONE_NUMBER: undefined,
          WATI_CONVERSATION_TARGET_MODE: "recipient",
        }),
      },
    });
    expect(result).toMatchObject({
      ok: false,
      errorCode: "wati_send_not_configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not retry a failed send with the other target shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            result: "error",
            info: "Conversation Expired",
            error: { code: 5002 },
          }),
          { status: 400 },
        ),
    );
    const result = await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: {
        fetchImpl,
        env: sendEnv({ WATI_CONVERSATION_TARGET_MODE: "recipient" }),
      },
    });
    expect(result).toMatchObject({
      ok: false,
      errorCode: "http_400",
      messagingWindowExpired: false,
      httpStatus: 400,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.target).toBe(RECIPIENT_ID);
    expect(body.target).not.toBe("17435002445:8618719149214");
  });

  it("keeps the token only in Authorization and the URL origin-only", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    await sendWatiSessionText({
      recipientId: RECIPIENT_ID,
      text: "Hello from CRM",
      deps: {
        fetchImpl,
        env: sendEnv({ WATI_CONVERSATION_TARGET_MODE: "recipient" }),
      },
    });
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(url).toBe(`https://live-mt-server.wati.io${WATI_V3_TEXT_PATH}`);
    expect(url).not.toContain("?");
    expect(url).not.toContain("101197");
    expect(url).not.toContain(RECIPIENT_ID);
    expect(url).not.toContain("17435002445");
    expect(url).not.toContain("Hello");
    expect(url.toLowerCase()).not.toContain("wati-secret-token-value");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer wati-secret-token-value",
    });
    const body = String(init?.body);
    expect(body.toLowerCase()).not.toContain("wati-secret-token-value");
  });
});
