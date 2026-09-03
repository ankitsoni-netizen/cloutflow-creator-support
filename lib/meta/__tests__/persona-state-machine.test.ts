import { describe, expect, it } from "vitest";
import { reduceInstagramConversation } from "@/lib/meta/conversation-machine";
import {
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  CREATOR_TICKET_EDIT_PAYLOAD,
  FLOW_BACK_PAYLOAD,
  FLOW_CANCEL_PAYLOAD,
  PERSONA_AGENCY_PAYLOAD,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_OTHER_PAYLOAD,
} from "@/lib/meta/instagram-persona-copy";
import { CAMPAIGN_MONTH_NO_PAYLOAD, CAMPAIGN_MONTH_YES_PAYLOAD } from "@/lib/meta/month-confirmation";
import { INTAKE_STATES_BLOCKED_AFTER_TICKET } from "@/lib/meta/ticket-finalization";
import { emptyConversationSnapshot } from "@/lib/meta/conversation-machine";

function signal(
  text: string,
  options: { payload?: string | null; messageId: string },
) {
  return {
    text,
    quickReplyPayload: options.payload ?? null,
    timestamp: "2026-09-03T10:00:00.000Z",
    messageId: options.messageId,
  };
}

function reduce(
  snapshot: ReturnType<typeof emptyConversationSnapshot>,
  text: string,
  payload: string | null,
  messageId: string,
) {
  return reduceInstagramConversation(snapshot, signal(text, { payload, messageId }));
}

describe("persona legal-action state machine", () => {
  it("create_ticket occurs only from Raise ticket and never returns to intake after commit", () => {
    let snapshot = emptyConversationSnapshot();
    const steps: Array<{
      text: string;
      payload: string | null;
      id: string;
      allowTicket?: boolean;
    }> = [
      { text: "Hi", payload: null, id: "m0" },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD, id: "m1" },
      { text: "Existing campaign", payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD, id: "m2" },
      { text: "Campaign issue", payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD, id: "m3" },
      { text: "Acme, August 2026, riya@example.com", payload: null, id: "m4" },
      { text: "No", payload: CAMPAIGN_MONTH_NO_PAYLOAD, id: "m5" },
      { text: "September 2026", payload: null, id: "m6" },
      { text: "Yes", payload: CAMPAIGN_MONTH_YES_PAYLOAD, id: "m7" },
      { text: "Edit details", payload: CREATOR_TICKET_EDIT_PAYLOAD, id: "m8" },
      { text: "Nike, October 2026, amit@example.com", payload: null, id: "m9" },
      { text: "Yes", payload: CAMPAIGN_MONTH_YES_PAYLOAD, id: "m10" },
      {
        text: "Raise ticket",
        payload: CREATOR_TICKET_CONFIRM_PAYLOAD,
        id: "m11",
        allowTicket: true,
      },
      {
        text: "Raise ticket",
        payload: CREATOR_TICKET_CONFIRM_PAYLOAD,
        id: "m13",
        allowTicket: true,
      },
    ];

    let ticketEffects = 0;
    for (const step of steps) {
      const result = reduce(snapshot, step.text, step.payload, step.id);
      const created = result.effects.filter((effect) => effect.type === "create_ticket");
      ticketEffects += created.length;
      if (created.length > 0) {
        expect(step.allowTicket).toBe(true);
        snapshot = {
          ...result.snapshot,
          ticketId: "ticket-1",
          ticketStatus: "open",
          ticketCode: "CF-2026-00001",
        };
        expect(INTAKE_STATES_BLOCKED_AFTER_TICKET.has(snapshot.state)).toBe(false);
        continue;
      }
      snapshot = result.snapshot;
      if (snapshot.ticketId) {
        expect(INTAKE_STATES_BLOCKED_AFTER_TICKET.has(snapshot.state)).toBe(false);
      }
    }
    expect(ticketEffects).toBe(2);
    expect(snapshot.ticketId).toBe("ticket-1");
  });

  it("month No preserves brand/email and Edit details clears them", () => {
    let snapshot = emptyConversationSnapshot();
    for (const [index, step] of [
      { text: "Hi", payload: null },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD },
      { text: "Existing campaign", payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD },
      { text: "Payment issue", payload: CREATOR_PAYMENT_ISSUE_PAYLOAD },
      { text: "Acme, August 2026, riya@example.com", payload: null },
    ].entries()) {
      snapshot = reduce(snapshot, step.text, step.payload, `n${index}`).snapshot;
    }
    const denied = reduce(snapshot, "No", CAMPAIGN_MONTH_NO_PAYLOAD, "n-no");
    expect(denied.snapshot.state).toBe("awaiting_month_confirmation");
    expect(denied.snapshot.collected.brandName).toBe("Acme");
    expect(denied.snapshot.collected.email).toBe("riya@example.com");
    expect(denied.snapshot.collected.campaignMonth).toBeNull();
    expect(denied.effects.some((effect) => effect.type === "create_ticket")).toBe(false);

    snapshot = reduce(denied.snapshot, "Yes", CAMPAIGN_MONTH_YES_PAYLOAD, "n-yes-skip").snapshot;
    // month still null, so Yes should not ticket
    expect(denied.snapshot.collected.igPersona).toBe("creator");

    snapshot = emptyConversationSnapshot();
    for (const [index, step] of [
      { text: "Hi", payload: null },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD },
      { text: "Existing campaign", payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD },
      { text: "Campaign issue", payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD },
      { text: "Acme, August 2026, riya@example.com", payload: null },
      { text: "Yes", payload: CAMPAIGN_MONTH_YES_PAYLOAD },
    ].entries()) {
      snapshot = reduce(snapshot, step.text, step.payload, `e${index}`).snapshot;
    }
    const edited = reduce(snapshot, "Edit details", CREATOR_TICKET_EDIT_PAYLOAD, "e-edit");
    expect(edited.snapshot.state).toBe("creator_campaign_details");
    expect(edited.snapshot.collected.igPersona).toBe("creator");
    expect(edited.snapshot.collected.igIssueCategory).toBe("campaign");
    expect(edited.snapshot.collected.brandName).toBeNull();
    expect(edited.snapshot.collected.email).toBeNull();
    expect(edited.snapshot.collected.campaignMonth).toBeNull();
    expect(edited.snapshot.collected.campaignName).toBeNull();
  });

  it("cancel and non-ticket personas never emit create_ticket", () => {
    const brand = reduce(
      reduce(emptyConversationSnapshot(), "Hi", null, "b0").snapshot,
      "I'm a brand",
      PERSONA_BRAND_PAYLOAD,
      "b1",
    );
    expect(brand.effects.some((effect) => effect.type === "create_ticket")).toBe(false);

    const agency = reduce(
      reduce(emptyConversationSnapshot(), "Hi", null, "a0").snapshot,
      "I'm an agency",
      PERSONA_AGENCY_PAYLOAD,
      "a1",
    );
    expect(agency.effects.some((effect) => effect.type === "create_ticket")).toBe(false);

    const other = reduce(
      reduce(emptyConversationSnapshot(), "Hi", null, "o0").snapshot,
      "Something else",
      PERSONA_OTHER_PAYLOAD,
      "o1",
    );
    expect(other.effects.some((effect) => effect.type === "create_ticket")).toBe(false);

    let snapshot = emptyConversationSnapshot();
    snapshot = reduce(snapshot, "Hi", null, "c0").snapshot;
    snapshot = reduce(snapshot, "I'm a creator", PERSONA_CREATOR_PAYLOAD, "c1").snapshot;
    const cancelled = reduce(snapshot, "Cancel", FLOW_CANCEL_PAYLOAD, "c2");
    expect(cancelled.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
    expect(cancelled.snapshot.ticketId).toBeNull();

    const back = reduce(snapshot, "back", FLOW_BACK_PAYLOAD, "c3");
    expect(back.effects.some((effect) => effect.type === "create_ticket")).toBe(false);
  });

  it("Go back clears downstream campaign and issue fields", () => {
    let snapshot = emptyConversationSnapshot();
    for (const [index, step] of [
      { text: "Hi", payload: null },
      { text: "I'm a creator", payload: PERSONA_CREATOR_PAYLOAD },
      { text: "Existing campaign", payload: CREATOR_EXISTING_CAMPAIGN_PAYLOAD },
      { text: "Campaign issue", payload: CREATOR_CAMPAIGN_ISSUE_PAYLOAD },
      { text: "Acme, August 2026, riya@example.com", payload: null },
    ].entries()) {
      snapshot = reduce(snapshot, step.text, step.payload, `g${index}`).snapshot;
    }
    expect(snapshot.state).toBe("awaiting_month_confirmation");
    snapshot = reduce(snapshot, "back", FLOW_BACK_PAYLOAD, "g-back-month").snapshot;
    expect(snapshot.state).toBe("creator_campaign_details");

    const fromDetails = reduce(snapshot, "back", FLOW_BACK_PAYLOAD, "g-back-details");
    expect(fromDetails.snapshot.state).toBe("awaiting_creator_issue_category");
    expect(fromDetails.snapshot.collected.brandName).toBeNull();
    expect(fromDetails.snapshot.collected.email).toBeNull();
    expect(fromDetails.snapshot.collected.campaignMonth).toBeNull();
    expect(fromDetails.snapshot.collected.igIssueCategory).toBe("campaign");

    const fromIssue = reduce(
      fromDetails.snapshot,
      "back",
      FLOW_BACK_PAYLOAD,
      "g-back-issue",
    );
    expect(fromIssue.snapshot.state).toBe("awaiting_creator_reason");
    expect(fromIssue.snapshot.collected.igIssueCategory).toBeNull();
    expect(fromIssue.snapshot.collected.brandName).toBeNull();
    expect(fromIssue.effects.some((effect) => effect.type === "create_ticket")).toBe(
      false,
    );
  });
});
