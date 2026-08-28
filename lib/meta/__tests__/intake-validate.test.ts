import { describe, expect, it } from "vitest";
import {
  emptyIntakeCollected,
  mergeCampaignDetails,
  mergeCreatorDetails,
  mergePlatformDetails,
  missingCampaignDetailsPrompt,
  missingCreatorDetailsPrompt,
  missingPlatformDetailsPrompt,
  parseCampaignDetailsBundle,
  parseCreatorDetailsBundle,
  parseIntakePhone,
  parsePlatformDetailsBundle,
} from "@/lib/meta/intake-validate";
import {
  CAMPAIGN_DETAILS_PROMPT_TEXT,
  CREATOR_DETAILS_PROMPT_TEXT,
  PLATFORM_DETAILS_PROMPT_TEXT,
} from "@/lib/meta/routing-copy";

describe("Instagram intake parsing", () => {
  it("parses name, email, and phone from one comma-separated response", () => {
    expect(
      parseCreatorDetailsBundle(
        "Riya Sharma, riya@example.com, +91 98765 43210",
      ),
    ).toEqual({
      creatorName: "Riya Sharma",
      email: "riya@example.com",
      phone: {
        display: "+91 98765 43210",
        normalized: "+919876543210",
      },
    });
  });

  it("parses creator details from labelled and line-separated formats", () => {
    const labelled = parseCreatorDetailsBundle(
      "Name: Riya Sharma\nEmail: riya@example.com\nPhone: 9876543210",
    );
    expect(labelled.creatorName).toBe("Riya Sharma");
    expect(labelled.email).toBe("riya@example.com");
    expect(labelled.phone?.normalized).toBe("+919876543210");

    const lines = parseCreatorDetailsBundle(
      "Riya Sharma\nriya@example.com\n+14155552671",
    );
    expect(lines.creatorName).toBe("Riya Sharma");
    expect(lines.email).toBe("riya@example.com");
    expect(lines.phone?.normalized).toBe("+14155552671");
  });

  it("detects email structurally and does not treat invalid emails as complete", () => {
    const parsed = parseCreatorDetailsBundle(
      "Riya Sharma bad@email 9876543210",
    );
    expect(parsed.email).toBeNull();
    expect(parsed.creatorName).toBe("Riya Sharma");
    expect(parsed.phone?.normalized).toBe("+919876543210");
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

  it("asks only for the missing creator field and keeps already-valid data", () => {
    const collected = mergeCreatorDetails(
      emptyIntakeCollected(),
      "Riya Sharma, riya@example.com",
    );
    expect(collected.creatorName).toBe("Riya Sharma");
    expect(collected.email).toBe("riya@example.com");
    expect(missingCreatorDetailsPrompt(collected)).toBe(
      "Please send a valid contact number.",
    );

    const withPhone = mergeCreatorDetails(collected, "9876543210");
    expect(withPhone.creatorName).toBe("Riya Sharma");
    expect(withPhone.email).toBe("riya@example.com");
    expect(withPhone.phoneNormalized).toBe("+919876543210");
    expect(missingCreatorDetailsPrompt(withPhone)).toBeNull();
  });

  it("does not overwrite valid creator details on a later partial reply", () => {
    const first = mergeCreatorDetails(
      emptyIntakeCollected(),
      "Riya Sharma, riya@example.com, 9876543210",
    );
    const second = mergeCreatorDetails(first, "not-an-email");
    expect(second.creatorName).toBe("Riya Sharma");
    expect(second.email).toBe("riya@example.com");
    expect(second.phoneNormalized).toBe("+919876543210");
  });

  it("rejects placeholder names instead of storing them", () => {
    expect(parseCreatorDetailsBundle("Unknown Creator").creatorName).toBeNull();
  });

  it("normalizes IG, Insta, Instagram, YT and YouTube from one platform reply", () => {
    expect(parsePlatformDetailsBundle("IG @riya_creates")).toMatchObject({
      platform: "instagram",
      socialHandle: "riya_creates",
      socialHandleDisplay: "@riya_creates",
    });
    expect(parsePlatformDetailsBundle("Insta, riya_creates").platform).toBe(
      "instagram",
    );
    expect(parsePlatformDetailsBundle("Instagram riya_creates").platform).toBe(
      "instagram",
    );
    expect(parsePlatformDetailsBundle("YT riya.vlogs")).toMatchObject({
      platform: "youtube",
      socialHandle: "riya.vlogs",
    });
    expect(parsePlatformDetailsBundle("YouTube, @riya.vlogs")).toMatchObject({
      platform: "youtube",
      socialHandle: "riya.vlogs",
      socialHandleDisplay: "@riya.vlogs",
    });
    expect(parsePlatformDetailsBundle("Youtube riya.vlogs").platform).toBe(
      "youtube",
    );
  });

  it("asks only for the missing platform or handle", () => {
    const platformOnly = mergePlatformDetails(
      emptyIntakeCollected(),
      "Instagram",
    );
    expect(platformOnly.platform).toBe("instagram");
    expect(missingPlatformDetailsPrompt(platformOnly)).toBe(
      "Please send your username or handle.",
    );

    const handleOnly = mergePlatformDetails(emptyIntakeCollected(), "@riya_creates");
    expect(handleOnly.socialHandle).toBe("riya_creates");
    expect(missingPlatformDetailsPrompt(handleOnly)).toBe(
      "Please tell us whether this is Instagram or YouTube.",
    );
  });

  it("parses campaign, brand, and month from labelled, comma, and line formats", () => {
    expect(
      parseCampaignDetailsBundle(
        "Campaign: Summer Drop\nBrand: Acme\nMonth: Aug 2026",
      ),
    ).toEqual({
      brandName: "Acme",
      campaignMonth: "2026-08-01",
    });
    expect(
      parseCampaignDetailsBundle("Summer Drop, Acme, August 2026"),
    ).toEqual({
      brandName: "Acme",
      campaignMonth: "2026-08-01",
    });
    expect(
      parseCampaignDetailsBundle("Summer Drop\nAcme\n08/2026"),
    ).toEqual({
      brandName: "Acme",
      campaignMonth: "2026-08-01",
    });
    expect(parseCampaignDetailsBundle("Launch, BrandX, 2026-08").campaignMonth).toBe(
      "2026-08-01",
    );
  });

  it("does not accept I don't know for required campaign fields", () => {
    const parsed = parseCampaignDetailsBundle("I don't know");
    expect(parsed.brandName).toBeNull();
    expect(parsed.campaignMonth).toBeNull();
    expect(
      missingCampaignDetailsPrompt(mergeCampaignDetails(emptyIntakeCollected(), "idk")),
    ).toBe(CAMPAIGN_DETAILS_PROMPT_TEXT);
  });

  it("asks only for the missing or invalid campaign value", () => {
    const collected = mergeCampaignDetails(
      emptyIntakeCollected(),
      "Acme",
    );
    expect(collected.campaignName).toBeNull();
    expect(collected.brandName).toBe("Acme");
    expect(missingCampaignDetailsPrompt(collected)).toBe(
      "Please send the campaign month, for example June or June 2026.",
    );
  });

  it("returns the full first-turn prompts when every value is still missing", () => {
    const empty = emptyIntakeCollected();
    expect(missingCreatorDetailsPrompt(empty)).toBe(CREATOR_DETAILS_PROMPT_TEXT);
    expect(missingPlatformDetailsPrompt(empty)).toBe(PLATFORM_DETAILS_PROMPT_TEXT);
    expect(missingCampaignDetailsPrompt(empty)).toBe(CAMPAIGN_DETAILS_PROMPT_TEXT);
  });
});
