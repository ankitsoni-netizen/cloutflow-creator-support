import { isValidEmailAddress } from "@/lib/email/html";
import {
  PHONE_VALIDATION_MESSAGE,
  normalizePhoneNumber,
} from "@/lib/phone";
import {
  WEBSITE_FIELD_LIMITS,
  WEBSITE_HONEYPOT_FIELDS,
  WEBSITE_REQUESTER_TYPES,
  normalizeWebsiteCategory,
  normalizeWebsiteIssueType,
  normalizeWebsitePlatform,
  type WebsiteIssueTypeLabel,
  type WebsitePlatformLabel,
  type WebsiteRequestCategory,
  type WebsiteRequesterType,
} from "@/lib/public-intake/constants";

export { isValidPhoneNumber } from "@/lib/phone";

export type WebsiteTicketRequestBody = Record<string, unknown>;

type CommonValidated = {
  category: WebsiteRequestCategory;
  name: string;
  email: string;
  message: string;
};

export type ValidatedCreatorSupportInput = CommonValidated & {
  category: "creator_support";
  phone: string;
  socialHandle: string;
  platform: WebsitePlatformLabel;
  issueType: WebsiteIssueTypeLabel;
  campaignName: string;
  brandName: string;
  campaignMonth: string;
  cloutflowPocName: string | null;
  cloutflowPocContactNumber: string | null;
};

export type ValidatedTrackCampaignInput = CommonValidated & {
  category: "track_campaign";
  company: string;
  campaignNameOrId: string;
};

export type ValidatedProductDemoInput = CommonValidated & {
  category: "product_demo";
  company: string;
  phone: string | null;
};

export type ValidatedBrandSupportInput = CommonValidated & {
  category: "brand_support";
  company: string;
};

export type ValidatedReportingAnalyticsInput = CommonValidated & {
  category: "reporting_analytics";
  company: string;
};

export type ValidatedPaymentsCommercialsInput = CommonValidated & {
  category: "payments_commercials";
  requesterType: WebsiteRequesterType;
  company: string | null;
  socialHandle: string | null;
  campaignNameOrId: string | null;
};

export type ValidatedProductDocumentationInput = CommonValidated & {
  category: "product_documentation";
  topicOrModule: string;
};

export type ValidatedWebsiteTicketInput =
  | ValidatedCreatorSupportInput
  | ValidatedTrackCampaignInput
  | ValidatedProductDemoInput
  | ValidatedBrandSupportInput
  | ValidatedReportingAnalyticsInput
  | ValidatedPaymentsCommercialsInput
  | ValidatedProductDocumentationInput;

export type WebsiteValidationResult =
  | { ok: true; value: ValidatedWebsiteTicketInput }
  | { ok: false; error: string; status: 400 | 422 };

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim();
}

function firstPresent(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function requireString(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = asTrimmedString(value);
  if (trimmed === null || !trimmed) {
    return { ok: false, error: `${label} is required.` };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `${label} must be ${maxLength} characters or fewer.`,
    };
  }
  return { ok: true, value: trimmed };
}

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = asTrimmedString(value);
  if (trimmed === null || !trimmed) return { ok: true, value: null };
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `${label} must be ${maxLength} characters or fewer.`,
    };
  }
  return { ok: true, value: trimmed };
}

function requirePhone(
  value: unknown,
  label: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const required = requireString(value, label, WEBSITE_FIELD_LIMITS.phone);
  if (!required.ok) return required;
  const normalized = normalizePhoneNumber(required.value);
  if (!normalized) {
    return { ok: false, error: `${label}: ${PHONE_VALIDATION_MESSAGE}` };
  }
  return { ok: true, value: normalized };
}

function optionalPhone(
  value: unknown,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const optional = optionalString(value, label, WEBSITE_FIELD_LIMITS.phone);
  if (!optional.ok) return optional;
  if (!optional.value) return { ok: true, value: null };
  const normalized = normalizePhoneNumber(optional.value);
  if (!normalized) {
    return { ok: false, error: `${label}: ${PHONE_VALIDATION_MESSAGE}` };
  }
  return { ok: true, value: normalized };
}

function honeypotFilled(raw: WebsiteTicketRequestBody): boolean {
  return WEBSITE_HONEYPOT_FIELDS.some((field) => {
    const value = asTrimmedString(raw[field]);
    return Boolean(value);
  });
}

function validateCreatorSupport(
  raw: WebsiteTicketRequestBody,
  common: CommonValidated,
): WebsiteValidationResult {
  const phone = requirePhone(raw.phone, "Phone number");
  if (!phone.ok) return { ok: false, status: 400, error: phone.error };

  const socialHandle = requireString(
    raw.socialHandle,
    "Social media handle",
    WEBSITE_FIELD_LIMITS.socialHandle,
  );
  if (!socialHandle.ok) {
    return { ok: false, status: 400, error: socialHandle.error };
  }

  const platform = normalizeWebsitePlatform(asTrimmedString(raw.platform));
  if (!platform) {
    return {
      ok: false,
      status: 400,
      error: "Platform must be Instagram or YouTube.",
    };
  }

  const issueType = normalizeWebsiteIssueType(asTrimmedString(raw.issueType));
  if (!issueType) {
    return {
      ok: false,
      status: 400,
      error: "Select a valid issue type.",
    };
  }

  const campaignName = requireString(
    firstPresent(raw.campaignName, raw.campaignNameOrId),
    "Campaign name",
    WEBSITE_FIELD_LIMITS.campaignName,
  );
  if (!campaignName.ok) {
    return { ok: false, status: 400, error: campaignName.error };
  }

  const brandName = requireString(
    firstPresent(raw.brandName, raw.brand),
    "Brand name",
    WEBSITE_FIELD_LIMITS.brandName,
  );
  if (!brandName.ok) return { ok: false, status: 400, error: brandName.error };

  const campaignMonth = requireString(
    raw.campaignMonth,
    "Campaign month",
    WEBSITE_FIELD_LIMITS.campaignMonth,
  );
  if (!campaignMonth.ok) {
    return { ok: false, status: 400, error: campaignMonth.error };
  }

  const cloutflowPocName = optionalString(
    raw.cloutflowPocName,
    "Cloutflow POC name",
    WEBSITE_FIELD_LIMITS.cloutflowPocName,
  );
  if (!cloutflowPocName.ok) {
    return { ok: false, status: 400, error: cloutflowPocName.error };
  }

  const cloutflowPocContactNumber = optionalPhone(
    raw.cloutflowPocContactNumber,
    "Cloutflow POC contact number",
  );
  if (!cloutflowPocContactNumber.ok) {
    return { ok: false, status: 400, error: cloutflowPocContactNumber.error };
  }

  return {
    ok: true,
    value: {
      ...common,
      category: "creator_support",
      phone: phone.value,
      socialHandle: socialHandle.value,
      platform,
      issueType,
      campaignName: campaignName.value,
      brandName: brandName.value,
      campaignMonth: campaignMonth.value,
      cloutflowPocName: cloutflowPocName.value,
      cloutflowPocContactNumber: cloutflowPocContactNumber.value,
    },
  };
}

function validateTrackCampaign(
  raw: WebsiteTicketRequestBody,
  common: CommonValidated,
): WebsiteValidationResult {
  const company = requireString(
    raw.company,
    "Company",
    WEBSITE_FIELD_LIMITS.company,
  );
  if (!company.ok) return { ok: false, status: 400, error: company.error };

  const campaignNameOrId = requireString(
    firstPresent(raw.campaignNameOrId, raw.campaignName),
    "Campaign name or ID",
    WEBSITE_FIELD_LIMITS.campaignName,
  );
  if (!campaignNameOrId.ok) {
    return { ok: false, status: 400, error: campaignNameOrId.error };
  }

  return {
    ok: true,
    value: {
      ...common,
      category: "track_campaign",
      company: company.value,
      campaignNameOrId: campaignNameOrId.value,
    },
  };
}

function validateProductDemo(
  raw: WebsiteTicketRequestBody,
  common: CommonValidated,
): WebsiteValidationResult {
  const company = requireString(
    raw.company,
    "Company",
    WEBSITE_FIELD_LIMITS.company,
  );
  if (!company.ok) return { ok: false, status: 400, error: company.error };

  const phone = optionalPhone(raw.phone, "Phone number");
  if (!phone.ok) return { ok: false, status: 400, error: phone.error };

  return {
    ok: true,
    value: {
      ...common,
      category: "product_demo",
      company: company.value,
      phone: phone.value,
    },
  };
}

function validateCompanyOnly(
  raw: WebsiteTicketRequestBody,
  common: CommonValidated,
  category: "brand_support" | "reporting_analytics",
): WebsiteValidationResult {
  const company = requireString(
    raw.company,
    "Company",
    WEBSITE_FIELD_LIMITS.company,
  );
  if (!company.ok) return { ok: false, status: 400, error: company.error };

  return {
    ok: true,
    value: {
      ...common,
      category,
      company: company.value,
    },
  };
}

function validatePaymentsCommercials(
  raw: WebsiteTicketRequestBody,
  common: CommonValidated,
): WebsiteValidationResult {
  const requesterRaw = asTrimmedString(
    firstPresent(raw.requesterType, raw.audience),
  )?.toLowerCase();
  if (
    !requesterRaw ||
    !WEBSITE_REQUESTER_TYPES.includes(requesterRaw as WebsiteRequesterType)
  ) {
    return {
      ok: false,
      status: 400,
      error: "Requester type must be brand, creator, or agency.",
    };
  }
  const requesterType = requesterRaw as WebsiteRequesterType;

  if (requesterType === "creator") {
    const socialHandle = requireString(
      raw.socialHandle,
      "Social media handle",
      WEBSITE_FIELD_LIMITS.socialHandle,
    );
    if (!socialHandle.ok) {
      return { ok: false, status: 400, error: socialHandle.error };
    }
    return {
      ok: true,
      value: {
        ...common,
        category: "payments_commercials",
        requesterType,
        company: null,
        socialHandle: socialHandle.value,
        campaignNameOrId: null,
      },
    };
  }

  const company = requireString(
    raw.company,
    "Company",
    WEBSITE_FIELD_LIMITS.company,
  );
  if (!company.ok) return { ok: false, status: 400, error: company.error };

  const campaignNameOrId = requireString(
    firstPresent(raw.campaignNameOrId, raw.campaignName),
    "Campaign name or ID",
    WEBSITE_FIELD_LIMITS.campaignName,
  );
  if (!campaignNameOrId.ok) {
    return { ok: false, status: 400, error: campaignNameOrId.error };
  }

  return {
    ok: true,
    value: {
      ...common,
      category: "payments_commercials",
      requesterType,
      company: company.value,
      socialHandle: null,
      campaignNameOrId: campaignNameOrId.value,
    },
  };
}

function validateProductDocumentation(
  raw: WebsiteTicketRequestBody,
  common: CommonValidated,
): WebsiteValidationResult {
  const topicOrModule = requireString(
    firstPresent(raw.topicOrModule, raw.topic),
    "Topic or module",
    WEBSITE_FIELD_LIMITS.topicOrModule,
  );
  if (!topicOrModule.ok) {
    return { ok: false, status: 400, error: topicOrModule.error };
  }

  return {
    ok: true,
    value: {
      ...common,
      category: "product_documentation",
      topicOrModule: topicOrModule.value,
    },
  };
}

/**
 * Category-aware public website intake validation.
 * Accepts both the richer creator-support payload and general enquiry shapes
 * used by cloutflow.com/help (including kebab-case aliases).
 */
export function validateWebsiteTicketBody(
  body: unknown,
): WebsiteValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      error: "Request body must be a JSON object.",
    };
  }

  const raw = body as WebsiteTicketRequestBody;

  if (honeypotFilled(raw)) {
    return {
      ok: false,
      status: 422,
      error: "Unable to submit this request.",
    };
  }

  const categoryRaw = asTrimmedString(
    firstPresent(raw.category, raw.ticketType, raw.requestCategory),
  );
  const category = normalizeWebsiteCategory(categoryRaw);
  if (!category) {
    return {
      ok: false,
      status: 400,
      error: "Select a valid enquiry category.",
    };
  }

  const name = requireString(
    firstPresent(raw.name, raw.creatorName),
    "Name",
    WEBSITE_FIELD_LIMITS.name,
  );
  if (!name.ok) return { ok: false, status: 400, error: name.error };

  const email = requireString(
    raw.email,
    "Email address",
    WEBSITE_FIELD_LIMITS.email,
  );
  if (!email.ok) return { ok: false, status: 400, error: email.error };
  if (!isValidEmailAddress(email.value)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }

  const message = optionalString(
    firstPresent(raw.message, raw.issueDescription),
    "Message",
    WEBSITE_FIELD_LIMITS.message,
  );
  if (!message.ok) return { ok: false, status: 400, error: message.error };

  const common: CommonValidated = {
    category,
    name: name.value,
    email: email.value.toLowerCase(),
    message: message.value ?? "",
  };

  switch (category) {
    case "creator_support":
      return validateCreatorSupport(raw, common);
    case "track_campaign":
      return validateTrackCampaign(raw, common);
    case "product_demo":
      return validateProductDemo(raw, common);
    case "brand_support":
      return validateCompanyOnly(raw, common, "brand_support");
    case "reporting_analytics":
      return validateCompanyOnly(raw, common, "reporting_analytics");
    case "payments_commercials":
      return validatePaymentsCommercials(raw, common);
    case "product_documentation":
      return validateProductDocumentation(raw, common);
    default: {
      const _exhaustive: never = category;
      return {
        ok: false,
        status: 400,
        error: `Unsupported category: ${_exhaustive}`,
      };
    }
  }
}
