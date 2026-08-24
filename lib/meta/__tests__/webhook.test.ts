import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  META_WEBHOOK_EVENT_RECEIVED,
  META_WEBHOOK_HEALTH_BODY,
} from "@/lib/meta/constants";
import type { NormalizedMetaInboundText } from "@/lib/meta/types";
import type { PersistResult } from "@/lib/meta/store";
import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
} from "@/lib/meta/webhook";
import { GET, POST, runtime } from "@/app/api/webhooks/meta/route";
import {
  instagramTextPayload,
  whatsappStatusPayload,
  whatsappTextPayload,
} from "@/lib/meta/__tests__/fixtures";
import { NextRequest } from "next/server";

const VERIFY_TOKEN = "meta-verify-token-test";
const APP_SECRET = "meta-app-secret-test";
const IG_APP_SECRET = "meta-ig-app-secret-test";

function testEnv(): Record<string, string | undefined> {
  return {
    META_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: APP_SECRET,
  };
}

function getRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/webhooks/meta");
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
  return new NextRequest("http://localhost:3000/api/webhooks/meta", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: raw,
  });
}

function signedPost(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return postRequest(body, {
    "x-hub-signature-256": sign(raw),
    ...extraHeaders,
  });
}

function createMemoryPersist() {
  const stored: NormalizedMetaInboundText[] = [];
  const persist = vi.fn(
    async (event: NormalizedMetaInboundText): Promise<PersistResult> => {
      const duplicate = stored.some(
        (row) =>
          row.provider === event.provider &&
          row.externalEventId === event.externalEventId,
      );
      if (!duplicate) stored.push(event);
      return { outcome: duplicate ? "duplicate" : "stored" };
    },
  );
  return { persist, stored };
}

describe("meta webhook GET verification", () => {
  it("returns the raw hub.challenge when the token matches", async () => {
    const response = handleMetaWebhookGet(
      getRequest({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "1234567890",
      }),
      { env: testEnv() },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1234567890");
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("returns 403 when the verify token is wrong", async () => {
    const response = handleMetaWebhookGet(
      getRequest({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "1234567890",
      }),
      { env: testEnv() },
    );
    const body = await response.text();
    expect(response.status).toBe(403);
    expect(body).not.toContain(VERIFY_TOKEN);
    expect(body).not.toBe("1234567890");
  });

  it("returns 403 when hub.mode is not subscribe", async () => {
    const response = handleMetaWebhookGet(
      getRequest({
        "hub.mode": "unsubscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "1234567890",
      }),
      { env: testEnv() },
    );
    expect(response.status).toBe(403);
  });

  it("returns a generic health body when hub params are absent", async () => {
    const response = handleMetaWebhookGet(getRequest(), { env: {} });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toBe(META_WEBHOOK_HEALTH_BODY);
    expect(body).not.toMatch(/secret|token|configured|META_/i);
  });
});

describe("meta webhook POST", () => {
  it("returns 401 when the signature is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { persist } = createMemoryPersist();
    const response = await handleMetaWebhookPost(
      postRequest(whatsappTextPayload()),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(401);
    expect(persist).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("signature_missing");
    expect(logged).not.toContain("signature_invalid");
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toContain("Payment is delayed");
    expect(logged).not.toMatch(/sha256=/i);
    errorSpy.mockRestore();
  });

  it("returns 401 when the signature is invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { persist } = createMemoryPersist();
    const invalidSignature = sign(
      JSON.stringify(whatsappTextPayload()),
      "other",
    );
    const response = await handleMetaWebhookPost(
      postRequest(whatsappTextPayload(), {
        "x-hub-signature-256": invalidSignature,
      }),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(401);
    expect(persist).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).not.toContain(APP_SECRET);
    expect(body).not.toContain("Payment is delayed");
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("signature_invalid");
    expect(logged).not.toContain("signature_missing");
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toContain("Payment is delayed");
    expect(logged).not.toContain(invalidSignature);
    expect(logged).not.toMatch(/sha256=/i);
    errorSpy.mockRestore();
  });

  it("rejects a request signed only with META_IG_APP_SECRET", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { persist } = createMemoryPersist();
    const payload = whatsappTextPayload();
    const raw = JSON.stringify(payload);
    const response = await handleMetaWebhookPost(
      postRequest(payload, {
        "x-hub-signature-256": sign(raw, IG_APP_SECRET),
      }),
      {
        env: {
          ...testEnv(),
          META_IG_APP_SECRET: IG_APP_SECRET,
        },
        persistInboundMessage: persist,
      },
    );
    expect(response.status).toBe(401);
    expect(persist).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("signature_invalid");
    expect(logged).not.toContain(IG_APP_SECRET);
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    expect(logged).not.toContain("Payment is delayed");
    expect(logged).not.toMatch(/sha256=/i);
    errorSpy.mockRestore();
  });

  it("accepts a valid POST signature and stores a WhatsApp text message", async () => {
    const { persist, stored } = createMemoryPersist();
    const payload = whatsappTextPayload();
    const response = await handleMetaWebhookPost(signedPost(payload), {
      env: testEnv(),
      persistInboundMessage: persist,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(stored[0]?.channel).toBe("whatsapp");
    expect(stored[0]?.messageBody).toBe("Payment is delayed");
    expect(stored[0]?.provider).toBe("meta_whatsapp");
  });

  it("persists every supported message from a multi-message payload", async () => {
    const { persist, stored } = createMemoryPersist();
    const response = await handleMetaWebhookPost(
      signedPost(
        whatsappTextPayload({
          extraMessages: [{ id: "wamid.second", body: "Second message" }],
        }),
      ),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(200);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(stored.map((event) => event.externalMessageId)).toEqual([
      "wamid.HBgNMTYzMTU1NTExODE",
      "wamid.second",
    ]);
  });

  it("ignores WhatsApp status callbacks without storing", async () => {
    const { persist } = createMemoryPersist();
    const response = await handleMetaWebhookPost(
      signedPost(whatsappStatusPayload()),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(persist).not.toHaveBeenCalled();
  });

  it("stores a valid Instagram text message", async () => {
    const { persist, stored } = createMemoryPersist();
    const response = await handleMetaWebhookPost(
      signedPost(instagramTextPayload()),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(stored[0]?.channel).toBe("instagram");
    expect(stored[0]?.provider).toBe("meta_instagram");
    expect(stored[0]?.externalContactId).toBe("IGSID123");
  });

  it("ignores Instagram echo messages without storing", async () => {
    const { persist } = createMemoryPersist();
    const response = await handleMetaWebhookPost(
      signedPost(instagramTextPayload({ isEcho: true })),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(persist).not.toHaveBeenCalled();
  });

  it("returns 200 EVENT_RECEIVED for duplicate deliveries", async () => {
    const { persist } = createMemoryPersist();
    const payload = whatsappTextPayload();
    const first = await handleMetaWebhookPost(signedPost(payload), {
      env: testEnv(),
      persistInboundMessage: persist,
    });
    const second = await handleMetaWebhookPost(signedPost(payload), {
      env: testEnv(),
      persistInboundMessage: persist,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("returns 400 for malformed JSON after a valid signature", async () => {
    const { persist } = createMemoryPersist();
    const raw = "{not-json";
    const response = await handleMetaWebhookPost(
      postRequest(raw, { "x-hub-signature-256": sign(raw) }),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });

  it("acknowledges unsupported payloads safely without storing", async () => {
    const { persist } = createMemoryPersist();
    const response = await handleMetaWebhookPost(
      signedPost({ object: "page", entry: [{ id: "1" }] }),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(META_WEBHOOK_EVENT_RECEIVED);
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not log message text or secrets on storage failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const persist = vi.fn(async (): Promise<PersistResult> => {
      return { outcome: "failed", errorCode: "message_insert_failed" };
    });
    const response = await handleMetaWebhookPost(
      signedPost(whatsappTextPayload({ body: "secret payment details" })),
      { env: testEnv(), persistInboundMessage: persist },
    );
    expect(response.status).toBe(500);
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).not.toContain("secret payment details");
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain(VERIFY_TOKEN);
    errorSpy.mockRestore();
  });
});

describe("meta webhook route wiring", () => {
  it("exports nodejs runtime GET and POST handlers", () => {
    expect(runtime).toBe("nodejs");
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
  });
});
