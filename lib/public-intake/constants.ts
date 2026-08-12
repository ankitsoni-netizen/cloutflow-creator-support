/** Canonical website enquiry categories (snake_case API + DB values). */
export const WEBSITE_REQUEST_CATEGORIES = [
  "creator_support",
  "track_campaign",
  "product_demo",
  "brand_support",
  "reporting_analytics",
  "payments_commercials",
  "product_documentation",
] as const;

export type WebsiteRequestCategory = (typeof WEBSITE_REQUEST_CATEGORIES)[number];

/** Live cloutflow.com/help still uses kebab-case option values. */
export const WEBSITE_CATEGORY_ALIASES: Record<string, WebsiteRequestCategory> = {
  creator_support: "creator_support",
  "creator-support": "creator_support",
  track_campaign: "track_campaign",
  "track-campaign": "track_campaign",
  product_demo: "product_demo",
  "product-demo": "product_demo",
  brand_support: "brand_support",
  "brand-support": "brand_support",
  reporting_analytics: "reporting_analytics",
  "reporting-analytics": "reporting_analytics",
  payments_commercials: "payments_commercials",
  "payments-commercials": "payments_commercials",
  product_documentation: "product_documentation",
  "product-documentation": "product_documentation",
};

export const WEBSITE_CATEGORY_LABELS: Record<WebsiteRequestCategory, string> = {
  creator_support: "Creator support",
  track_campaign: "Track your campaign",
  product_demo: "Product demo",
  brand_support: "Brand support",
  reporting_analytics: "Reporting & analytics",
  payments_commercials: "Payments & commercials",
  product_documentation: "Product documentation",
};

export const WEBSITE_REQUESTER_TYPES = ["brand", "creator", "agency"] as const;
export type WebsiteRequesterType = (typeof WEBSITE_REQUESTER_TYPES)[number];

export const WEBSITE_REQUESTER_TYPE_LABELS: Record<
  WebsiteRequesterType,
  string
> = {
  brand: "Brand / agency",
  creator: "Creator",
  agency: "Agency",
};

/** Public website form issue labels (creator_support only). */
export const WEBSITE_ISSUE_TYPES = [
  "Payment Delayed / Not Received",
  "TDS Query",
  "GST Query",
  "POC / Conduct Concern",
  "Other",
] as const;

export type WebsiteIssueTypeLabel = (typeof WEBSITE_ISSUE_TYPES)[number];

/** Maps public form labels onto existing tickets.issue_type DB values. */
export const WEBSITE_ISSUE_TYPE_TO_DB: Record<WebsiteIssueTypeLabel, string> = {
  "Payment Delayed / Not Received": "payment_delayed",
  "TDS Query": "tds_query",
  "GST Query": "gst_query",
  "POC / Conduct Concern": "poc_conduct_concern",
  Other: "other",
};

export const WEBSITE_PLATFORMS = ["Instagram", "YouTube"] as const;
export type WebsitePlatformLabel = (typeof WEBSITE_PLATFORMS)[number];

export const WEBSITE_PLATFORM_TO_DB: Record<
  WebsitePlatformLabel,
  "instagram" | "youtube"
> = {
  Instagram: "instagram",
  YouTube: "youtube",
};

/** Trusted server-side defaults — never accept these from the browser. */
export const WEBSITE_TICKET_TRUSTED_DEFAULTS = {
  source_channel: "website" as const,
  status: "open" as const,
  priority: "normal" as const,
  assigned_team: "Creator Support",
  acknowledgement_email_requested: true,
} as const;

export const WEBSITE_INTAKE_MAX_BODY_BYTES = 32 * 1024;

export const WEBSITE_FIELD_LIMITS = {
  name: 120,
  phone: 20,
  email: 254,
  socialHandle: 100,
  company: 200,
  campaignName: 200,
  brandName: 200,
  campaignMonth: 40,
  cloutflowPocName: 120,
  cloutflowPocContactNumber: 20,
  message: 5000,
  topicOrModule: 200,
  requesterType: 40,
  honeypot: 200,
} as const;

/** Hidden honeypot field names — bots often fill every input. */
export const WEBSITE_HONEYPOT_FIELDS = ["companyWebsite", "website"] as const;

export function normalizeWebsiteCategory(
  value: string | null | undefined,
): WebsiteRequestCategory | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return WEBSITE_CATEGORY_ALIASES[key] ?? null;
}

export function websiteCategoryLabel(
  value: string | null | undefined,
): string {
  const normalized = normalizeWebsiteCategory(value) ?? value?.trim();
  if (!normalized) return "";
  if (normalized in WEBSITE_CATEGORY_LABELS) {
    return WEBSITE_CATEGORY_LABELS[normalized as WebsiteRequestCategory];
  }
  return normalized;
}
