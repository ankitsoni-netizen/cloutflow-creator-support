import { describe, expect, it } from "vitest";
import {
  parseIntakePhone,
  validateIntakeField,
  emptyIntakeCollected,
} from "@/lib/meta/intake-validate";

describe("Instagram intake validation", () => {
  it("accepts a structurally valid email and rejects invalid ones", () => {
    const collected = emptyIntakeCollected();
    expect(validateIntakeField("creator_email", "riya@example.com", collected)).toEqual(
      expect.objectContaining({ ok: true, value: "riya@example.com" }),
    );
    expect(validateIntakeField("creator_email", "not-an-email", collected).ok).toBe(
      false,
    );
  });

  it("normalizes Indian and international phones separately from display values", () => {
    expect(parseIntakePhone("9876543210")).toEqual({
      display: "9876543210",
      normalized: "+919876543210",
    });
    expect(parseIntakePhone("+91 98765 43210")).toEqual({
      display: "+91 98765 43210",
      normalized: "+919876543210",
    });
    expect(parseIntakePhone("+14155552671")?.normalized).toBe("+14155552671");
    expect(parseIntakePhone("abc")).toBeNull();
  });

  it("normalizes campaign month to the first day of the month", () => {
    const result = validateIntakeField(
      "campaign_month",
      "August 2026",
      emptyIntakeCollected(),
    );
    expect(result).toMatchObject({ ok: true, value: "2026-08-01" });
    expect(
      validateIntakeField("campaign_month", "not a month", emptyIntakeCollected())
        .ok,
    ).toBe(false);
  });

  it("keeps unknown campaign and POC values null instead of placeholders", () => {
    const collected = emptyIntakeCollected();
    expect(validateIntakeField("campaign_name", "I don't know", collected)).toEqual(
      { ok: true, value: null },
    );
    expect(validateIntakeField("brand_name", "idk", collected)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateIntakeField("cloutflow_poc_name", "N/A", collected)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateIntakeField("creator_name", "Unknown Creator", collected).ok).toBe(
      false,
    );
  });
});
