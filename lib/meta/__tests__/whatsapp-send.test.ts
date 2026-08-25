import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendWhatsAppReplyButtons,
  sendWhatsAppText,
  whatsappMessagesUrl,
} from "@/lib/meta/whatsapp-send";
import {
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
} from "@/lib/meta/routing-copy";

const config = {
  accessToken: "meta-wa-access-token-test",
  phoneNumberId: "123456123",
  graphVersion: "v23.0",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WhatsApp Cloud API send client", () => {
  it("posts text to graph.facebook.com with a bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.out.1" }] }), {
        status: 200,
      }),
    );
    const result = await sendWhatsAppText({
      recipientId: "16315551181",
      text: "Hello",
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result).toEqual({
      ok: true,
      metaMessageId: "wamid.out.1",
      recipientId: "16315551181",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(url).toBe(whatsappMessagesUrl(config));
    expect(url).toBe("https://graph.facebook.com/v23.0/123456123/messages");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer meta-wa-access-token-test",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "16315551181",
      type: "text",
      text: { preview_url: false, body: "Hello" },
    });
  });

  it("sends interactive routing reply buttons", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.qr.1" }] }), {
        status: 200,
      }),
    );
    const result = await sendWhatsAppReplyButtons({
      recipientId: "16315551181",
      text: "Choose",
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
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "16315551181",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Choose" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: ROUTE_COLLABORATION_PAYLOAD,
                title: "Campaign / Collab",
              },
            },
            {
              type: "reply",
              reply: {
                id: ROUTE_CREATOR_SUPPORT_PAYLOAD,
                title: "Creator Support",
              },
            },
          ],
        },
      },
    });
  });

  it("marks customer-service window errors without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 131047 } }), {
          status: 400,
        }),
    );
    const result = await sendWhatsAppText({
      recipientId: "16315551181",
      text: "Hello",
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    expect(result).toMatchObject({
      ok: false,
      errorCode: "outside_customer_service_window",
      retryable: false,
      messagingWindowExpired: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries retryable 5xx failures and does not retry permanent 4xx", async () => {
    const retryable = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 1 } }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.retry" }] }), {
          status: 200,
        }),
      );
    const retried = await sendWhatsAppText({
      recipientId: "16315551181",
      text: "Hello",
      config,
      deps: { fetchImpl: retryable, sleep: async () => {} },
    });
    expect(retried).toMatchObject({ ok: true, metaMessageId: "wamid.retry" });
    expect(retryable).toHaveBeenCalledTimes(2);

    const permanent = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 }),
    );
    const failed = await sendWhatsAppText({
      recipientId: "16315551181",
      text: "Hello",
      config,
      deps: { fetchImpl: permanent, sleep: async () => {} },
    });
    expect(failed).toMatchObject({ ok: false, retryable: false });
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it("rejects non-numeric recipient ids without calling Graph", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await sendWhatsAppText({
      recipientId: "not-a-wa-id",
      text: "Hello",
      config,
      deps: { fetchImpl },
    });
    expect(result).toMatchObject({ ok: false, errorCode: "invalid_recipient" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not log message text, tokens, or phone numbers on failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 1 } }), { status: 500 }),
    );
    await sendWhatsAppText({
      recipientId: "16315551181",
      text: "secret creator email riya@example.com",
      config,
      deps: { fetchImpl, sleep: async () => {} },
    });
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("riya@example.com");
    expect(logged).not.toContain("secret creator email");
    expect(logged).not.toContain("meta-wa-access-token-test");
    expect(logged).not.toContain("16315551181");
  });
});
