export const WATI_TEST_CHANNEL = "17435002445";
export const WATI_TEST_WA_ID = "8618719149214";
export const WATI_TEST_WAMID =
  "wamid.HBgNODYxODcxOTE0OTIxNBUCABIYFDNCRkJFNDFCMTI1MDAwQTRCMDMwAA==";

export function watiTextPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "69282478274a880fe782b2d9",
    created: "2025-11-27T10:14:16.6268572Z",
    whatsappMessageId: WATI_TEST_WAMID,
    conversationId: "68c8d56157578adb12ada249",
    text: "hello",
    type: "text",
    data: null,
    sourceUrl: "https://cdn.example/secret.jpg",
    timestamp: "1764238453",
    owner: false,
    eventType: "message",
    statusString: "SENT",
    avatarUrl: "https://cdn.example/avatar.jpg",
    waId: WATI_TEST_WA_ID,
    senderName: "coubbb",
    listReply: null,
    interactiveButtonReply: null,
    buttonReply: null,
    channelPhoneNumber: WATI_TEST_CHANNEL,
    ...overrides,
  };
}
