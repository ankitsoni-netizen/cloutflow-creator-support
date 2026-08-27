import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendWhatsAppProviderReplyButtons,
  sendWhatsAppProviderText,
} from "@/lib/meta/whatsapp-provider";
import * as watiSend from "@/lib/wati/send";
import * as metaSend from "@/lib/meta/whatsapp-send";
import { ROUTE_CREATOR_SUPPORT_PAYLOAD } from "@/lib/meta/routing-copy";
import {
  resolveWhatsAppProvider,
  WHATSAPP_PROVIDER_NOT_CONFIGURED,
} from "@/lib/wati/config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WhatsApp provider resolution (fail-closed)", () => {
  it("accepts wati and meta only", () => {
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "wati" })).toEqual({
      ok: true,
      provider: "wati",
    });
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "meta" })).toEqual({
      ok: true,
      provider: "meta",
    });
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "WATI" })).toEqual({
      ok: true,
      provider: "wati",
    });
  });

  it("rejects unset, blank, and invalid values", () => {
    expect(resolveWhatsAppProvider({})).toEqual({
      ok: false,
      errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED,
    });
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "" })).toEqual({
      ok: false,
      errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED,
    });
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "   " })).toEqual({
      ok: false,
      errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED,
    });
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "twilio" })).toEqual({
      ok: false,
      errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED,
    });
  });
});

describe("WhatsApp provider adapter", () => {
  it("routes text through WATI when WHATSAPP_PROVIDER=wati", async () => {
    const wati = vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati",
      recipientId: "16315551181",
    });
    const meta = vi.spyOn(metaSend, "sendWhatsAppText");
    const result = await sendWhatsAppProviderText({
      recipientId: "16315551181",
      text: "Hello",
      deps: { env: { WHATSAPP_PROVIDER: "wati" } },
    });
    expect(result.ok).toBe(true);
    expect(wati).toHaveBeenCalledTimes(1);
    expect(meta).not.toHaveBeenCalled();
  });

  it("does not fall back to Meta after a WATI failure", async () => {
    vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: false,
      errorCode: "http_503",
      retryable: true,
      messagingWindowExpired: false,
      httpStatus: 503,
    });
    const meta = vi.spyOn(metaSend, "sendWhatsAppText");
    const result = await sendWhatsAppProviderText({
      recipientId: "16315551181",
      text: "Hello",
      deps: { env: { WHATSAPP_PROVIDER: "wati" } },
    });
    expect(result).toMatchObject({ ok: false, errorCode: "http_503" });
    expect(meta).not.toHaveBeenCalled();
  });

  it("uses Meta only when WHATSAPP_PROVIDER=meta", async () => {
    const meta = vi.spyOn(metaSend, "sendWhatsAppText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.meta",
      recipientId: "16315551181",
    });
    const wati = vi.spyOn(watiSend, "sendWatiSessionText");
    const result = await sendWhatsAppProviderText({
      recipientId: "16315551181",
      text: "Hello",
      deps: { env: { WHATSAPP_PROVIDER: "meta" } },
    });
    expect(result.ok).toBe(true);
    expect(meta).toHaveBeenCalledTimes(1);
    expect(wati).not.toHaveBeenCalled();
  });

  it("makes zero network calls when provider is missing or invalid", async () => {
    const wati = vi.spyOn(watiSend, "sendWatiSessionText");
    const meta = vi.spyOn(metaSend, "sendWhatsAppText");
    const fetchImpl = vi.fn<typeof fetch>();

    for (const env of [
      {},
      { WHATSAPP_PROVIDER: "" },
      { WHATSAPP_PROVIDER: " " },
      { WHATSAPP_PROVIDER: "invalid" },
    ]) {
      wati.mockClear();
      meta.mockClear();
      fetchImpl.mockClear();
      const result = await sendWhatsAppProviderText({
        recipientId: "16315551181",
        text: "Hello",
        deps: { env, fetchImpl },
      });
      expect(result).toMatchObject({
        ok: false,
        errorCode: WHATSAPP_PROVIDER_NOT_CONFIGURED,
      });
      expect(wati).not.toHaveBeenCalled();
      expect(meta).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("sends WATI interactive buttons for 1–3 quick replies", async () => {
    const interactive = vi
      .spyOn(watiSend, "sendWatiInteractiveMessage")
      .mockResolvedValue({
        ok: true,
        metaMessageId: "wamid.wati.qr",
        recipientId: "16315551181",
      });
    const text = vi.spyOn(watiSend, "sendWatiSessionText");
    const metaButtons = vi.spyOn(metaSend, "sendWhatsAppReplyButtons");
    await sendWhatsAppProviderReplyButtons({
      recipientId: "16315551181",
      text: "Choose",
      quickReplies: [
        {
          content_type: "text",
          title: "Creator Support",
          payload: ROUTE_CREATOR_SUPPORT_PAYLOAD,
        },
      ],
      deps: { env: { WHATSAPP_PROVIDER: "wati" } },
    });
    expect(interactive).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Choose",
        quickReplies: [
          expect.objectContaining({ title: "Creator Support" }),
        ],
      }),
    );
    expect(text).not.toHaveBeenCalled();
    expect(metaButtons).not.toHaveBeenCalled();
  });

  it("sends WATI text when quick replies are empty", async () => {
    const text = vi.spyOn(watiSend, "sendWatiSessionText").mockResolvedValue({
      ok: true,
      metaMessageId: "wamid.wati.text",
      recipientId: "16315551181",
    });
    const interactive = vi.spyOn(watiSend, "sendWatiInteractiveMessage");
    await sendWhatsAppProviderReplyButtons({
      recipientId: "16315551181",
      text: "Thanks",
      quickReplies: [],
      deps: { env: { WHATSAPP_PROVIDER: "wati" } },
    });
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Thanks" }),
    );
    expect(interactive).not.toHaveBeenCalled();
  });
});
