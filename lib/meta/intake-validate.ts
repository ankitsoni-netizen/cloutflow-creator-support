import { isValidEmailAddress } from "@/lib/email/html";
import {
  CAMPAIGN_DETAILS_PROMPT_TEXT,
  CREATOR_DETAILS_PROMPT_TEXT,
  PLATFORM_DETAILS_PROMPT_TEXT,
} from "@/lib/meta/routing-copy";
import { toUntrustedPlainText } from "@/lib/meta/plain-text";
import { normalizePhoneNumber } from "@/lib/phone";
import { parseCampaignMonthInput } from "@/lib/tickets/campaign-month";

export const INTAKE_FIELDS = [
  "creator_details",
  "platform_details",
  "campaign_details",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

const LEGACY_FIELD_TO_STEP: Record<string, IntakeField> = {
  creator_details: "creator_details",
  creator_name: "creator_details",
  creator_email: "creator_details",
  creator_phone: "creator_details",
  platform_details: "platform_details",
  social_handle: "platform_details",
  platform: "platform_details",
  campaign_details: "campaign_details",
  campaign_name: "campaign_details",
  brand_name: "campaign_details",
  campaign_month: "campaign_details",
};

export function resolveIntakeStep(value: string | null | undefined): IntakeField | null {
  if (!value) return null;
  return LEGACY_FIELD_TO_STEP[value] ?? null;
}

export const INTAKE_ISSUE_TYPES = [
  "payment_delayed",
  "tds_query",
  "gst_query",
  "campaign_execution",
  "poc_conduct",
  "other",
] as const;

export type IntakeIssueType = (typeof INTAKE_ISSUE_TYPES)[number];

export type IntakePlatform = "instagram" | "youtube";

export const IG_PERSONAS = [
  "creator",
  "brand",
  "agency",
  "other",
] as const;

export type IgPersona = (typeof IG_PERSONAS)[number];

export const IG_CREATOR_REASONS = ["new_work", "existing_campaign"] as const;
export type IgCreatorReason = (typeof IG_CREATOR_REASONS)[number];

export const IG_ISSUE_CATEGORIES = ["campaign", "payment"] as const;
export type IgIssueCategory = (typeof IG_ISSUE_CATEGORIES)[number];

const UNKNOWN_PATTERN =
  /^(i\s*don'?t\s*know|idk|don'?t\s*know|unknown|n\/?a|not\s*sure|no\s*idea|none|skip)$/i;

const PLACEHOLDER_PATTERN =
  /^(n\/?a|not applicable|unknown creator|placeholder|test|asdf|xxx+)$/i;

const PHONE_CANDIDATE_PATTERN = /(?:\+|00)?\d[\d\s\-().]{6,18}\d/g;
const PLATFORM_FIND_PATTERN =
  /\b(instagram|insta|ig|youtube|yt)\b/gi;
const HANDLE_AT_PATTERN = /@([A-Za-z0-9._]{2,64})/;

export type IntakePhoneValue = {
  display: string;
  normalized: string;
};

export type IntakeCollectedData = {
  creatorName: string | null;
  email: string | null;
  phoneDisplay: string | null;
  phoneNormalized: string | null;
  platform: IntakePlatform | null;
  socialHandle: string | null;
  socialHandleDisplay: string | null;
  issueType: IntakeIssueType | null;
  campaignName: string | null;
  brandName: string | null;
  campaignMonth: string | null;
  campaignMonthConfirmed: boolean;
  cloutflowPocName: string | null;
  cloutflowPocContact: string | null;
  issueDescription: string | null;
  originalInboundText: string | null;
  originalInboundMessageId: string | null;
  routingSessionId: string | null;
  phonePrefill: boolean;
  cachedUsername: string | null;
  usernameLookupAttempted: boolean;
  igPersona: IgPersona | null;
  igCreatorReason: IgCreatorReason | null;
  igIssueCategory: IgIssueCategory | null;
  agencyName: string | null;
  rosterUrl: string | null;
  inquiryDetails: string | null;
};

export function emptyIntakeCollected(
  overrides: Partial<IntakeCollectedData> = {},
): IntakeCollectedData {
  return {
    creatorName: null,
    email: null,
    phoneDisplay: null,
    phoneNormalized: null,
    platform: null,
    socialHandle: null,
    socialHandleDisplay: null,
    issueType: null,
    campaignName: null,
    brandName: null,
    campaignMonth: null,
    campaignMonthConfirmed: false,
    cloutflowPocName: null,
    cloutflowPocContact: null,
    issueDescription: null,
    originalInboundText: null,
    originalInboundMessageId: null,
    routingSessionId: null,
    phonePrefill: false,
    cachedUsername: null,
    usernameLookupAttempted: false,
    igPersona: null,
    igCreatorReason: null,
    igIssueCategory: null,
    agencyName: null,
    rosterUrl: null,
    inquiryDetails: null,
    ...overrides,
  };
}

export function clearInstagramJourneyCollected(
  collected: IntakeCollectedData,
  extras: Partial<IntakeCollectedData> = {},
): IntakeCollectedData {
  return emptyIntakeCollected({
    cachedUsername: collected.cachedUsername,
    usernameLookupAttempted: collected.usernameLookupAttempted,
    originalInboundText: collected.originalInboundText,
    originalInboundMessageId: collected.originalInboundMessageId,
    socialHandle: collected.socialHandle,
    socialHandleDisplay: collected.socialHandleDisplay,
    ...extras,
  });
}

export function isUnknownOptionalAnswer(value: string): boolean {
  return UNKNOWN_PATTERN.test(value.trim());
}

export function isFakePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

function compactPhone(value: string): string {
  return value.trim().replace(/[\s\-().]/g, "");
}

/**
 * Accept Indian and international contact numbers for Instagram intake.
 * Stores a display string separately from a normalized E.164-like value.
 */
export function parseIntakePhone(value: string): IntakePhoneValue | null {
  const display = value.trim();
  if (!display) return null;

  const strict = normalizePhoneNumber(display);
  if (strict) return { display, normalized: strict };

  const compact = compactPhone(display);
  const digits = compact.replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return null;

  if (/^\d{10}$/.test(digits)) {
    return { display, normalized: `+91${digits}` };
  }
  if (/^0\d{10}$/.test(digits)) {
    return { display, normalized: `+91${digits.slice(1)}` };
  }
  if (/^91\d{10}$/.test(digits)) {
    return { display, normalized: `+${digits}` };
  }

  const plusForm = compact.startsWith("+") ? compact : `+${digits}`;
  if (/^\+\d{8,15}$/.test(plusForm)) {
    return { display, normalized: plusForm };
  }

  return null;
}

export function normalizeIntakePlatform(
  value: string | null | undefined,
): IntakePlatform | null {
  if (!value) return null;
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (token === "ig" || token === "insta" || token === "instagram") {
    return "instagram";
  }
  if (token === "yt" || token === "youtube") {
    return "youtube";
  }
  return null;
}

export function normalizeSocialHandle(value: string): {
  stored: string;
  display: string;
} | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const stored = trimmed.replace(/^@+/, "").trim();
  if (!stored || stored.length < 2) return null;
  if (isFakePlaceholder(stored) || isUnknownOptionalAnswer(stored)) return null;
  if (normalizeIntakePlatform(stored)) return null;
  return {
    stored,
    display: trimmed.startsWith("@") ? `@${stored}` : stored,
  };
}

function labelledChunks(text: string): string[] {
  const parts: string[] = [];
  for (const line of splitLines(text)) {
    if (line.includes(",") && /[:\-]/.test(line)) {
      parts.push(...line.split(",").map((part) => part.trim()).filter(Boolean));
    } else {
      parts.push(line);
    }
  }
  return parts;
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
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitParts(text: string): string[] {
  const lines = splitLines(text);
  if (lines.length >= 2) return lines;
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function firstValidEmail(text: string): string | null {
  const matches = text.match(/[^\s,;<>]+@[^\s,;<>]+/g) ?? [];
  for (const candidate of matches) {
    const cleaned = candidate.replace(/[.,;:]+$/, "");
    if (isValidEmailAddress(cleaned)) return cleaned.toLowerCase();
  }
  return null;
}

function extractPhoneFromText(text: string): {
  phone: IntakePhoneValue;
  matched: string;
} | null {
  const labelled = labelledValue(
    text,
    /^(phone|mobile|contact(?:\s*(?:number|no\.?)?)?|number)$/i,
  );
  if (labelled) {
    const phone = parseIntakePhone(labelled);
    if (phone) return { phone, matched: labelled };
  }

  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) {
    const onlyPhone = parseIntakePhone(text);
    if (onlyPhone) return { phone: onlyPhone, matched: text.trim() };
  }

  PHONE_CANDIDATE_PATTERN.lastIndex = 0;
  const candidates = text.match(PHONE_CANDIDATE_PATTERN) ?? [];
  for (const candidate of candidates) {
    const phone = parseIntakePhone(candidate);
    if (phone) return { phone, matched: candidate };
  }

  for (const part of splitParts(text)) {
    const phone = parseIntakePhone(part);
    if (phone) return { phone, matched: part };
  }

  return null;
}

function cleanNameCandidate(value: string): string | null {
  const name = value
    .replace(/[^\s,;<>]+@[^\s,;<>]+/g, " ")
    .replace(
      /(?:^|\n)\s*(?:full\s*)?(?:creator\s*)?name\s*[:\-]\s*/gi,
      " ",
    )
    .replace(
      /(?:^|\n)\s*(?:e-?mail|mail|phone|mobile|contact(?:\s*number)?|number)\s*[:\-]\s*/gi,
      " ",
    )
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;
  if (name.length < 2) return null;
  if (isFakePlaceholder(name) || isUnknownOptionalAnswer(name)) return null;
  if (isValidEmailAddress(name)) return null;
  if (parseIntakePhone(name) && name.replace(/\D/g, "").length >= 8) return null;
  return name;
}

export function parseCreatorDetailsBundle(raw: string): {
  creatorName: string | null;
  email: string | null;
  phone: IntakePhoneValue | null;
} {
  const text = toUntrustedPlainText(raw);
  if (!text) {
    return { creatorName: null, email: null, phone: null };
  }

  const labelledEmail = labelledValue(text, /^(e-?mail|mail)$/i);
  const email =
    labelledEmail && isValidEmailAddress(labelledEmail)
      ? labelledEmail.trim().toLowerCase()
      : firstValidEmail(text);

  const labelledName = labelledValue(text, /^(full\s*)?(creator\s*)?name$/i);
  const phoneFound = extractPhoneFromText(text);

  let working = text;
  if (email) {
    working = working.replace(new RegExp(escapeRegExp(email), "ig"), " ");
  }
  working = working.replace(/[^\s,;<>]+@[^\s,;<>]+/g, " ");
  if (phoneFound) {
    working = working.replace(phoneFound.matched, " ");
  }

  const creatorName = cleanNameCandidate(labelledName ?? working);

  return {
    creatorName,
    email,
    phone: phoneFound?.phone ?? null,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keepExisting<T>(existing: T, parsed: T): T {
  if (existing !== null && existing !== undefined && existing !== "") {
    return existing;
  }
  return parsed;
}

export function mergeCreatorDetails(
  collected: IntakeCollectedData,
  raw: string,
): IntakeCollectedData {
  const parsed = parseCreatorDetailsBundle(raw);
  const explicitPhone = Boolean(parsed.phone?.normalized);
  const replacePhone =
    explicitPhone && (collected.phonePrefill || !collected.phoneNormalized);
  return {
    ...collected,
    creatorName: keepExisting(collected.creatorName, parsed.creatorName),
    email: keepExisting(collected.email, parsed.email),
    phoneDisplay: replacePhone
      ? parsed.phone?.display ?? null
      : collected.phoneDisplay,
    phoneNormalized: replacePhone
      ? parsed.phone?.normalized ?? null
      : collected.phoneNormalized,
    phonePrefill: replacePhone ? false : collected.phonePrefill,
  };
}

export function missingCreatorDetailsPrompt(
  collected: IntakeCollectedData,
): string | null {
  const missing: string[] = [];
  if (!collected.creatorName) missing.push("name");
  if (!collected.email) missing.push("email");
  if (!collected.phoneNormalized) missing.push("phone");
  if (missing.length === 0) return null;
  if (missing.length === 3) return CREATOR_DETAILS_PROMPT_TEXT;
  if (missing.length === 1) {
    if (missing[0] === "name") return "Please send your full name.";
    if (missing[0] === "email") return "Please send a valid email address.";
    return "Please send a valid contact number.";
  }
  if (!missing.includes("name")) {
    return "Please send a valid email address and contact number.";
  }
  if (!missing.includes("email")) {
    return "Please send your full name and contact number.";
  }
  return "Please send your full name and a valid email address.";
}

export function parsePlatformDetailsBundle(raw: string): {
  platform: IntakePlatform | null;
  socialHandle: string | null;
  socialHandleDisplay: string | null;
} {
  const text = toUntrustedPlainText(raw);
  if (!text) {
    return { platform: null, socialHandle: null, socialHandleDisplay: null };
  }

  let platform =
    normalizeIntakePlatform(labelledValue(text, /^(platform|channel)$/i) ?? "") ??
    null;
  if (!platform) {
    PLATFORM_FIND_PATTERN.lastIndex = 0;
    const matches = text.match(PLATFORM_FIND_PATTERN) ?? [];
    for (const match of matches) {
      platform = normalizeIntakePlatform(match);
      if (platform) break;
    }
  }

  const labelledHandle = labelledValue(
    text,
    /^(username|user\s*name|handle|social\s*handle|ig\s*handle)$/i,
  );
  let handleSource = labelledHandle;
  if (!handleSource) {
    const atMatch = text.match(HANDLE_AT_PATTERN);
    if (atMatch?.[0]) handleSource = atMatch[0];
  }
  if (!handleSource) {
    const remainder = text
      .replace(/\b(instagram|insta|ig|youtube|yt)\b/gi, " ")
      .replace(
        /(?:platform|channel|username|user\s*name|handle)\s*[:\-]/gi,
        " ",
      )
      .replace(/[,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    handleSource = remainder || null;
  }

  const handle = handleSource ? normalizeSocialHandle(handleSource) : null;
  return {
    platform,
    socialHandle: handle?.stored ?? null,
    socialHandleDisplay: handle?.display ?? null,
  };
}

export function mergePlatformDetails(
  collected: IntakeCollectedData,
  raw: string,
): IntakeCollectedData {
  const parsed = parsePlatformDetailsBundle(raw);
  return {
    ...collected,
    platform: keepExisting(collected.platform, parsed.platform),
    socialHandle: keepExisting(collected.socialHandle, parsed.socialHandle),
    socialHandleDisplay: keepExisting(
      collected.socialHandleDisplay,
      parsed.socialHandleDisplay,
    ),
  };
}

export function missingPlatformDetailsPrompt(
  collected: IntakeCollectedData,
): string | null {
  const missingPlatform = !collected.platform;
  const missingHandle = !collected.socialHandle;
  if (!missingPlatform && !missingHandle) return null;
  if (missingPlatform && missingHandle) return PLATFORM_DETAILS_PROMPT_TEXT;
  if (missingPlatform) {
    return "Please tell us whether this is Instagram or YouTube.";
  }
  return "Please send your username or handle.";
}

function requiredTextValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (isUnknownOptionalAnswer(trimmed) || isFakePlaceholder(trimmed)) {
    return null;
  }
  return trimmed;
}

export function parseCampaignDetailsBundle(
  raw: string,
  now: Date = new Date(),
): {
  brandName: string | null;
  campaignMonth: string | null;
} {
  const text = toUntrustedPlainText(raw);
  if (!text) {
    return { brandName: null, campaignMonth: null };
  }

  let brandName = requiredTextValue(
    labelledValue(text, /^(brand(?:\s*name)?)$/i),
  );
  const labelledMonth = labelledValue(
    text,
    /^(month|campaign\s*month|date)$/i,
  );
  const monthParse =
    parseCampaignMonthInput(labelledMonth ?? "", now) ??
    parseCampaignMonthInput(text, now);
  const campaignMonth = monthParse?.iso ?? null;

  if (!brandName) {
    let working = text;
    if (monthParse?.matched) {
      working = working.replace(monthParse.matched, " ");
    }
    working = working.replace(/[^\s,;<>]+@[^\s,;<>]+/g, " ");
    const parts = splitParts(working).map((part) => {
      const stripped = part.replace(
        /^(campaign(?:\s*name)?|brand(?:\s*name)?|month|campaign\s*month|date)\s*[:\-]\s*/i,
        "",
      );
      return stripped.trim();
    });
    const remaining = parts.filter(
      (part) =>
        requiredTextValue(part) &&
        parseCampaignMonthInput(part, now) === null &&
        !/^(campaign(?:\s*name)?|brand(?:\s*name)?|month|campaign\s*month|date)$/i.test(
          part,
        ),
    );
    if (remaining.length === 1) {
      brandName = requiredTextValue(remaining[0]);
    } else if (remaining.length === 2) {
      brandName = requiredTextValue(remaining[1]);
    }
  }

  return {
    brandName: requiredTextValue(brandName),
    campaignMonth,
  };
}

export function mergeCampaignDetails(
  collected: IntakeCollectedData,
  raw: string,
  now: Date = new Date(),
): IntakeCollectedData {
  const parsed = parseCampaignDetailsBundle(raw, now);
  const nextMonth = keepExisting(collected.campaignMonth, parsed.campaignMonth);
  return {
    ...collected,
    campaignName: null,
    brandName: keepExisting(collected.brandName, parsed.brandName),
    campaignMonth: nextMonth,
    campaignMonthConfirmed:
      nextMonth !== null &&
      nextMonth === collected.campaignMonth &&
      collected.campaignMonthConfirmed,
  };
}

export function missingCampaignDetailsPrompt(
  collected: IntakeCollectedData,
): string | null {
  const missing: string[] = [];
  if (!collected.brandName) missing.push("brand");
  if (!collected.campaignMonth) missing.push("month");
  if (missing.length === 0) return null;
  if (missing.length === 2) return CAMPAIGN_DETAILS_PROMPT_TEXT;
  if (missing[0] === "brand") return "Please send the brand name.";
  return "Please send the campaign month, for example June or June 2026.";
}

export function isIntakeComplete(collected: IntakeCollectedData): boolean {
  return Boolean(
    collected.creatorName &&
      collected.email &&
      collected.phoneNormalized &&
      collected.platform &&
      collected.socialHandle &&
      collected.brandName &&
      collected.campaignMonth &&
      collected.campaignMonthConfirmed,
  );
}

export function originalInboundForTicket(
  collected: IntakeCollectedData,
): string | null {
  const source = collected.originalInboundText;
  if (!source) return null;
  const plain = toUntrustedPlainText(source);
  return plain.length > 0 ? plain : null;
}

export function intakePromptForCurrentStep(
  field: IntakeField,
  collected: IntakeCollectedData,
): string {
  if (field === "creator_details") {
    return missingCreatorDetailsPrompt(collected) ?? CREATOR_DETAILS_PROMPT_TEXT;
  }
  if (field === "platform_details") {
    return missingPlatformDetailsPrompt(collected) ?? PLATFORM_DETAILS_PROMPT_TEXT;
  }
  return missingCampaignDetailsPrompt(collected) ?? CAMPAIGN_DETAILS_PROMPT_TEXT;
}

export const INTAKE_COLLECTED_VALUE_FIELDS = [
  "creatorName",
  "email",
  "phoneNormalized",
  "platform",
  "socialHandle",
  "brandName",
  "campaignMonth",
] as const;
