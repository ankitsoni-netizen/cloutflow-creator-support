import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { META_WEBHOOK_EVENT_RECEIVED } from "@/lib/meta/constants";
import type { InstagramIngestStore } from "@/lib/meta/instagram-ingest";
import {
  handleInstagramWebhookGet,
  handleInstagramWebhookPost,
} from "@/lib/meta/instagram-webhook";
import {
  instagramLoginDashboardTestPayload,
  instagramLoginMessagesPayload,
  instagramTextPayload,
  whatsappStatusPayload,
  whatsappTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import { GET, POST, runtime } from "@/app/api/webhooks/meta/instagram/route";
import { NextRequest } from "next/server";

const VERIFY_TOKEN = "meta-ig-verify-token";
const APP_SECRET = "meta-app-secret-test";
const IG_APP_SECRET = "meta-ig-app-secret-test";
const UNKNOWN_SECRET = "unknown-meta-app-secret";

function testEnv(): Record<string, string | undefined> {
  return {
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: APP_SECRET,
  };
}

function dualSecretEnv(): Record<string, string | undefined> {
  return {
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: APP_SECRET,
    META_IG_APP_SECRET: IG_APP_SECRET,
  };
}

function getRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/webhooks/meta/instagram");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { method: "GET" });
}

function sign(raw: string, secret = APP_SECRET): string {
  const hex = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return `sha256=${hex}`;
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/webhooks/meta/instagram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: raw,
  });
}

function signedPost(body: unknown, secret = APP_SECRET): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return postRequest(body, { "x-hub-signature-256": sign(raw, secret) });
}

function loggedText(errorSpy: { mock: { calls: unknown[][] } }): string {
  return errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
}

function stubStore(): InstagramIngestStore {
  return {} as InstagramIngestStore;
}

describe("instagram webhook GET", () => {
  it("returns the raw challenge when META_WEBHOOK_VERIFY_TOKEN matches", async () => {
    const response = handleInstagramWebhookGet(
      getRequest({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "ig-challenge-99",
      }),
      { env: testEnv() },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ig-challenge-99");
  });

  it("returns 403 for an invalid verify token and never echoes the configured token", async () => {
    const response = handleInstagramWebhookGet(
      getRequest({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "ig-challenge-99",
      }),
      { env: testEnv() },
    );
    const body = await response.text();
    expect(response.status).toBe(403);
    expect(body).not.toContain(VERIFY_TOKEN);
    expect(body).not.toBe("ig-challenge-99");
  });

  it("returns 403 when hub params are missing", async () => {
    const response = handleInstagramWebhookGet(getRequest(), { env: testEnv() });
    expect(response.status).toBe(403);
  });
});

describe("instagram webhook POST", () => {
  it("returns 401 when the signature is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ingest = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const response = await handleInstagramWebhookPost(
      postRequest(instagramTextPayload()),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(401);
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("signature_missing");
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(IG_APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toMatch(/sha256=/i);
    ingest.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns 401 when the signature is invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const invalidSignature = sign("{}", "other");
    const response = await handleInstagramWebhookPost(
      postRequest(instagramTextPayload(), {
        "x-hub-signature-256": invalidSignature,
      }),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(401);
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("signature_invalid");
    expect(logged).not.toContain(invalidSignature);
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(IG_APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toMatch(/sha256=/i);
    errorSpy.mockRestore();
  });

  it("accepts a signature computed with META_IG_APP_SECRET", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ingestSpy = vi
      .spyOn(
        await import("@/lib/meta/instagram-ingest"),
        "ingestInstagramInboundMessage",
      )
      .mockImplementation(async () => ({ outcome: "stored" }));

    const response = await handleInstagramWebhookPost(
      signedPost(instagramTextPayload(), IG_APP_SECRET),
      { env: dualSecretEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(ingestSpy).toHaveBeenCalled();
    const logged = loggedText(errorSpy);
    expect(logged).not.toContain(IG_APP_SECRET);
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toMatch(/sha256=/i);
    ingestSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("accepts a signature computed with the parent META_APP_SECRET", async () => {
    const ingestSpy = vi
      .spyOn(
        await import("@/lib/meta/instagram-ingest"),
        "ingestInstagramInboundMessage",
      )
      .mockImplementation(async () => ({ outcome: "stored" }));

    const response = await handleInstagramWebhookPost(
      signedPost(instagramTextPayload(), APP_SECRET),
      { env: dualSecretEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(200);
    expect(ingestSpy).toHaveBeenCalled();
    ingestSpy.mockRestore();
  });

  it("returns 401 for an unknown secret and does not log secrets or payload content", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = instagramTextPayload();
    const unknownSignature = sign(JSON.stringify(payload), UNKNOWN_SECRET);
    const response = await handleInstagramWebhookPost(
      postRequest(payload, { "x-hub-signature-256": unknownSignature }),
      { env: dualSecretEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(401);
    const logged = loggedText(errorSpy);
    expect(logged).toContain("signature_invalid");
    expect(logged).not.toContain(unknownSignature);
    expect(logged).not.toContain(UNKNOWN_SECRET);
    expect(logged).not.toContain(IG_APP_SECRET);
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toMatch(/sha256=/i);
    expect(logged).not.toContain("Need help with a campaign");
    errorSpy.mockRestore();
  });

  it("accepts a valid signature and stores an Instagram DM", async () => {
    const store = stubStore();
    const ingestSpy = vi
      .spyOn(
        await import("@/lib/meta/instagram-ingest"),
        "ingestInstagramInboundMessage",
      )
      .mockImplementation(async () => ({ outcome: "stored" }));

    const response = await handleInstagramWebhookPost(
      signedPost(instagramTextPayload()),
      { env: testEnv(), instagramStore: store },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(ingestSpy).toHaveBeenCalled();
    ingestSpy.mockRestore();
  });

  it("returns 400 for malformed JSON after a valid signature", async () => {
    const raw = "{not-json";
    const response = await handleInstagramWebhookPost(
      postRequest(raw, { "x-hub-signature-256": sign(raw) }),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(400);
  });

  it("ignores unknown and non-Instagram events with 200", async () => {
    const ingestSpy = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const unknown = await handleInstagramWebhookPost(
      signedPost({ object: "page", entry: [] }),
      { env: testEnv(), instagramStore: stubStore() },
    );
    const whatsapp = await handleInstagramWebhookPost(
      signedPost(whatsappTextPayload()),
      { env: testEnv(), instagramStore: stubStore() },
    );
    const status = await handleInstagramWebhookPost(
      signedPost(whatsappStatusPayload()),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(unknown.status).toBe(200);
    expect(whatsapp.status).toBe(200);
    expect(status.status).toBe(200);
    expect(ingestSpy).not.toHaveBeenCalled();
    ingestSpy.mockRestore();
  });

  it("does not send typing indicators for ignored Meta events", async () => {
    const sender = vi.spyOn(
      await import("@/lib/meta/instagram-sender-actions"),
      "sendInstagramSenderAction",
    );
    const unknown = await handleInstagramWebhookPost(
      signedPost({ object: "page", entry: [] }),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(unknown.status).toBe(200);
    expect(sender).not.toHaveBeenCalled();
    sender.mockRestore();
  });

  it("returns 200 for echo Instagram messages without chatbot ingest", async () => {
    const ingestSpy = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const echoSpy = vi
      .spyOn(await import("@/lib/meta/instagram-echo"), "ingestInstagramEcho")
      .mockImplementation(async () => ({ outcome: "stored" }));
    const response = await handleInstagramWebhookPost(
      signedPost(instagramTextPayload({ isEcho: true })),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(200);
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(echoSpy).toHaveBeenCalled();
    ingestSpy.mockRestore();
    echoSpy.mockRestore();
  });

  it("logs privacy-safe diagnostics for Instagram Login messages that normalize to zero events", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const ingestSpy = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const echoSpy = vi
      .spyOn(await import("@/lib/meta/instagram-echo"), "ingestInstagramEcho")
      .mockImplementation(async () => ({ outcome: "stored" }));
    const payload = instagramLoginDashboardTestPayload();
    const response = await handleInstagramWebhookPost(signedPost(payload), {
      env: testEnv(),
      instagramStore: stubStore(),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(echoSpy).toHaveBeenCalled();
    const logged = infoSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("meta webhook normalize diagnostic");
    expect(logged).toContain("\"objectType\":\"instagram\"");
    expect(logged).toContain("\"entryCount\":1");
    expect(logged).toContain("\"messagingEventCount\":1");
    expect(logged).toContain("\"hasMessage\":true");
    expect(logged).toContain("\"hasSender\":true");
    expect(logged).toContain("\"hasRecipient\":true");
    expect(logged).toContain("\"hasMessageId\":true");
    expect(logged).toContain("\"ignoredReason\":\"echo\"");
    expect(logged).not.toContain("Dashboard test message");
    expect(logged).not.toContain("12334");
    expect(logged).not.toContain("17841400008460000");
    expect(logged).not.toContain("MESSAGE-ID-LOGIN");
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toMatch(/sha256=/i);
    ingestSpy.mockRestore();
    echoSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("does not log normalize diagnostics when Instagram Login messaging is accepted", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const ingestSpy = vi
      .spyOn(
        await import("@/lib/meta/instagram-ingest"),
        "ingestInstagramInboundMessage",
      )
      .mockImplementation(async () => ({ outcome: "stored" }));
    const response = await handleInstagramWebhookPost(
      signedPost(instagramLoginMessagesPayload()),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(200);
    expect(ingestSpy).toHaveBeenCalled();
    const logged = infoSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("meta webhook normalize diagnostic");
    expect(logged).not.toContain("Hello from Instagram Login");
    ingestSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

describe("instagram webhook route wiring", () => {
  it("exports nodejs GET and POST handlers", () => {
    expect(runtime).toBe("nodejs");
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
  });
});
