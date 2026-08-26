import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_SENDER_ACTION_TIMEOUT_MS,
  instagramSenderActionUrl,
  sendInstagramSenderAction,
  startInstagramAttendingIndicators,
  finishInstagramAttending,
} from "@/lib/meta/instagram-sender-actions";
import { getInstagramGraphSendConfig } from "@/lib/meta/instagram-send";

const config = {
  accessToken: "meta-ig-access-token-test",
  accountId: "17841400008460000",
  graphVersion: "v23.0",
};

const CREATOR_IGSID = "12334";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Instagram sender-action client", () => {
  it("posts mark_seen and typing_on to /me/messages with the creator IGSID", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await sendInstagramSenderAction({
      recipientId: CREATOR_IGSID,
      action: "mark_seen",
      config,
      deps: { fetchImpl },
    });
    await sendInstagramSenderAction({
      recipientId: CREATOR_IGSID,
      action: "typing_on",
      config,
      deps: { fetchImpl },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      const url = String(call[0]);
      const init = call[1];
      const body = JSON.parse(String(init?.body));
      expect(url).toBe(instagramSenderActionUrl(config));
      expect(url).toBe("https://graph.instagram.com/v23.0/me/messages");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer meta-ig-access-token-test",
      });
      expect(body.recipient).toEqual({ id: CREATOR_IGSID });
      expect(["mark_seen", "typing_on"]).toContain(body.sender_action);
      expect(body).not.toHaveProperty("message");
      expect(JSON.stringify(body)).not.toContain("Need help");
      expect(JSON.stringify(body)).not.toContain("Hi there");
    }
  });

  it("does not add an artificial typing delay", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../instagram-sender-actions.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bsleep\s*\(/);
    expect(source).toContain("INSTAGRAM_SENDER_ACTION_TIMEOUT_MS = 750");
  });

  it("uses the existing Instagram send config token and graph version", () => {
    const resolved = getInstagramGraphSendConfig({
      META_GRAPH_API_VERSION: "v23.0",
      META_IG_ACCESS_TOKEN: "meta-ig-access-token-test",
      META_IG_ACCOUNT_ID: "17841400008460000",
    });
    expect(resolved?.graphVersion).toBe("v23.0");
    expect(instagramSenderActionUrl(resolved!)).toContain("/me/messages");
  });

  it("rejects unsupported sender actions without calling Graph", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await sendInstagramSenderAction({
      recipientId: CREATOR_IGSID,
      action: "react",
      config,
      deps: { fetchImpl },
    });
    expect(result).toEqual({ ok: false, errorCode: "invalid_sender_action" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not retry and treats 401/403 as best-effort failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }),
    );
    const result = await sendInstagramSenderAction({
      recipientId: CREATOR_IGSID,
      action: "typing_on",
      config,
      deps: { fetchImpl },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("http_401");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts at 750ms and does not retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
      return new Response("{}", { status: 200 });
    });
    const started = Date.now();
    const result = await sendInstagramSenderAction({
      recipientId: CREATOR_IGSID,
      action: "mark_seen",
      config,
      deps: { fetchImpl },
    });
    expect(result).toMatchObject({ ok: false, errorCode: "timeout" });
    expect(Date.now() - started).toBeLessThan(INSTAGRAM_SENDER_ACTION_TIMEOUT_MS + 400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("turns typing off after attending even if typing_on failed", async () => {
    const actions: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      actions.push(String(body.sender_action));
      if (body.sender_action === "typing_on") {
        return new Response("{}", { status: 403 });
      }
      return new Response("{}", { status: 200 });
    });
    const session = startInstagramAttendingIndicators({
      recipientId: CREATOR_IGSID,
      config,
      deps: { fetchImpl },
    });
    await finishInstagramAttending(session);
    expect(actions).toContain("mark_seen");
    expect(actions).toContain("typing_on");
    expect(actions.at(-1)).toBe("typing_off");
  });

  it("sends typing_off exactly once across repeated finish calls", async () => {
    const actions: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      actions.push(String(body.sender_action));
      return new Response("{}", { status: 200 });
    });
    const session = startInstagramAttendingIndicators({
      recipientId: CREATOR_IGSID,
      config,
      deps: { fetchImpl },
    });
    const first = finishInstagramAttending(session);
    const second = finishInstagramAttending(session);
    expect(second).toBe(first);
    await Promise.all([first, second, finishInstagramAttending(session)]);
    expect(actions.filter((action) => action === "typing_off")).toHaveLength(1);
    await expect(finishInstagramAttending(session)).resolves.toBeUndefined();
    expect(actions.filter((action) => action === "typing_off")).toHaveLength(1);
  });
});
