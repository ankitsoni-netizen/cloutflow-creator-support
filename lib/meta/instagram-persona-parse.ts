import { isValidEmailAddress } from "@/lib/email/html";
import {
  CREATOR_CAMPAIGN_AMBIGUOUS_TEXT,
} from "@/lib/meta/instagram-persona-copy";
import {
  isFakePlaceholder,
  isUnknownOptionalAnswer,
  parseIntakePhone,
} from "@/lib/meta/intake-validate";
import { toUntrustedPlainText } from "@/lib/meta/plain-text";
import { parseCampaignMonthForDb } from "@/lib/tickets/map";

export type CreatorCampaignFields = {
  campaignName: string | null;
  brandName: string | null;
  campaignMonth: string | null;
  contactEmail: string | null;
  campaignBrandAmbiguous?: boolean;
};

export type AgencyDetailFields = {
  agencyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  rosterUrl: string | null;
};

export type OtherContactFields = {
  contactName: string | null;
  contactEmail: string | null;
  contactPhoneDisplay: string | null;
  contactPhoneNormalized: string | null;
};

function labelledChunks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function labelledValue(text: string, labels: RegExp): string | null {
  for (const line of labelledChunks(text)) {
    const match = line.match(/^([^:\n]{1,40})\s*[:\-]\s*(.+)$/);
    if (!match) continue;
    const label = match[1]?.trim() ?? "";
    const value = match[2]?.trim() ?? "";
    if (labels.test(label) && value) return value;
  }
  return null;
}

function splitLines(text: string): string[] {
  return labelledChunks(text);
}

function splitParts(text: string): string[] {
  const lines = splitLines(text);
  if (lines.length >= 2) return lines;
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function looksLikeCommentary(part: string): boolean {
  const trimmed = part.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/);
  if (words.length >= 6) return true;
  return /^(hey|hi|hello|this|please|so|just)\b/i.test(trimmed);
}

export function parseInstagramContactPhone(value: string): {
  display: string;
  normalized: string;
} | null {
  const display = value.trim();
  if (!display) return null;
  const compact = display.replace(/[\s\-().]/g, "");
  if (!compact.startsWith("+") && !display.includes("+")) {
    return null;
  }
  return parseIntakePhone(display);
}

function requiredTextValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (isUnknownOptionalAnswer(trimmed) || isFakePlaceholder(trimmed)) {
    return null;
  }
  return trimmed;
}

function firstValidEmail(text: string): string | null {
  const matches = text.match(/[^\s,;<>]+@[^\s,;<>]+/g) ?? [];
  for (const candidate of matches) {
    const cleaned = candidate.replace(/[.,;:]+$/, "");
    if (isValidEmailAddress(cleaned)) return cleaned.toLowerCase();
  }
  return null;
}

export function parseHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseMeaningfulDetails(raw: string): string | null {
  const plain = toUntrustedPlainText(raw);
  const meaningful = requiredTextValue(plain);
  return meaningful;
}

function stripLabelPrefix(part: string, labels: RegExp): string {
  return part.replace(labels, "").trim();
}

export function parseCreatorCampaignBundle(raw: string): CreatorCampaignFields {
  const text = toUntrustedPlainText(raw);
  if (!text) {
    return {
      campaignName: null,
      brandName: null,
      campaignMonth: null,
      contactEmail: null,
    };
  }

  let campaignName = requiredTextValue(
    labelledValue(text, /^(campaign(?:\s*name)?)$/i),
  );
  let brandName = requiredTextValue(
    labelledValue(text, /^(brand(?:\s*name)?)$/i),
  );
  const monthRaw = labelledValue(
    text,
    /^(month|campaign\s*month|date)$/i,
  );
  let campaignMonth = monthRaw ? parseCampaignMonthForDb(monthRaw) : null;
  let contactEmail =
    firstValidEmail(labelledValue(text, /^(e-?mail|mail|contact\s*email)$/i) ?? "") ??
    firstValidEmail(text);

  const labelPrefix =
    /^(campaign(?:\s*name)?|brand(?:\s*name)?|month|campaign\s*month|date|e-?mail|mail|contact\s*email)\s*[:\-]\s*/i;

  if (!campaignName || !brandName || !campaignMonth || !contactEmail) {
    const parts = splitParts(text).map((part) => stripLabelPrefix(part, labelPrefix));

    if (!campaignMonth) {
      for (const part of parts) {
        const month = parseCampaignMonthForDb(part);
        if (month) {
          campaignMonth = month;
          break;
        }
      }
    }
    if (!contactEmail) {
      for (const part of parts) {
        const email = firstValidEmail(part);
        if (email) {
          contactEmail = email;
          break;
        }
      }
    }

    const remaining = parts.filter(
      (part) =>
        requiredTextValue(part) &&
        parseCampaignMonthForDb(part) === null &&
        !firstValidEmail(part) &&
        !/^(campaign(?:\s*name)?|brand(?:\s*name)?|month|campaign\s*month|date|e-?mail|mail)$/i.test(
          part,
        ),
    );

    const commentaryOrExtra =
      remaining.some((part) => looksLikeCommentary(part)) || remaining.length > 2;
    if (commentaryOrExtra && (!campaignName || !brandName)) {
      return {
        campaignName: requiredTextValue(campaignName),
        brandName: requiredTextValue(brandName),
        campaignMonth,
        contactEmail,
        campaignBrandAmbiguous: true,
      };
    }

    if (!campaignName && remaining[0]) {
      campaignName = requiredTextValue(remaining[0]);
    }
    if (!brandName && remaining[1]) {
      brandName = requiredTextValue(remaining[1]);
    }
    if (!campaignName && remaining.length === 1 && brandName) {
      campaignName = requiredTextValue(remaining[0]);
    }
    if (!brandName && remaining.length === 1 && campaignName) {
      brandName = requiredTextValue(remaining[0]);
    }
  }

  return {
    campaignName: requiredTextValue(campaignName),
    brandName: requiredTextValue(brandName),
    campaignMonth,
    contactEmail,
  };
}

export function mergeCreatorCampaignFields(
  current: CreatorCampaignFields,
  parsed: CreatorCampaignFields,
): CreatorCampaignFields {
  return {
    campaignName: parsed.campaignName ?? current.campaignName,
    brandName: parsed.brandName ?? current.brandName,
    campaignMonth: parsed.campaignMonth ?? current.campaignMonth,
    contactEmail: parsed.contactEmail ?? current.contactEmail,
    campaignBrandAmbiguous: parsed.campaignBrandAmbiguous ?? false,
  };
}

export function missingCreatorCampaignPrompt(
  fields: CreatorCampaignFields,
): string | null {
  if (fields.campaignBrandAmbiguous && (!fields.campaignName || !fields.brandName)) {
    return CREATOR_CAMPAIGN_AMBIGUOUS_TEXT;
  }
  const missing: string[] = [];
  if (!fields.campaignName) missing.push("the campaign name");
  if (!fields.brandName) missing.push("the brand name");
  if (!fields.campaignMonth) missing.push("a valid campaign month");
  if (!fields.contactEmail) missing.push("a valid email address");
  return joinMissing(missing);
}

export function parseAgencyDetailsBundle(raw: string): AgencyDetailFields {
  const text = toUntrustedPlainText(raw);
  if (!text) {
    return {
      agencyName: null,
      contactName: null,
      contactEmail: null,
      rosterUrl: null,
    };
  }

  let agencyName = requiredTextValue(
    labelledValue(text, /^(agency(?:\s*name)?)$/i),
  );
  let contactName = requiredTextValue(
    labelledValue(text, /^(name|contact(?:\s*name)?|your\s*name)$/i),
  );
  let contactEmail =
    firstValidEmail(labelledValue(text, /^(e-?mail|mail|contact\s*email)$/i) ?? "") ??
    firstValidEmail(text);
  let rosterUrl = parseHttpUrl(
    labelledValue(text, /^(roster(?:\s*(?:url|link))?|url|link|website)$/i) ?? "",
  );

  const labelPrefix =
    /^(agency(?:\s*name)?|name|contact(?:\s*name)?|your\s*name|e-?mail|mail|contact\s*email|roster(?:\s*(?:url|link))?|url|link|website)\s*[:\-]\s*/i;

  if (!agencyName || !contactName || !contactEmail || !rosterUrl) {
    const parts = splitParts(text).map((part) => stripLabelPrefix(part, labelPrefix));

    if (!contactEmail) {
      for (const part of parts) {
        const email = firstValidEmail(part);
        if (email) {
          contactEmail = email;
          break;
        }
      }
    }
    if (!rosterUrl) {
      for (const part of parts) {
        const url = parseHttpUrl(part);
        if (url) {
          rosterUrl = url;
          break;
        }
      }
    }

    const remaining = parts.filter(
      (part) =>
        requiredTextValue(part) &&
        !firstValidEmail(part) &&
        !parseHttpUrl(part) &&
        !/^(agency(?:\s*name)?|name|email|roster)$/i.test(part),
    );

    if (!agencyName && remaining[0]) agencyName = requiredTextValue(remaining[0]);
    if (!contactName && remaining[1]) contactName = requiredTextValue(remaining[1]);
    if (!agencyName && remaining.length === 1 && contactName) {
      agencyName = requiredTextValue(remaining[0]);
    }
    if (!contactName && remaining.length === 1 && agencyName) {
      contactName = requiredTextValue(remaining[0]);
    }
  }

  return {
    agencyName: requiredTextValue(agencyName),
    contactName: requiredTextValue(contactName),
    contactEmail,
    rosterUrl,
  };
}

export function mergeAgencyDetailFields(
  current: AgencyDetailFields,
  parsed: AgencyDetailFields,
): AgencyDetailFields {
  return {
    agencyName: parsed.agencyName ?? current.agencyName,
    contactName: parsed.contactName ?? current.contactName,
    contactEmail: parsed.contactEmail ?? current.contactEmail,
    rosterUrl: parsed.rosterUrl ?? current.rosterUrl,
  };
}

export function missingAgencyDetailsPrompt(
  fields: AgencyDetailFields,
): string | null {
  const missing: string[] = [];
  if (!fields.agencyName) missing.push("the agency name");
  if (!fields.contactName) missing.push("your name");
  if (!fields.contactEmail) missing.push("a valid email address");
  if (!fields.rosterUrl) missing.push("a valid roster URL (http or https)");
  return joinMissing(missing);
}

export function parseOtherContactBundle(raw: string): OtherContactFields {
  const text = toUntrustedPlainText(raw);
  if (!text) {
    return {
      contactName: null,
      contactEmail: null,
      contactPhoneDisplay: null,
      contactPhoneNormalized: null,
    };
  }

  let contactName = requiredTextValue(
    labelledValue(text, /^(name|contact(?:\s*name)?|your\s*name)$/i),
  );
  let contactEmail =
    firstValidEmail(labelledValue(text, /^(e-?mail|mail|contact\s*email)$/i) ?? "") ??
    firstValidEmail(text);

  const labelledPhone = labelledValue(
    text,
    /^(phone|mobile|contact(?:\s*(?:number|no\.?)?)?|number)$/i,
  );
  let phone = labelledPhone ? parseInstagramContactPhone(labelledPhone) : null;

  const labelPrefix =
    /^(name|contact(?:\s*name)?|your\s*name|e-?mail|mail|contact\s*email|phone|mobile|contact(?:\s*(?:number|no\.?)?)?|number)\s*[:\-]\s*/i;

  if (!contactName || !contactEmail || !phone) {
    const parts = splitParts(text).map((part) => stripLabelPrefix(part, labelPrefix));
    if (!contactEmail) {
      for (const part of parts) {
        const email = firstValidEmail(part);
        if (email) {
          contactEmail = email;
          break;
        }
      }
    }
    if (!phone) {
      for (const part of parts) {
        const parsed = parseInstagramContactPhone(part);
        if (parsed) {
          phone = parsed;
          break;
        }
      }
    }
    const remaining = parts.filter(
      (part) =>
        requiredTextValue(part) &&
        !firstValidEmail(part) &&
        !parseInstagramContactPhone(part),
    );
    if (!contactName && remaining[0]) {
      contactName = requiredTextValue(remaining[0]);
    }
  }

  return {
    contactName: requiredTextValue(contactName),
    contactEmail,
    contactPhoneDisplay: phone?.display ?? null,
    contactPhoneNormalized: phone?.normalized ?? null,
  };
}

export function mergeOtherContactFields(
  current: OtherContactFields,
  parsed: OtherContactFields,
): OtherContactFields {
  return {
    contactName: parsed.contactName ?? current.contactName,
    contactEmail: parsed.contactEmail ?? current.contactEmail,
    contactPhoneDisplay: parsed.contactPhoneDisplay ?? current.contactPhoneDisplay,
    contactPhoneNormalized:
      parsed.contactPhoneNormalized ?? current.contactPhoneNormalized,
  };
}

export function missingOtherContactPrompt(fields: OtherContactFields): string | null {
  const missing: string[] = [];
  if (!fields.contactName) missing.push("your name");
  if (!fields.contactEmail) missing.push("a valid email address");
  if (!fields.contactPhoneNormalized) {
    missing.push("a phone number with country code (for example +91 98765 43210)");
  }
  return joinMissing(missing);
}

function joinMissing(fields: string[]): string | null {
  if (fields.length === 0) return null;
  if (fields.length === 1) return `Please send ${fields[0]}.`;
  if (fields.length === 2) {
    return `Please send ${fields[0]} and ${fields[1]}.`;
  }
  const last = fields[fields.length - 1];
  return `Please send ${fields.slice(0, -1).join(", ")}, and ${last}.`;
}
