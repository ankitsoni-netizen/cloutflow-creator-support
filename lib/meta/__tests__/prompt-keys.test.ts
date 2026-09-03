import { describe, expect, it } from "vitest";
import {
  channelCrmReplyKey,
  channelOutboundKey,
  channelTicketCreatedKey,
  channelTicketEmailSentKey,
  chatbotOutboundIdempotencyKey,
  isCreatorConfirmPromptKey,
  isSameSessionPrompt,
  parseChatbotIdempotencyKey,
  PERSONA_PROMPT,
} from "@/lib/meta/prompt-keys";

describe("chatbot outbound idempotency keys", () => {
  it("scopes keys by conversation, session version, and effect type", () => {
    const first = chatbotOutboundIdempotencyKey("convo-1", 1, "intake:platform_details");
    const restarted = chatbotOutboundIdempotencyKey(
      "convo-1",
      2,
      "intake:platform_details",
    );
    expect(first).toBe("ig:prompt:convo-1:v1:intake:platform_details");
    expect(restarted).not.toBe(first);
    expect(parseChatbotIdempotencyKey(restarted)).toEqual({
      prefix: "ig",
      conversationId: "convo-1",
      intakeSessionVersion: 2,
      effectType: "intake:platform_details",
    });
    expect(
      isSameSessionPrompt({
        idempotencyKey: first,
        conversationId: "convo-1",
        intakeSessionVersion: 2,
        effectType: "intake:platform_details",
      }),
    ).toBe(false);
  });

  it("keeps WhatsApp prompt and ticket keys distinct from Instagram", () => {
    expect(
      chatbotOutboundIdempotencyKey("convo-1", 1, "route", "wa"),
    ).toBe("wa:prompt:convo-1:v1:route");
    expect(
      channelOutboundKey("wa", "convo-1", 1, "intake:creator_details"),
    ).toBe("wa:prompt:convo-1:v1:intake:creator_details");
    expect(channelTicketCreatedKey("wa", "ticket-1")).toBe(
      "ticket:ticket-1:created",
    );
    expect(
      channelOutboundKey("wa", "convo-1", 1, "ticket:ticket-1:created"),
    ).toBe("wa:ticket:ticket-1:created");
    expect(
      channelOutboundKey("wa", "convo-1", 1, "ticket:ticket-1:created"),
    ).toBe("wa:ticket:ticket-1:created");
    expect(channelCrmReplyKey("wa", "comment-1")).toBe("wa:crm:comment-1");
    expect(channelTicketCreatedKey("ig", "ticket-1")).toBe(
      "ticket_created:ticket-1",
    );
    expect(channelTicketEmailSentKey("ig", "ticket-1")).toBe(
      "ticket_email_sent:ticket-1",
    );
    expect(channelCrmReplyKey("ig", "c1")).toBe("ig:crm:c1");
    expect(isCreatorConfirmPromptKey(PERSONA_PROMPT.creatorConfirm)).toBe(true);
    expect(
      isCreatorConfirmPromptKey(`${PERSONA_PROMPT.creatorConfirm}:retry:mid.1`),
    ).toBe(true);
    expect(isCreatorConfirmPromptKey("ticket_created:ticket-1")).toBe(false);
  });
});
