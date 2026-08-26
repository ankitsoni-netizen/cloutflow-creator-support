import { describe, expect, it } from "vitest";
import { isUnauthenticatedProxyPath } from "@/lib/proxy-public-paths";

describe("isUnauthenticatedProxyPath", () => {
  it("keeps the Meta webhook publicly reachable", () => {
    expect(isUnauthenticatedProxyPath("/api/webhooks/meta")).toBe(true);
    expect(isUnauthenticatedProxyPath("/api/webhooks/meta/instagram")).toBe(
      true,
    );
  });

  it("keeps the WATI webhook publicly reachable", () => {
    expect(isUnauthenticatedProxyPath("/api/webhooks/wati")).toBe(true);
  });

  it("keeps existing public intake paths unauthenticated", () => {
    expect(isUnauthenticatedProxyPath("/help")).toBe(true);
    expect(isUnauthenticatedProxyPath("/api/public/website-tickets")).toBe(
      true,
    );
  });

  it("does not weaken CRM authentication", () => {
    expect(isUnauthenticatedProxyPath("/")).toBe(false);
    expect(isUnauthenticatedProxyPath("/login")).toBe(false);
    expect(isUnauthenticatedProxyPath("/team")).toBe(false);
    expect(isUnauthenticatedProxyPath("/api/whatsapp/tickets")).toBe(false);
    expect(isUnauthenticatedProxyPath("/api/tickets/abc/whatsapp-reply")).toBe(
      false,
    );
  });
});
