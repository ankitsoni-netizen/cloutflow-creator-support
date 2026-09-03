import { describe, expect, it } from "vitest";
import {
  INVALID_WATI_CONVERSATION_TARGET_MODE,
  resolveWatiConversationTargetMode,
  resolveWatiSendConfig,
  WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT,
  WATI_CONVERSATION_TARGET_MODE_RECIPIENT,
  WATI_ENV,
} from "@/lib/wati/config";

const SEND_ENV = {
  WATI_API_ENDPOINT: "https://live-mt-server.wati.io/101197",
  WATI_API_TOKEN: "wati-secret-token-value",
  WATI_CHANNEL_PHONE_NUMBER: "17435002445",
};

describe("resolveWatiConversationTargetMode", () => {
  it("defaults to channel_recipient when unset or blank", () => {
    expect(resolveWatiConversationTargetMode({})).toEqual({
      ok: true,
      mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT,
    });
    expect(
      resolveWatiConversationTargetMode({
        WATI_CONVERSATION_TARGET_MODE: "",
      }),
    ).toEqual({
      ok: true,
      mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT,
    });
    expect(
      resolveWatiConversationTargetMode({
        WATI_CONVERSATION_TARGET_MODE: "   ",
      }),
    ).toEqual({
      ok: true,
      mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT,
    });
  });

  it("accepts explicit channel_recipient and recipient", () => {
    expect(
      resolveWatiConversationTargetMode({
        WATI_CONVERSATION_TARGET_MODE: "channel_recipient",
      }),
    ).toEqual({
      ok: true,
      mode: WATI_CONVERSATION_TARGET_MODE_CHANNEL_RECIPIENT,
    });
    expect(
      resolveWatiConversationTargetMode({
        WATI_CONVERSATION_TARGET_MODE: "recipient",
      }),
    ).toEqual({
      ok: true,
      mode: WATI_CONVERSATION_TARGET_MODE_RECIPIENT,
    });
  });

  it("fails closed on invalid values without echoing the raw mode", () => {
    const result = resolveWatiConversationTargetMode({
      WATI_CONVERSATION_TARGET_MODE: "channel-recipient",
    });
    expect(result).toEqual({
      ok: false,
      errorCode: INVALID_WATI_CONVERSATION_TARGET_MODE,
    });
    expect(JSON.stringify(result)).not.toContain("channel-recipient");
  });
});

describe("resolveWatiSendConfig", () => {
  it("keeps channel required in recipient mode", () => {
    expect(
      resolveWatiSendConfig({
        ...SEND_ENV,
        WATI_CHANNEL_PHONE_NUMBER: undefined,
        WATI_CONVERSATION_TARGET_MODE: "recipient",
      }),
    ).toEqual({
      ok: false,
      errorCode: "wati_send_not_configured",
    });
  });

  it("returns recipient mode when channel and credentials are present", () => {
    expect(
      resolveWatiSendConfig({
        ...SEND_ENV,
        WATI_CONVERSATION_TARGET_MODE: "recipient",
      }),
    ).toEqual({
      ok: true,
      config: {
        apiEndpoint: SEND_ENV.WATI_API_ENDPOINT,
        apiToken: SEND_ENV.WATI_API_TOKEN,
        channelPhoneNumber: SEND_ENV.WATI_CHANNEL_PHONE_NUMBER,
        conversationTargetMode: "recipient",
      },
    });
  });

  it("fails closed on invalid mode after channel is present", () => {
    expect(
      resolveWatiSendConfig({
        ...SEND_ENV,
        WATI_CONVERSATION_TARGET_MODE: "auto",
      }),
    ).toEqual({
      ok: false,
      errorCode: INVALID_WATI_CONVERSATION_TARGET_MODE,
    });
  });

  it("exposes the env name without a NEXT_PUBLIC_ prefix", () => {
    expect(WATI_ENV.CONVERSATION_TARGET_MODE).toBe(
      "WATI_CONVERSATION_TARGET_MODE",
    );
    expect(WATI_ENV.CONVERSATION_TARGET_MODE.startsWith("NEXT_PUBLIC_")).toBe(
      false,
    );
  });
});
