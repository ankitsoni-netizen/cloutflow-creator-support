import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWatiExternalEventId,
  extractWatiMessageRecords,
  normalizeWatiEventType,
  normalizeWatiWebhookPayload,
  sanitizeWatiEventFragment,
} from "@/lib/wati/normalize";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import {
  WATI_TEST_CHANNEL,
  WATI_TEST_WA_ID,
  WATI_TEST_WAMID,
  watiTextPayload,
} from "@/lib/wati/__tests__/fixtures";

const CHANNEL = WATI_TEST_CHANNEL;
const WA_ID = WATI_TEST_WA_ID;
const WAMID = WATI_TEST_WAMID;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WATI normalize", () => {
  it("maps a text messageReceived payload with provider=wati", () => {
    const result = normalizeWatiWebhookPayload(watiTextPayload(), {
      expectedChannelPhoneNumber: CHANNEL,
    });
    expect(result.events).toHaveLength(1);
    expect(WATI_WHATSAPP_PROVIDER).toBe("wati");
    expect(result.events[0]).toMatchObject({
      channel: "whatsapp",
      provider: "wati",
      externalMessageId: WAMID,
      externalEventId: `messageReceived:${WAMID}`,
      externalContactId: WA_ID,
      externalConversationId: "68c8d56157578adb12ada249",
      senderAddress: WA_ID,
      senderName: "coubbb",
      messageType: "text",
      messageBody: "hello",
      recipientAccountId: CHANNEL,
    });
    const fragment = JSON.stringify(result.events[0]?.eventFragment);
    expect(fragment).not.toContain("cdn.example");
    expect(fragment).not.toContain("secret");
    expect(fragment).not.toContain("avatar");
    expect(fragment).not.toContain("wati_whatsapp");
  });

  it("normalizes list and button replies", () => {
    const list = normalizeWatiWebhookPayload(
      watiTextPayload({
        text: null,
        type: "interactive",
        listReply: { id: "route_creator_support", title: "Creator Support" },
        whatsappMessageId: "wamid.list.1",
      }),
    );
    expect(list.events[0]).toMatchObject({
      messageType: "interactive",
      quickReplyPayload: "route_creator_support",
      messageBody: "Creator Support",
      externalEventId: "messageReceived:wamid.list.1",
    });

    const button = normalizeWatiWebhookPayload(
      watiTextPayload({
        text: null,
        type: "button",
        buttonReply: { id: "route_collab", title: "Campaign / Collab" },
        whatsappMessageId: "wamid.btn.1",
      }),
    );
    expect(button.events[0]).toMatchObject({
      messageType: "interactive",
      quickReplyPayload: "route_collab",
      messageBody: "Campaign / Collab",
    });

    const interactive = normalizeWatiWebhookPayload(
      watiTextPayload({
        text: null,
        type: "interactive",
        interactiveButtonReply: {
          id: "yes",
          title: "Yes",
        },
        whatsappMessageId: "wamid.ibr.1",
      }),
    );
    expect(interactive.events[0]?.quickReplyPayload).toBe("yes");
  });

  it("prefers the tapped option over generic payload text", () => {
    const result = normalizeWatiWebhookPayload(
      watiTextPayload({
        text: "ignored generic text",
        type: "interactive",
        interactiveButtonReply: { text: "Creator Support" },
        whatsappMessageId: "wamid.prefer.1",
      }),
    );
    expect(result.events[0]).toMatchObject({
      messageType: "interactive",
      messageBody: "Creator Support",
      quickReplyPayload: null,
    });
  });

  it("accepts nested snake_case list replies", () => {
    const result = normalizeWatiWebhookPayload(
      watiTextPayload({
        text: null,
        type: "interactive",
        listReply: null,
        interactiveButtonReply: null,
        buttonReply: null,
        interactive: {
          list_reply: { title: "I'm a creator" },
        },
        whatsappMessageId: "wamid.nested.1",
      }),
    );
    expect(result.events[0]).toMatchObject({
      messageType: "interactive",
      messageBody: "I'm a creator",
      quickReplyPayload: null,
    });
  });

  it("keeps semantic Instagram payloads when WATI supplies them as ids", () => {
    const result = normalizeWatiWebhookPayload(
      watiTextPayload({
        text: null,
        type: "button",
        buttonReply: {
          id: "ROUTE_CREATOR_SUPPORT",
          title: "Creator Support",
        },
        whatsappMessageId: "wamid.semantic.1",
      }),
    );
    expect(result.events[0]).toMatchObject({
      messageBody: "Creator Support",
      quickReplyPayload: "ROUTE_CREATOR_SUPPORT",
    });
  });

  it("stores media as sanitized placeholders without unsafe URLs", () => {
    for (const type of ["image", "video", "audio", "document", "sticker"] as const) {
      const result = normalizeWatiWebhookPayload(
        watiTextPayload({
          type,
          text: null,
          sourceUrl: "https://evil.example/media.bin",
          whatsappMessageId: `wamid.${type}`,
        }),
      );
      expect(result.events[0]?.messageBody).toBe(`[${type}]`);
      expect(result.events[0]?.messageType).toBe("unsupported");
      expect(JSON.stringify(result.events[0]?.eventFragment)).not.toContain(
        "evil.example",
      );
    }
  });

  it("ignores owner outbound for chatbot progression", () => {
    const result = normalizeWatiWebhookPayload(
      watiTextPayload({
        owner: true,
        eventType: "sessionMessageSent_v2",
        statusString: "SENT",
        text: "agent reply",
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(
      result.statuses.length + result.ignored.length,
    ).toBeGreaterThan(0);
  });

  it("rejects a wrong channel safely without inbound events", () => {
    const result = normalizeWatiWebhookPayload(watiTextPayload(), {
      expectedChannelPhoneNumber: "99999999999",
    });
    expect(result.events).toHaveLength(0);
    expect(result.rejected.some((item) => item.reason === "wrong_channel")).toBe(
      true,
    );
  });

  it("falls back to waId for conversation id and WATI id for message id", () => {
    const result = normalizeWatiWebhookPayload(
      watiTextPayload({
        conversationId: null,
        whatsappMessageId: null,
        id: "wati-internal-1",
      }),
    );
    expect(result.events[0]?.externalConversationId).toBe(WA_ID);
    expect(result.events[0]?.externalMessageId).toBe("wati-internal-1");
    expect(result.events[0]?.externalEventId).toBe(
      "messageReceived:wati-internal-1",
    );
  });

  it("safely ignores callbacks missing both whatsappMessageId and callback id", () => {
    const result = normalizeWatiWebhookPayload(
      watiTextPayload({
        whatsappMessageId: null,
        id: null,
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.ignored.some((item) => item.reason === "missing_message_id")).toBe(
      true,
    );

    const status = normalizeWatiWebhookPayload({
      eventType: "sentMessageDELIVERED_v2",
      statusString: "Delivered",
      whatsappMessageId: null,
      id: null,
      channelPhoneNumber: CHANNEL,
    });
    expect(status.statuses).toHaveLength(0);
    expect(status.ignored.some((item) => item.reason === "missing_status_id")).toBe(
      true,
    );
  });

  it("unwraps wrapper and array forms", () => {
    const wrapped = extractWatiMessageRecords({
      messages: [watiTextPayload({ whatsappMessageId: "wamid.wrap" })],
    });
    expect(wrapped).toHaveLength(1);

    const array = extractWatiMessageRecords([
      watiTextPayload({ whatsappMessageId: "wamid.arr" }),
    ]);
    expect(array).toHaveLength(1);
  });

  it("gives sent/delivered/read distinct externalEventIds for the same WAMID", () => {
    const wamid = "wamid.shared.1";
    const sent = normalizeWatiWebhookPayload({
      eventType: "sessionMessageSent_v2",
      statusString: "SENT",
      whatsappMessageId: wamid,
      id: "evt-sent",
      channelPhoneNumber: CHANNEL,
      owner: true,
    });
    const delivered = normalizeWatiWebhookPayload({
      eventType: "sentMessageDELIVERED_v2",
      statusString: "Delivered",
      whatsappMessageId: wamid,
      id: "evt-delivered",
      channelPhoneNumber: CHANNEL,
    });
    const read = normalizeWatiWebhookPayload({
      eventType: "sentMessageREAD_v2",
      statusString: "Read",
      whatsappMessageId: wamid,
      id: "evt-read",
      channelPhoneNumber: CHANNEL,
    });

    expect(sent.statuses[0]?.externalEventId).toBe(
      `sessionMessageSent_v2:${wamid}`,
    );
    expect(delivered.statuses[0]?.externalEventId).toBe(
      `sentMessageDELIVERED_v2:${wamid}`,
    );
    expect(read.statuses[0]?.externalEventId).toBe(
      `sentMessageREAD_v2:${wamid}`,
    );
    expect(sent.statuses[0]?.metaMessageId).toBe(wamid);
    expect(delivered.statuses[0]?.metaMessageId).toBe(wamid);
    expect(read.statuses[0]?.metaMessageId).toBe(wamid);

    const ids = [
      sent.statuses[0]?.externalEventId,
      delivered.statuses[0]?.externalEventId,
      read.statuses[0]?.externalEventId,
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it("maps delivery callbacks to statuses with provider=wati", () => {
    const result = normalizeWatiWebhookPayload({
      eventType: "sentMessageDELIVERED_v2",
      statusString: "Delivered",
      localMessageId: "wa:crm:comment-1",
      whatsappMessageId: "wamid.out.1",
      id: "wati-event-1",
      channelPhoneNumber: CHANNEL,
      timestamp: "1764238453",
    });
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0]).toMatchObject({
      provider: "wati",
      metaMessageId: "wamid.out.1",
      externalEventId: "sentMessageDELIVERED_v2:wamid.out.1",
      localMessageId: "wa:crm:comment-1",
      watiEventId: "wati-event-1",
      status: "delivered",
    });
  });

  it("normalizes event types through a strict allowlist", () => {
    expect(normalizeWatiEventType("message")).toBe("messageReceived");
    expect(normalizeWatiEventType("sessionMessageSent_v2")).toBe(
      "sessionMessageSent_v2",
    );
    expect(normalizeWatiEventType("sentMessageDELIVERED_v2")).toBe(
      "sentMessageDELIVERED_v2",
    );
    expect(normalizeWatiEventType("sentMessageREAD_v2")).toBe(
      "sentMessageREAD_v2",
    );
    expect(normalizeWatiEventType("sessionMessageFailed_v2")).toBe(
      "sessionMessageFailed_v2",
    );
    expect(normalizeWatiEventType("unknownThing")).toBeNull();
    expect(normalizeWatiEventType(null, { fallbackInbound: true })).toBe(
      "messageReceived",
    );
    expect(
      buildWatiExternalEventId("messageReceived", WAMID, null),
    ).toBe(`messageReceived:${WAMID}`);
    expect(
      buildWatiExternalEventId("messageReceived", null, "wati-cb-1"),
    ).toBe("messageReceived:wati-cb-1");
    expect(buildWatiExternalEventId("messageReceived", null, null)).toBeNull();
  });

  it("sanitizes fragments without personal media URLs", () => {
    const fragment = sanitizeWatiEventFragment(watiTextPayload());
    expect(fragment).not.toHaveProperty("sourceUrl");
    expect(fragment).not.toHaveProperty("avatarUrl");
    expect(fragment).not.toHaveProperty("text");
    expect(fragment.provider).toBe("wati");
  });
});
