import { afterEach, describe, expect, it, vi } from "vitest";
import {
  instagramMessagesUrl,
  sendInstagramQuickReplies,
  sendInstagramText,
} from "@/lib/meta/instagram-send";

const config = {
  accessToken: "meta-ig-access-token-test",
  accountId: "17841400008460000",
  graphVersion: "v23.0",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

describe("Instagram send client", () => {
  it("posts text to graph.instagram.com with a bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message_id: "mid.out.1" }), { status: 200 }),
    );
    const result = await sendInstagramText({
      recipientId: "12334",
      text: "Hello",
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result).toEqual({
      ok: true,
      metaMessageId: "mid.out.1",
      recipientId: "12334",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(url).toBe(instagramMessagesUrl(config));
    expect(url).toContain("https://graph.instagram.com/v23.0/17841400008460000/messages");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer meta-ig-access-token-test",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "12334" },
      message: { text: "Hello" },
    });
  });

  it("sends quick replies with messaging_type RESPONSE", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message_id: "mid.qr.1" }), { status: 200 }),
    );
    const result = await sendInstagramQuickReplies({
      recipientId: "12334",
      text: "Choose",
      quickReplies: [
        {
          content_type: "text",
          title: "Creator Support",
          payload: "ROUTE_CREATOR_SUPPORT",
        },
      ],
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.message.quick_replies[0].payload).toBe("ROUTE_CREATOR_SUPPORT");
  });

  it("marks messaging-window errors without retrying", async () => {
    const fetchImpl = mockFetch(
      new Response(JSON.stringify({ error: { code: 10, error_subcode: 2018278 } }), {
        status: 400,
      }),
    );
    const result = await sendInstagramText({
      recipientId: "12334",
      text: "Hello",
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result).toMatchObject({
      ok: false,
      errorCode: "messaging_window_expired",
      retryable: false,
      messagingWindowExpired: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries retryable 5xx failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 1 } }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message_id: "mid.retry" }), { status: 200 }),
      );
    const result = await sendInstagramText({
      recipientId: "12334",
      text: "Hello",
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result).toMatchObject({ ok: true, metaMessageId: "mid.retry" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects non-numeric recipient ids", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await sendInstagramText({
      recipientId: "not-an-igsid",
      text: "Hello",
      config,
      deps: { fetchImpl },
    });
    expect(result).toMatchObject({ ok: false, errorCode: "invalid_recipient" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
