export function whatsappTextPayload(overrides: {
  from?: string;
  id?: string;
  body?: string;
  name?: string;
  timestamp?: string;
  extraMessages?: Array<{
    from?: string;
    id: string;
    body: string;
    timestamp?: string;
  }>;
} = {}) {
  const from = overrides.from ?? "16315551181";
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "16505551111",
                phone_number_id: "123456123",
              },
              contacts: [
                {
                  profile: { name: overrides.name ?? "Riya Sharma" },
                  wa_id: from,
                },
              ],
              messages: [
                {
                  from,
                  id: overrides.id ?? "wamid.HBgNMTYzMTU1NTExODE",
                  timestamp: overrides.timestamp ?? "1603059206",
                  text: { body: overrides.body ?? "Payment is delayed" },
                  type: "text",
                },
                ...(overrides.extraMessages ?? []).map((message) => ({
                  from: message.from ?? from,
                  id: message.id,
                  timestamp: message.timestamp ?? "1603059207",
                  text: { body: message.body },
                  type: "text",
                })),
              ],
            },
          },
        ],
      },
    ],
  };
}

export function whatsappStatusPayload(overrides: {
  id?: string;
  status?: string;
  timestamp?: string;
  phoneNumberId?: string;
} = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "16505551111",
                phone_number_id: overrides.phoneNumberId ?? "123456123",
              },
              statuses: [
                {
                  id: overrides.id ?? "wamid.HBgNMTYzMTU1NTExODE",
                  status: overrides.status ?? "delivered",
                  timestamp: overrides.timestamp ?? "1603059207",
                  recipient_id: "16315551181",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function instagramTextPayload(overrides: {
  senderId?: string;
  mid?: string;
  text?: string;
  isEcho?: boolean;
  timestamp?: number;
  quickReplyPayload?: string;
} = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: "INSTAGRAM_ACCOUNT_ID",
        time: 1603059206000,
        messaging: [
          {
            sender: { id: overrides.senderId ?? "IGSID123" },
            recipient: { id: "INSTAGRAM_ACCOUNT_ID" },
            timestamp: overrides.timestamp ?? 1603059206000,
            message: {
              mid: overrides.mid ?? "mid.instagram.abc",
              text: overrides.text ?? "Need help with a campaign",
              ...(overrides.isEcho ? { is_echo: true } : {}),
              ...(overrides.quickReplyPayload
                ? { quick_reply: { payload: overrides.quickReplyPayload } }
                : {}),
            },
          },
        ],
      },
    ],
  };
}

/**
 * Meta Instagram Login `messages` webhook envelope (Nov 2025 docs).
 * Uses `object: "instagram"` and `entry[].messaging[]`.
 */
export function instagramLoginMessagesPayload(overrides: {
  senderId?: string;
  recipientId?: string;
  mid?: string;
  text?: string;
  isEcho?: boolean;
  isSelf?: boolean;
  timestamp?: number;
} = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: overrides.recipientId ?? "17841400008460000",
        time: 1569262486134,
        messaging: [
          {
            sender: { id: overrides.senderId ?? "12334" },
            recipient: { id: overrides.recipientId ?? "17841400008460000" },
            timestamp: overrides.timestamp ?? 1569262485349,
            message: {
              mid: overrides.mid ?? "MESSAGE-ID-LOGIN",
              text: overrides.text ?? "Hello from Instagram Login",
              ...(overrides.isEcho ? { is_echo: true } : {}),
              ...(overrides.isSelf ? { is_self: true } : {}),
            },
          },
        ],
      },
    ],
  };
}

/** Dashboard test DM: Meta sets is_echo and is_self true. */
export function instagramLoginDashboardTestPayload() {
  return instagramLoginMessagesPayload({
    text: "Dashboard test message",
    isEcho: true,
    isSelf: true,
  });
}

/** Some Instagram Login field deliveries wrap the envelope in a top-level array. */
export function instagramLoginMessagesWrappedArrayPayload() {
  return [instagramLoginMessagesPayload()];
}

/**
 * Alternate Instagram Login Graph-style envelope: `entry.field` + `entry.value`
 * instead of `entry.messaging`.
 */
export function instagramLoginMessagesFieldValuePayload() {
  return {
    object: "instagram",
    entry: [
      {
        id: "17841400008460000",
        time: 1569262486134,
        field: "messages",
        value: {
          sender: { id: "12334" },
          recipient: { id: "17841400008460000" },
          timestamp: 1569262485349,
          message: {
            mid: "MESSAGE-ID-FIELD-VALUE",
            text: "Hello from field/value shape",
          },
        },
      },
    ],
  };
}

/** Facebook Login / Graph `entry.changes` wrapper for Instagram messages. */
export function instagramLoginMessagesChangesPayload() {
  return {
    object: "instagram",
    entry: [
      {
        id: "17841400008460000",
        time: 1569262486134,
        changes: [
          {
            field: "messages",
            value: {
              sender: { id: "12334" },
              recipient: { id: "17841400008460000" },
              timestamp: 1569262485349,
              message: {
                mid: "MESSAGE-ID-CHANGES",
                text: "Hello from changes shape",
              },
            },
          },
        ],
      },
    ],
  };
}

/** Instagram button / ice-breaker postback: payload lives on the item, not message.quick_reply. */
export function instagramPostbackPayload(overrides: {
  senderId?: string;
  recipientId?: string;
  mid?: string;
  title?: string;
  payload?: string;
  timestamp?: number;
} = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: overrides.recipientId ?? "17841400008460000",
        time: overrides.timestamp ?? 1603059206000,
        messaging: [
          {
            sender: { id: overrides.senderId ?? "12334" },
            recipient: { id: overrides.recipientId ?? "17841400008460000" },
            timestamp: overrides.timestamp ?? 1603059206000,
            postback: {
              mid: overrides.mid ?? "mid.instagram.postback",
              title: overrides.title ?? "I'm a creator",
              payload: overrides.payload ?? "PERSONA_CREATOR",
            },
          },
        ],
      },
    ],
  };
}
