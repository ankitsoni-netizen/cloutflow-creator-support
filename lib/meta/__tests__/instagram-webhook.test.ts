import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { META_WEBHOOK_EVENT_RECEIVED } from "@/lib/meta/constants";
import type { InstagramIngestStore } from "@/lib/meta/instagram-ingest";
import {
  handleInstagramWebhookGet,
  handleInstagramWebhookPost,
} from "@/lib/meta/instagram-webhook";
import {
  instagramTextPayload,
  whatsappStatusPayload,
  whatsappTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import { GET, POST, runtime } from "@/app/api/webhooks/meta/instagram/route";
import { NextRequest } from "next/server";

const VERIFY_TOKEN = "meta-ig-verify-token";
const APP_SECRET = "meta-app-secret-test";

function testEnv(): Record<string, string | undefined> {
  return {
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: APP_SECRET,
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

function signedPost(body: unknown): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return postRequest(body, { "x-hub-signature-256": sign(raw) });
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
    const ingest = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const response = await handleInstagramWebhookPost(
      postRequest(instagramTextPayload()),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(401);
    ingest.mockRestore();
  });

  it("returns 401 when the signature is invalid", async () => {
    const response = await handleInstagramWebhookPost(
      postRequest(instagramTextPayload(), {
        "x-hub-signature-256": sign("{}", "other"),
      }),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(401);
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

  it("returns 200 for echo Instagram messages without ingesting", async () => {
    const ingestSpy = vi.spyOn(
      await import("@/lib/meta/instagram-ingest"),
      "ingestInstagramInboundMessage",
    );
    const response = await handleInstagramWebhookPost(
      signedPost(instagramTextPayload({ isEcho: true })),
      { env: testEnv(), instagramStore: stubStore() },
    );
    expect(response.status).toBe(200);
    expect(ingestSpy).not.toHaveBeenCalled();
    ingestSpy.mockRestore();
  });
});

describe("instagram webhook route wiring", () => {
  it("exports nodejs GET and POST handlers", () => {
    expect(runtime).toBe("nodejs");
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
  });
});
