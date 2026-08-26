import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractWatiMessageRecords,
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
  it("maps a text messageReceived payload", () => {
    const result = normalizeWatiWebhookPayload(watiTextPayload(), {
      expectedChannelPhoneNumber: CHANNEL,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      channel: "whatsapp",
      provider: WATI_WHATSAPP_PROVIDER,
      externalMessageId: WAMID,
      externalEventId: WAMID,
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

  it("maps delivery callbacks to statuses", () => {
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
      provider: WATI_WHATSAPP_PROVIDER,
      metaMessageId: "wamid.out.1",
      localMessageId: "wa:crm:comment-1",
      watiEventId: "wati-event-1",
      status: "delivered",
    });
  });

  it("sanitizes fragments without personal media URLs", () => {
    const fragment = sanitizeWatiEventFragment(watiTextPayload());
    expect(fragment).not.toHaveProperty("sourceUrl");
    expect(fragment).not.toHaveProperty("avatarUrl");
    expect(fragment).not.toHaveProperty("text");
  });
});
