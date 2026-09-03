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
  decidePhaseACanonicalIdentityPromotion,
  findActiveTicketForIdentity,
  findConversationForIdentity,
  instagramExternalConversationId,
  isPhaseACanonicalNullIdentityRow,
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
    const assertAmbiguous = () => {
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
    };
    runWithIdentitySchemaPhase("a", assertAmbiguous);
    runWithIdentitySchemaPhase("c", assertAmbiguous);
  });

  it("selects an exact unambiguous canonical ticket and ignores an ineligible legacy ticket", () => {
    runWithIdentitySchemaPhase("c", () => {
      const result = findActiveTicketForIdentity(
        [
          {
            id: "t-canonical",
            source_channel: "instagram",
            external_conversation_id: identity.externalConversationId,
            external_contact_id: "sender-a",
            recipient_account_id: "page-1",
            identity_status: "unambiguous",
            status: "open",
          },
          {
            id: "t-legacy",
            source_channel: "instagram",
            external_conversation_id: "sender-a",
            external_contact_id: "sender-a",
            recipient_account_id: "page-1",
            identity_status: "ambiguous",
            status: "open",
          },
        ],
        identity,
        "instagram",
        (row) => row.status === "open",
      );
      expect(result).toMatchObject({ id: "t-canonical" });
    });
  });

  it("does not attach to a resolved, foreign, or quarantined ticket", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        findActiveTicketForIdentity(
          [
            {
              id: "t-resolved",
              source_channel: "instagram",
              external_conversation_id: identity.externalConversationId,
              external_contact_id: "sender-a",
              identity_status: "unambiguous",
              status: "resolved",
            },
          ],
          identity,
          "instagram",
          (row) =>
            ["open", "in_progress", "waiting"].includes(String(row.status)),
        ),
      ).toBeNull();
      expect(
        findActiveTicketForIdentity(
          [
            {
              id: "t-foreign",
              source_channel: "instagram",
              external_conversation_id: identity.externalConversationId,
              external_contact_id: "sender-b",
              identity_status: "unambiguous",
              status: "open",
            },
          ],
          identity,
          "instagram",
          () => true,
        ),
      ).toBeNull();
      expect(
        findActiveTicketForIdentity(
          [
            {
              id: "t-quarantined",
              source_channel: "instagram",
              external_conversation_id: "sender-a",
              external_contact_id: "sender-a",
              identity_status: "quarantined",
              status: "open",
            },
          ],
          identity,
          "instagram",
          () => true,
        ),
      ).toEqual({ errorCode: IDENTITY_AMBIGUOUS });
    });
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

describe("findConversationForIdentity Phase C precedence", () => {
  const canonical = {
    id: "convo-canonical",
    channel: "instagram" as const,
    provider: META_INSTAGRAM_PROVIDER,
    recipientAccountId: "page-1",
    externalContactId: "sender-a",
    externalConversationId: identity.externalConversationId,
    identityStatus: "unambiguous" as const,
  };
  const legacyAmbiguous = {
    id: "convo-legacy",
    channel: "instagram" as const,
    provider: META_INSTAGRAM_PROVIDER,
    recipientAccountId: "page-1",
    externalContactId: "sender-a",
    externalConversationId: "sender-a",
    identityStatus: "ambiguous" as const,
  };

  it("selects the exact canonical unambiguous row and ignores an ambiguous legacy row", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        findConversationForIdentity([canonical, legacyAmbiguous], identity),
      ).toMatchObject({ id: "convo-canonical" });
    });
  });

  it("ignores a quarantined legacy row when a canonical unambiguous row exists", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        findConversationForIdentity(
          [
            canonical,
            { ...legacyAmbiguous, identityStatus: "quarantined" },
          ],
          identity,
        ),
      ).toMatchObject({ id: "convo-canonical" });
    });
  });

  it("fails closed when the canonical row is itself ambiguous", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        findConversationForIdentity(
          [
            { ...canonical, identityStatus: "ambiguous" },
            legacyAmbiguous,
          ],
          identity,
        ),
      ).toEqual({ errorCode: IDENTITY_AMBIGUOUS });
    });
  });

  it("fails closed when two exact canonical unambiguous rows exist", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        findConversationForIdentity(
          [canonical, { ...canonical, id: "convo-canonical-2" }],
          identity,
        ),
      ).toEqual({ errorCode: IDENTITY_AMBIGUOUS });
    });
  });

  it("upgrades exactly one unambiguous legacy owner when no canonical row exists", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        findConversationForIdentity(
          [{ ...legacyAmbiguous, identityStatus: "unambiguous" }],
          identity,
        ),
      ).toMatchObject({ id: "convo-legacy" });
    });
  });

  it("fails closed when only an ambiguous legacy row exists", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(findConversationForIdentity([legacyAmbiguous], identity)).toEqual({
        errorCode: IDENTITY_AMBIGUOUS,
      });
    });
  });

  it("does not apply Phase C precedence in Phase A", () => {
    runWithIdentitySchemaPhase("a", () => {
      expect(
        findConversationForIdentity([canonical, legacyAmbiguous], identity),
      ).toEqual({ errorCode: IDENTITY_AMBIGUOUS });
    });
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
    runWithIdentitySchemaPhase("a", () => {
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
    });
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

describe("Phase A canonical null-identity promotion eligibility", () => {
  const phaseARow = {
    channel: "instagram",
    provider: null,
    recipientAccountId: null,
    identityStatus: null,
    ticketId: null,
    externalContactId: "sender-a",
    externalConversationId: instagramExternalConversationId("page-1", "sender-a"),
  };

  it("accepts exactly one canonical null-identity row in Phase C", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(isPhaseACanonicalNullIdentityRow(phaseARow, identity)).toBe(true);
      expect(
        decidePhaseACanonicalIdentityPromotion([phaseARow], identity, {
          hasCompetingTicketCandidate: false,
        }),
      ).toEqual({ outcome: "promote", row: phaseARow });
    });
  });

  it("rejects sender-only, stamped, mismatched, and competing rows", () => {
    runWithIdentitySchemaPhase("c", () => {
      expect(
        isPhaseACanonicalNullIdentityRow(
          { ...phaseARow, externalConversationId: "sender-a" },
          identity,
        ),
      ).toBe(false);
      expect(
        isPhaseACanonicalNullIdentityRow(
          { ...phaseARow, identityStatus: "ambiguous" },
          identity,
        ),
      ).toBe(false);
      expect(
        isPhaseACanonicalNullIdentityRow(
          { ...phaseARow, externalContactId: "sender-b" },
          identity,
        ),
      ).toBe(false);
      expect(
        decidePhaseACanonicalIdentityPromotion([phaseARow], identity, {
          hasCompetingTicketCandidate: true,
        }),
      ).toEqual({ outcome: "reject" });
      expect(
        decidePhaseACanonicalIdentityPromotion(
          [phaseARow, { ...phaseARow, id: "other", externalConversationId: "sender-a" }],
          identity,
          { hasCompetingTicketCandidate: false },
        ),
      ).toEqual({ outcome: "reject" });
    });
  });

  it("does not promote in Phase A", () => {
    runWithIdentitySchemaPhase("a", () => {
      expect(isPhaseACanonicalNullIdentityRow(phaseARow, identity)).toBe(false);
    });
  });
});
