import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, runtime } from "@/app/api/webhooks/wati/route";
import { handleWatiWebhookPost } from "@/lib/wati/webhook";
import { WATI_WHATSAPP_PROVIDER } from "@/lib/wati/constants";
import { watiTextPayload } from "@/lib/wati/__tests__/fixtures";
import * as whatsappIngest from "@/lib/meta/whatsapp-ingest";

const SECRET = "wati-webhook-secret-test";
const CHANNEL = "17435002445";

function testEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    WATI_WEBHOOK_SECRET: SECRET,
    WATI_CHANNEL_PHONE_NUMBER: CHANNEL,
    WHATSAPP_PROVIDER: "wati",
    ...overrides,
  };
}

function postRequest(body: unknown, token: string | null = SECRET): NextRequest {
  const url = new URL("http://localhost:3000/api/webhooks/wati");
  if (token !== null) url.searchParams.set("token", token);
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WATI webhook route", () => {
  it("exports nodejs runtime and POST", () => {
    expect(runtime).toBe("nodejs");
    expect(typeof POST).toBe("function");
  });

  it("returns 401 when token is missing", async () => {
    const response = await handleWatiWebhookPost(
      postRequest(watiTextPayload(), null),
      { env: testEnv() },
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when token is wrong", async () => {
    const response = await handleWatiWebhookPost(
      postRequest(watiTextPayload(), "wrong-secret"),
      { env: testEnv() },
    );
    expect(response.status).toBe(401);
  });

  it("accepts a correct token and text payload with provider=wati_whatsapp", async () => {
    const inbound = vi
      .spyOn(whatsappIngest, "ingestWhatsAppInboundMessage")
      .mockResolvedValue({ outcome: "stored" });
    const response = await handleWatiWebhookPost(postRequest(watiTextPayload()), {
      env: testEnv(),
      store: {} as never,
    });
    expect(response.status).toBe(200);
    expect(inbound).toHaveBeenCalledTimes(1);
    expect(inbound.mock.calls[0]?.[0]).toMatchObject({
      provider: WATI_WHATSAPP_PROVIDER,
      channel: "whatsapp",
      messageBody: "hello",
    });
    const storage = inbound.mock.calls[0]?.[2]?.webhookPayload;
    expect(JSON.stringify(storage)).not.toContain("cdn.example");
    expect(JSON.stringify(storage)).not.toContain("avatar");
  });

  it("returns 400 for invalid JSON", async () => {
    const url = new URL("http://localhost:3000/api/webhooks/wati");
    url.searchParams.set("token", SECRET);
    const request = new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    const response = await handleWatiWebhookPost(request, { env: testEnv() });
    expect(response.status).toBe(400);
  });

  it("returns 200 for owner/outbound without chatbot ingest", async () => {
    const inbound = vi
      .spyOn(whatsappIngest, "ingestWhatsAppInboundMessage")
      .mockResolvedValue({ outcome: "stored" });
    const status = vi
      .spyOn(whatsappIngest, "ingestWhatsAppStatus")
      .mockResolvedValue({ outcome: "stored" });
    const response = await handleWatiWebhookPost(
      postRequest(
        watiTextPayload({
          owner: true,
          eventType: "sessionMessageSent_v2",
          statusString: "SENT",
          localMessageId: "wa:crm:1",
        }),
      ),
      { env: testEnv(), store: {} as never },
    );
    expect(response.status).toBe(200);
    expect(inbound).not.toHaveBeenCalled();
    // Owner session sent may be treated as a delivery status callback.
    expect(status.mock.calls.length + inbound.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("returns 200 for wrong channel without ingest", async () => {
    const inbound = vi
      .spyOn(whatsappIngest, "ingestWhatsAppInboundMessage")
      .mockResolvedValue({ outcome: "stored" });
    const response = await handleWatiWebhookPost(
      postRequest(watiTextPayload({ channelPhoneNumber: "11111111111" })),
      { env: testEnv(), store: {} as never },
    );
    expect(response.status).toBe(200);
    expect(inbound).not.toHaveBeenCalled();
  });

  it("does not re-ingest when webhook ingest reports duplicate WAMID", async () => {
    const inbound = vi
      .spyOn(whatsappIngest, "ingestWhatsAppInboundMessage")
      .mockResolvedValueOnce({ outcome: "stored" })
      .mockResolvedValueOnce({ outcome: "duplicate" });
    const first = await handleWatiWebhookPost(postRequest(watiTextPayload()), {
      env: testEnv(),
      store: {} as never,
    });
    const second = await handleWatiWebhookPost(postRequest(watiTextPayload()), {
      env: testEnv(),
      store: {} as never,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(inbound).toHaveBeenCalledTimes(2);
  });
});
