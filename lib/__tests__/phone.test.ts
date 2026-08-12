import { describe, expect, it } from "vitest";
import {
  composePhoneNumber,
  isValidPhoneNumber,
  normalizePhoneNumber,
  parsePhoneNumber,
  sanitizeNationalNumberInput,
} from "@/lib/phone";

describe("phone helpers", () => {
  it("keeps only 10 national digits", () => {
    expect(sanitizeNationalNumberInput("98a76-54321-0xyz")).toBe("9876543210");
    expect(sanitizeNationalNumberInput("12345678901234")).toBe("1234567890");
  });

  it("composes canonical contact numbers", () => {
    expect(composePhoneNumber("91", "9876543210")).toBe("+919876543210");
    expect(composePhoneNumber("+91", "98765 43210")).toBe("+919876543210");
    expect(composePhoneNumber("91", "")).toBe("");
  });

  it("parses country code and national number", () => {
    expect(parsePhoneNumber("+919876543210")).toEqual({
      dialCode: "91",
      nationalNumber: "9876543210",
    });
    expect(parsePhoneNumber("+1 4155552671")).toEqual({
      dialCode: "1",
      nationalNumber: "4155552671",
    });
  });

  it("normalizes spaced values and rejects invalid shapes", () => {
    expect(normalizePhoneNumber("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhoneNumber("9876543210")).toBeNull();
    expect(normalizePhoneNumber("+91987654321")).toBeNull();
    expect(isValidPhoneNumber("+449876543210")).toBe(true);
    expect(isValidPhoneNumber("+9999876543210")).toBe(false);
  });
});
