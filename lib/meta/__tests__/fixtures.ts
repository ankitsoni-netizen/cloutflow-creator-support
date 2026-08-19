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

export function whatsappStatusPayload() {
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
              statuses: [
                {
                  id: "wamid.HBgNMTYzMTU1NTExODE",
                  status: "delivered",
                  timestamp: "1603059207",
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
            },
          },
        ],
      },
    ],
  };
}
