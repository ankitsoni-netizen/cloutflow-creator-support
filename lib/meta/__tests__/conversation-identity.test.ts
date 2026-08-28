import { describe, expect, it } from "vitest";
import {
  IDENTITY_AMBIGUOUS,
  IDENTITY_MISSING,
  activeTicketMatchesIdentity,
  allowOutboundReply,
  boundOutboundRecipient,
  channelIdentityFromInbound,
  classifyLegacyIdentity,
  conversationLookupIds,
  conversationRowMatchesIdentity,
  findActiveTicketForIdentity,
  instagramExternalConversationId,
  outboundIdentityAllowsReply,
  phaseAOutboundIdentityProven,
} from "@/lib/meta/conversation-identity";
import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { runWithIdentitySchemaPhase } from "@/lib/meta/identity-schema-phase";

const identity = {
  provider: META_INSTAGRAM_PROVIDER,
  channel: "instagram" as const,
  recipientAccountId: "page-1",
  externalContactId: "sender-a",
  externalConversationId: instagramExternalConversationId("page-1", "sender-a"),
};

describe("channelIdentityFromInbound", () => {
  it("fails closed without a stable sender id", () => {
    expect(
      channelIdentityFromInbound({
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        externalContactId: "",
        externalConversationId: "page-1",
        recipientAccountId: "page-1",
        phoneNumberId: null,
      }),
    ).toBeNull();
  });

  it("fails closed when Instagram sender.id is the receiving page", () => {
    expect(
      channelIdentityFromInbound({
        channel: "instagram",
        provider: META_INSTAGRAM_PROVIDER,
        externalContactId: "page-1",
        externalConversationId: "page-1",
        recipientAccountId: "page-1",
        phoneNumberId: null,
      }),
    ).toBeNull();
  });
});

describe("activeTicketMatchesIdentity", () => {
  it("requires the stable sender id; conversation id alone is not enough", () => {
    expect(
      activeTicketMatchesIdentity(
        {
          source_channel: "instagram",
          external_conversation_id: identity.externalConversationId,
          external_contact_id: "sender-b",
        },
        identity,
        "instagram",
      ),
    ).toBe(false);
  });

  it("accepts a legacy sender-only conversation id for the same sender", () => {
    expect(
      activeTicketMatchesIdentity(
        {
          source_channel: "instagram",
          external_conversation_id: "sender-a",
          external_contact_id: "sender-a",
        },
        identity,
        "instagram",
      ),
    ).toBe(true);
  });
});

describe("findActiveTicketForIdentity", () => {
  it("fails closed on missing identity", () => {
    const result = findActiveTicketForIdentity(
      [],
      { ...identity, externalContactId: "" },
      "instagram",
      () => true,
    );
    expect(result).toEqual({ errorCode: IDENTITY_MISSING });
  });

  it("fails closed when two active tickets match the same identity", () => {
    const result = findActiveTicketForIdentity(
      [
        {
          id: "t1",
          source_channel: "instagram",
          external_conversation_id: identity.externalConversationId,
          external_contact_id: "sender-a",
        },
        {
          id: "t2",
          source_channel: "instagram",
          external_conversation_id: "sender-a",
          external_contact_id: "sender-a",
        },
      ],
      identity,
      "instagram",
      () => true,
    );
    expect(result).toEqual({ errorCode: IDENTITY_AMBIGUOUS });
  });
});

describe("conversationLookupIds", () => {
  it("tries the scoped key before the legacy sender id", () => {
    expect(conversationLookupIds(identity)).toEqual([
      "page-1:sender-a",
      "sender-a",
    ]);
  });

  it("does not treat a page-id ticket as matching a different sender", () => {
    expect(
      activeTicketMatchesIdentity(
        {
          source_channel: "instagram",
          external_conversation_id: "page-1",
          external_contact_id: "sender-a",
        },
        {
          ...identity,
          externalContactId: "sender-b",
          externalConversationId: instagramExternalConversationId("page-1", "sender-b"),
        },
        "instagram",
      ),
    ).toBe(false);
    expect(
      activeTicketMatchesIdentity(
        {
          source_channel: "instagram",
          external_conversation_id: "page-1",
          external_contact_id: "sender-a",
        },
        identity,
        "instagram",
      ),
    ).toBe(false);
  });
});

describe("conversationRowMatchesIdentity", () => {
  it("rejects a page-id conversation belonging to another sender", () => {
    expect(
      conversationRowMatchesIdentity(
        {
          channel: "instagram",
          externalConversationId: "page-1",
          externalContactId: "sender-b",
        },
        identity,
      ),
    ).toBe(false);
  });
});

describe("boundOutboundRecipient", () => {
  it("returns the conversation-bound sender and rejects a mismatch", () => {
    expect(boundOutboundRecipient("sender-a", "sender-a")).toBe("sender-a");
    expect(boundOutboundRecipient("sender-a", "sender-b")).toBeNull();
    expect(boundOutboundRecipient(null, "sender-a")).toBeNull();
  });
});

describe("classifyLegacyIdentity", () => {
  it("backfills only when contact, receiving account, and a single matching webhook sender are proven", () => {
    expect(
      classifyLegacyIdentity({
        contactId: "sender-a",
        conversationId: "sender-a",
        recipientAccountId: "page-1",
        distinctWebhookSenderIds: ["sender-a"],
      }),
    ).toBe("unambiguous");
    expect(
      classifyLegacyIdentity({
        contactId: "sender-a",
        conversationId: "page-1:sender-a",
        recipientAccountId: null,
      }),
    ).toBe("unambiguous");
  });

  it("quarantines mixed webhook senders and treats unproven page-only keys as ambiguous", () => {
    expect(
      classifyLegacyIdentity({
        contactId: "sender-a",
        conversationId: "sender-a",
        recipientAccountId: "page-1",
        distinctWebhookSenderIds: ["sender-a", "sender-b"],
      }),
    ).toBe("quarantined");
    expect(
      classifyLegacyIdentity({
        contactId: "sender-a",
        conversationId: "page-1",
        recipientAccountId: "page-1",
      }),
    ).toBe("ambiguous");
    expect(
      classifyLegacyIdentity({
        contactId: "sender-a",
        conversationId: "page-1",
        recipientAccountId: "page-1",
        distinctWebhookSenderIds: ["sender-a"],
      }),
    ).toBe("unambiguous");
  });
});

describe("outboundIdentityAllowsReply", () => {
  it("fails closed unless the status is unambiguous", () => {
    expect(outboundIdentityAllowsReply(null)).toBe(false);
    expect(outboundIdentityAllowsReply("unambiguous")).toBe(true);
    expect(outboundIdentityAllowsReply("ambiguous")).toBe(false);
    expect(outboundIdentityAllowsReply("quarantined")).toBe(false);
  });
});

describe("phaseAOutboundIdentityProven", () => {
  it("accepts legacy sender keys and canonical scoped keys", () => {
    expect(
      phaseAOutboundIdentityProven({
        ticketContactId: "sender-a",
        ticketConversationId: "sender-a",
      }),
    ).toBe(true);
    expect(
      phaseAOutboundIdentityProven({
        ticketContactId: "sender-a",
        ticketConversationId: "page-1:sender-a",
      }),
    ).toBe(true);
  });

  it("rejects page-only keys, missing contacts, and mismatches", () => {
    expect(
      phaseAOutboundIdentityProven({
        ticketContactId: "sender-a",
        ticketConversationId: "page-1",
      }),
    ).toBe(false);
    expect(
      phaseAOutboundIdentityProven({
        ticketContactId: null,
        ticketConversationId: "sender-a",
      }),
    ).toBe(false);
    expect(
      phaseAOutboundIdentityProven({
        ticketContactId: "sender-a",
        conversationContactId: "sender-b",
        conversationId: "sender-a",
      }),
    ).toBe(false);
  });
});

describe("allowOutboundReply", () => {
  it("uses structural proof in Phase A and identity_status in Phase C", () => {
    expect(
      allowOutboundReply({
        ticketContactId: "sender-a",
        ticketConversationId: "sender-a",
      }),
    ).toBe(true);
    expect(
      allowOutboundReply({
        ticketContactId: "sender-a",
        ticketConversationId: "page-1",
      }),
    ).toBe(false);
    runWithIdentitySchemaPhase("c", () => {
      expect(
        allowOutboundReply({
          identityStatus: "unambiguous",
          ticketContactId: "sender-a",
          ticketConversationId: "page-1",
        }),
      ).toBe(true);
      expect(
        allowOutboundReply({
          identityStatus: "quarantined",
          ticketContactId: "sender-a",
          ticketConversationId: "sender-a",
        }),
      ).toBe(false);
      expect(
        allowOutboundReply({
          identityStatus: null,
          ticketContactId: "sender-a",
          ticketConversationId: "sender-a",
        }),
      ).toBe(false);
    });
  });
});
