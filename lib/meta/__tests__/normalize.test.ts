import { describe, expect, it } from "vitest";
import {
  META_INSTAGRAM_PROVIDER,
  META_WHATSAPP_PROVIDER,
} from "@/lib/meta/constants";
import {
  extractInstagramEchoes,
  extractWhatsAppStatuses,
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
      externalConversationId: "123456123:16315551181",
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

  it("ignores WhatsApp delivery/status callbacks in inbound normalize", () => {
    expect(normalizeMetaWebhookPayload(whatsappStatusPayload())).toEqual([]);
    const statuses = extractWhatsAppStatuses(whatsappStatusPayload());
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe("delivered");
    expect(statuses[0]?.metaMessageId).toBe("wamid.HBgNMTYzMTU1NTExODE");
  });

  it("normalizes WhatsApp interactive button replies", () => {
    const payload = whatsappTextPayload();
    const message = payload.entry[0].changes[0].value.messages[0] as Record<
      string,
      unknown
    >;
    message.type = "interactive";
    delete message.text;
    message.interactive = {
      type: "button_reply",
      button_reply: { id: "ROUTE_CREATOR_SUPPORT", title: "Creator Support" },
    };
    const events = normalizeMetaWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]?.quickReplyPayload).toBe("ROUTE_CREATOR_SUPPORT");
    expect(events[0]?.messageBody).toBe("Creator Support");
  });

  it("normalizes WhatsApp interactive list replies", () => {
    const payload = whatsappTextPayload();
    const message = payload.entry[0].changes[0].value.messages[0] as Record<
      string,
      unknown
    >;
    message.type = "interactive";
    delete message.text;
    message.interactive = {
      type: "list_reply",
      list_reply: { id: "ROUTE_COLLABORATION", title: "Campaign / Collab" },
    };
    const events = normalizeMetaWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]?.messageType).toBe("interactive");
    expect(events[0]?.quickReplyPayload).toBe("ROUTE_COLLABORATION");
    expect(events[0]?.messageBody).toBe("Campaign / Collab");
  });

  it("normalizes legacy WhatsApp button payload replies", () => {
    const payload = whatsappTextPayload();
    const message = payload.entry[0].changes[0].value.messages[0] as Record<
      string,
      unknown
    >;
    message.type = "button";
    delete message.text;
    message.button = {
      payload: "ROUTE_CREATOR_SUPPORT",
      text: "Creator Support",
    };
    const events = normalizeMetaWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]?.messageType).toBe("interactive");
    expect(events[0]?.quickReplyPayload).toBe("ROUTE_CREATOR_SUPPORT");
    expect(events[0]?.messageBody).toBe("Creator Support");
  });

  it("ignores WhatsApp changes that are not the messages field", () => {
    const payload = whatsappTextPayload();
    payload.entry[0].changes[0].field = "message_template_status_update";
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
    expect(extractWhatsAppStatuses(payload)).toEqual([]);
  });

  it("extracts sent, delivered, read, failed, and deleted statuses", () => {
    for (const status of ["sent", "delivered", "read", "failed", "deleted"] as const) {
      const statuses = extractWhatsAppStatuses(whatsappStatusPayload({ status }));
      expect(statuses).toHaveLength(1);
      expect(statuses[0]?.status).toBe(status);
      expect(statuses[0]?.provider).toBe(META_WHATSAPP_PROVIDER);
      expect(statuses[0]?.externalEventId).toBe(
        `status:wamid.HBgNMTYzMTU1NTExODE:${status}`,
      );
    }
  });

  it("stores WhatsApp media metadata without crashing", () => {
    const payload = whatsappTextPayload();
    const message = payload.entry[0].changes[0].value.messages[0] as Record<
      string,
      unknown
    >;
    message.type = "image";
    delete message.text;
    const events = normalizeMetaWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]?.messageType).toBe("unsupported");
    expect(events[0]?.unsupportedKind).toBe("image");
    expect(events[0]?.messageBody).toBe("[image]");
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

  it.each([
    ["image", { attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/x?access_token=secret" } }] }],
    ["video", { attachments: [{ type: "video", payload: { url: "https://cdn.example/video?access_token=secret" } }] }],
    ["audio", { attachments: [{ type: "audio" }] }],
    ["sticker", { sticker_id: "123" }],
    ["share", { attachments: [{ type: "share" }] }],
    ["attachment", { attachments: [{ type: "file" }] }],
  ] as const)(
    "stores a sanitized Instagram %s placeholder without media URLs or tokens",
    (kind, extra) => {
      const payload = instagramTextPayload();
      const message = payload.entry[0].messaging[0].message as Record<string, unknown>;
      delete message.text;
      Object.assign(message, extra);
      const events = normalizeMetaWebhookPayload(payload);
      expect(events).toHaveLength(1);
      expect(events[0]?.messageType).toBe("unsupported");
      expect(events[0]?.unsupportedKind).toBe(kind);
      expect(events[0]?.messageBody).toBe(`[${kind}]`);
      expect(JSON.stringify(events[0]?.eventFragment)).not.toContain("access_token");
      expect(JSON.stringify(events[0]?.eventFragment)).not.toContain("lookaside");
      expect(JSON.stringify(events[0]?.eventFragment)).not.toContain("http");
    },
  );

  it("ignores Instagram reactions instead of advancing intake", () => {
    const payload = instagramTextPayload();
    const item = payload.entry[0].messaging[0] as Record<string, unknown>;
    item.reaction = { emoji: "❤️", action: "react", mid: "mid.instagram.abc" };
    delete item.message;
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
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
