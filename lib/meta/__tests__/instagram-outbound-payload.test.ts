import { describe, expect, it } from "vitest";
import {
  durableInstagramOutboundPayload,
  outboundPayloadLooksUnsafe,
  sanitizeInstagramOutboundPayload,
} from "@/lib/meta/instagram-outbound-payload";

describe("instagram outbound payload sanitizer", () => {
  it("keeps quick-reply titles and payload codes and drops secrets", () => {
    const sanitized = durableInstagramOutboundPayload({
      text: "Choose a path",
      rawPayload: {
        text: "Choose a path",
        quick_replies: [
          { content_type: "text", title: "I'm a creator", payload: "PERSONA_CREATOR" },
          { content_type: "text", title: "I'm a brand", payload: "PERSONA_BRAND" },
        ],
        access_token: "IGQW-secret",
        Authorization: "Bearer abc",
        profile: { username: "creator" },
      },
    });
    expect(sanitized).toEqual({
      text: "Choose a path",
      quick_replies: [
        { content_type: "text", title: "I'm a creator", payload: "PERSONA_CREATOR" },
        { content_type: "text", title: "I'm a brand", payload: "PERSONA_BRAND" },
      ],
    });
    expect(outboundPayloadLooksUnsafe(sanitized)).toBe(false);
  });

  it("does not persist a payload for plain text", () => {
    expect(
      durableInstagramOutboundPayload({
        text: "Thanks, we queued that for the team.",
      }),
    ).toBeNull();
  });

  it("drops http media urls from stored quick-reply payloads", () => {
    const sanitized = sanitizeInstagramOutboundPayload({
      text: "Pick one",
      quickReplies: [
        {
          content_type: "text",
          title: "Open",
          payload: "https://lookaside.fbsbx.com/ig/media",
        },
        { content_type: "text", title: "Creator", payload: "PERSONA_CREATOR" },
      ],
    });
    expect(sanitized?.quick_replies).toEqual([
      { content_type: "text", title: "Creator", payload: "PERSONA_CREATOR" },
    ]);
  });
});
