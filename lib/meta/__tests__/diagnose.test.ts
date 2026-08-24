import { describe, expect, it } from "vitest";
import { diagnoseMetaWebhookPayload } from "@/lib/meta/diagnose";
import { normalizeMetaWebhookPayload } from "@/lib/meta/normalize";
import {
  instagramLoginDashboardTestPayload,
  instagramLoginMessagesChangesPayload,
  instagramLoginMessagesFieldValuePayload,
  instagramLoginMessagesPayload,
  instagramLoginMessagesWrappedArrayPayload,
  instagramTextPayload,
} from "@/lib/meta/__tests__/fixtures";

describe("diagnoseMetaWebhookPayload — Instagram Login messages", () => {
  it("describes Meta's current Instagram Login messaging envelope", () => {
    const payload = instagramLoginMessagesPayload();
    expect(normalizeMetaWebhookPayload(payload)).toHaveLength(1);
    expect(diagnoseMetaWebhookPayload(payload)).toEqual({
      objectType: "instagram",
      entryCount: 1,
      messagingEventCount: 1,
      hasMessage: true,
      hasSender: true,
      hasRecipient: true,
      hasMessageId: true,
      ignoredReason: null,
    });
  });

  it("explains dashboard test DMs as echoes that normalize to zero events", () => {
    const payload = instagramLoginDashboardTestPayload();
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
    expect(diagnoseMetaWebhookPayload(payload)).toMatchObject({
      objectType: "instagram",
      entryCount: 1,
      messagingEventCount: 1,
      hasMessage: true,
      hasSender: true,
      hasRecipient: true,
      hasMessageId: true,
      ignoredReason: "echo",
    });
  });

  it("explains a top-level array envelope as a wrapped payload", () => {
    const payload = instagramLoginMessagesWrappedArrayPayload();
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
    expect(diagnoseMetaWebhookPayload(payload)).toMatchObject({
      objectType: "array",
      entryCount: 1,
      messagingEventCount: 1,
      hasMessage: true,
      hasSender: true,
      hasRecipient: true,
      hasMessageId: true,
      ignoredReason: "payload_wrapped_array",
    });
  });

  it("explains Instagram Login field/value messages that lack entry.messaging", () => {
    const payload = instagramLoginMessagesFieldValuePayload();
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
    expect(diagnoseMetaWebhookPayload(payload)).toMatchObject({
      objectType: "instagram",
      entryCount: 1,
      messagingEventCount: 1,
      hasMessage: true,
      hasSender: true,
      hasRecipient: true,
      hasMessageId: true,
      ignoredReason: "instagram_field_value_shape",
    });
  });

  it("explains Graph changes[].field=messages envelopes", () => {
    const payload = instagramLoginMessagesChangesPayload();
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
    expect(diagnoseMetaWebhookPayload(payload)).toMatchObject({
      objectType: "instagram",
      entryCount: 1,
      messagingEventCount: 1,
      hasMessage: true,
      hasSender: true,
      hasRecipient: true,
      hasMessageId: true,
      ignoredReason: "instagram_changes_shape",
    });
  });

  it("never includes payload identifiers or message text in the diagnostic object", () => {
    const diagnostic = diagnoseMetaWebhookPayload(
      instagramLoginMessagesPayload({
        senderId: "SECRET-SENDER-ID",
        text: "Please help with invoice 999",
      }),
    );
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("SECRET-SENDER-ID");
    expect(serialized).not.toContain("Please help with invoice 999");
    expect(serialized).not.toContain("MESSAGE-ID-LOGIN");
  });

  it("reports missing structural fields on the legacy messaging envelope", () => {
    const payload = instagramTextPayload();
    delete (payload.entry[0].messaging[0] as { sender?: unknown }).sender;
    expect(diagnoseMetaWebhookPayload(payload)).toMatchObject({
      hasSender: false,
      ignoredReason: "missing_sender",
    });
  });
});
