import { describe, expect, it } from "vitest";
import {
  missingAgencyDetailsPrompt,
  missingCreatorCampaignPrompt,
  parseAgencyDetailsBundle,
  parseCreatorCampaignBundle,
  parseHttpUrl,
  parseMeaningfulDetails,
  parseOtherContactBundle,
} from "@/lib/meta/instagram-persona-parse";

describe("instagram persona parsers", () => {
  it("parses labelled, comma-separated and line-separated campaign details", () => {
    expect(
      parseCreatorCampaignBundle(
        "Campaign: Summer Drop\nBrand: Acme\nMonth: August 2026\nEmail: riya@example.com",
      ),
    ).toEqual({
      campaignName: "Summer Drop",
      brandName: "Acme",
      campaignMonth: "2026-08-01",
      contactEmail: "riya@example.com",
    });
    expect(
      parseCreatorCampaignBundle("Summer Drop, Acme, Aug 2026, riya@example.com"),
    ).toMatchObject({ campaignMonth: "2026-08-01", contactEmail: "riya@example.com" });
    expect(parseCreatorCampaignBundle("Summer Drop, Acme, 08/2026, riya@example.com").campaignMonth).toBe(
      "2026-08-01",
    );
    expect(parseCreatorCampaignBundle("Summer Drop, Acme, 2026-08, riya@example.com").campaignMonth).toBe(
      "2026-08-01",
    );
  });

  it("asks only for missing campaign fields", () => {
    expect(
      missingCreatorCampaignPrompt({
        campaignName: "Summer Drop",
        brandName: "Acme",
        campaignMonth: null,
        contactEmail: null,
      }),
    ).toBe("Please send a valid campaign month and a valid email address.");
  });

  it("rejects non-http roster URLs", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("ftp://files.test")).toBeNull();
    expect(parseHttpUrl("https://agency.test/roster")).toContain("https://agency.test/roster");
    expect(
      parseAgencyDetailsBundle("North Star, Priya, priya@agency.test, not-a-url").rosterUrl,
    ).toBeNull();
    expect(
      missingAgencyDetailsPrompt({
        agencyName: "North Star",
        contactName: "Priya",
        contactEmail: "priya@agency.test",
        rosterUrl: null,
      }),
    ).toBe("Please send a valid roster URL (http or https).");
  });

  it("parses other contact name, email and phone", () => {
    expect(parseOtherContactBundle("Asha, asha@example.com, +919876543210")).toEqual({
      contactName: "Asha",
      contactEmail: "asha@example.com",
      contactPhoneDisplay: "+919876543210",
      contactPhoneNormalized: "+919876543210",
    });
  });

  it("does not treat a bare 10-digit number as an Instagram phone", () => {
    expect(parseOtherContactBundle("Asha, asha@example.com, 9876543210")).toEqual({
      contactName: "Asha",
      contactEmail: "asha@example.com",
      contactPhoneDisplay: null,
      contactPhoneNormalized: null,
    });
    expect(
      parseOtherContactBundle("Asha, asha@example.com, +14155552671").contactPhoneNormalized,
    ).toBe("+14155552671");
  });

  it("does not infer leading commentary as a campaign name", () => {
    const parsed = parseCreatorCampaignBundle(
      "Hey this is about the summer work, Acme, August 2026, riya@example.com",
    );
    expect(parsed.campaignBrandAmbiguous).toBe(true);
    expect(parsed.campaignName).toBeNull();
    expect(missingCreatorCampaignPrompt(parsed)).toContain("Campaign:");
  });

  it("stores issue details as untrusted plain text", () => {
    expect(parseMeaningfulDetails("<b>Payment delayed</b>\nsecond line")).toBe(
      "Payment delayed\nsecond line",
    );
    expect(parseMeaningfulDetails("   ")).toBeNull();
  });
});
