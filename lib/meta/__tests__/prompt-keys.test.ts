import { describe, expect, it } from "vitest";
import {
  chatbotOutboundIdempotencyKey,
  isSameSessionPrompt,
  parseChatbotIdempotencyKey,
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
});
