import { describe, expect, it } from "vitest";
import {
  META_INSTAGRAM_PROVIDER,
  META_WHATSAPP_PROVIDER,
} from "@/lib/meta/constants";
import {
  extractInstagramEchoes,
  normalizeMetaWebhookPayload,
} from "@/lib/meta/normalize";
import {
  instagramLoginMessagesPayload,
  instagramTextPayload,
  whatsappStatusPayload,
  whatsappTextPayload,
} from "@/lib/meta/__tests__/fixtures";

describe("normalizeMetaWebhookPayload", () => {
  it("normalizes a WhatsApp Cloud API inbound text message", () => {
    const events = normalizeMetaWebhookPayload(whatsappTextPayload());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "whatsapp",
      provider: META_WHATSAPP_PROVIDER,
      externalEventId: "wamid.HBgNMTYzMTU1NTExODE",
      externalMessageId: "wamid.HBgNMTYzMTU1NTExODE",
      externalConversationId: "16315551181",
      externalContactId: "16315551181",
      displayName: "Riya Sharma",
      senderName: "Riya Sharma",
      senderAddress: "16315551181",
      messageType: "text",
      messageBody: "Payment is delayed",
      phoneNumberId: "123456123",
      recipientAccountId: null,
    });
    expect(events[0]?.timestamp).toBe("2020-10-18T22:13:26.000Z");
    expect(events[0]?.eventFragment).toMatchObject({
      messaging_product: "whatsapp",
    });
  });

  it("normalizes every WhatsApp text message in a multi-message payload", () => {
    const events = normalizeMetaWebhookPayload(
      whatsappTextPayload({
        extraMessages: [{ id: "wamid.second", body: "Second message" }],
      }),
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.externalMessageId)).toEqual([
      "wamid.HBgNMTYzMTU1NTExODE",
      "wamid.second",
    ]);
    expect(events.map((event) => event.messageBody)).toEqual([
      "Payment is delayed",
      "Second message",
    ]);
  });

  it("ignores WhatsApp delivery/status callbacks", () => {
    expect(normalizeMetaWebhookPayload(whatsappStatusPayload())).toEqual([]);
  });

  it("ignores WhatsApp non-text message types", () => {
    const payload = whatsappTextPayload();
    const message = payload.entry[0].changes[0].value.messages[0] as Record<
      string,
      unknown
    >;
    message.type = "image";
    delete message.text;
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
  });

  it("ignores empty WhatsApp text bodies", () => {
    expect(
      normalizeMetaWebhookPayload(whatsappTextPayload({ body: "   " })),
    ).toEqual([]);
  });

  it("does not invent WhatsApp IDs when message id or from is missing", () => {
    expect(
      normalizeMetaWebhookPayload(whatsappTextPayload({ id: "" })),
    ).toEqual([]);
    const missingFrom = whatsappTextPayload();
    delete (missingFrom.entry[0].changes[0].value.messages[0] as { from?: string })
      .from;
    expect(normalizeMetaWebhookPayload(missingFrom)).toEqual([]);
  });

  it("normalizes Meta's current Instagram Login messages webhook", () => {
    const events = normalizeMetaWebhookPayload(instagramLoginMessagesPayload());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      messageType: "text",
      messageBody: "Hello from Instagram Login",
    });
  });

  it("normalizes an Instagram Messaging inbound text message", () => {
    const events = normalizeMetaWebhookPayload(instagramTextPayload());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "instagram",
      provider: META_INSTAGRAM_PROVIDER,
      externalEventId: "mid.instagram.abc",
      externalMessageId: "mid.instagram.abc",
      externalConversationId: "IGSID123",
      externalContactId: "IGSID123",
      displayName: null,
      senderName: null,
      senderAddress: "IGSID123",
      messageType: "text",
      messageBody: "Need help with a campaign",
      phoneNumberId: null,
      recipientAccountId: "INSTAGRAM_ACCOUNT_ID",
    });
    expect(events[0]?.timestamp).toBe("2020-10-18T22:13:26.000Z");
  });

  it("ignores Instagram echo messages in chatbot normalize and extracts them separately", () => {
    const payload = instagramTextPayload({ isEcho: true });
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
    const echoes = extractInstagramEchoes(payload);
    expect(echoes).toHaveLength(1);
    expect(echoes[0]).toMatchObject({
      isEcho: true,
      externalMessageId: "mid.instagram.abc",
      recipientId: "INSTAGRAM_ACCOUNT_ID",
    });
  });

  it("does not invent Instagram IDs when mid or sender is missing", () => {
    expect(
      normalizeMetaWebhookPayload(instagramTextPayload({ mid: "" })),
    ).toEqual([]);
    const payload = instagramTextPayload();
    delete (payload.entry[0].messaging[0] as { sender?: unknown }).sender;
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
  });

  it("returns no events for unsupported or empty payloads", () => {
    expect(normalizeMetaWebhookPayload(null)).toEqual([]);
    expect(normalizeMetaWebhookPayload({})).toEqual([]);
    expect(normalizeMetaWebhookPayload({ object: "page", entry: [] })).toEqual(
      [],
    );
    expect(
      normalizeMetaWebhookPayload({
        object: "instagram",
        entry: [{ id: "x", messaging: [{ recipient: { id: "page" } }] }],
      }),
    ).toEqual([]);
  });
});
