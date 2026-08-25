import { describe, expect, it } from "vitest";
import { instagramTicketEmailSubject } from "@/lib/email/instagram-ticket-mail";

describe("Instagram ticket email subject", () => {
  it("uses the ticket-code subject consistently", () => {
    expect(instagramTicketEmailSubject("CF-2026-00001")).toBe(
      "[CF-2026-00001] Cloutflow Creator Support",
    );
  });
});
