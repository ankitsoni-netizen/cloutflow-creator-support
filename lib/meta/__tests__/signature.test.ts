import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  timingSafeEqualString,
  verifyMetaSignature,
} from "@/lib/meta/signature";

const SECRET = "meta-app-secret-test";

function sign(body: string, secret = SECRET): string {
  const hex = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `sha256=${hex}`;
}

describe("verifyMetaSignature", () => {
  it("accepts a matching sha256 HMAC of the exact raw body", () => {
    const raw = Buffer.from('{"object":"instagram"}', "utf8");
    expect(
      verifyMetaSignature(raw, sign(raw.toString("utf8")), SECRET),
    ).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(
      verifyMetaSignature(Buffer.from("{}", "utf8"), null, SECRET),
    ).toBe(false);
    expect(
      verifyMetaSignature(Buffer.from("{}", "utf8"), undefined, SECRET),
    ).toBe(false);
    expect(
      verifyMetaSignature(Buffer.from("{}", "utf8"), "", SECRET),
    ).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    const raw = Buffer.from("{}", "utf8");
    expect(verifyMetaSignature(raw, "sha1=abcd", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=not-hex", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=abcd", SECRET)).toBe(false);
  });

  it("rejects an HMAC computed with the wrong secret or body", () => {
    const raw = Buffer.from('{"hello":"world"}', "utf8");
    expect(verifyMetaSignature(raw, sign(raw.toString("utf8"), "other"), SECRET)).toBe(
      false,
    );
    expect(verifyMetaSignature(raw, sign('{"hello":"mutated"}'), SECRET)).toBe(
      false,
    );
  });
});

describe("timingSafeEqualString", () => {
  it("matches equal strings of different lengths without throwing", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false);
    expect(timingSafeEqualString("", "x")).toBe(false);
  });
});
