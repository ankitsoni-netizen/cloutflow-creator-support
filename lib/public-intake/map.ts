import {
  WEBSITE_CATEGORY_LABELS,
  WEBSITE_ISSUE_TYPE_TO_DB,
  WEBSITE_PLATFORM_TO_DB,
  WEBSITE_REQUESTER_TYPE_LABELS,
  WEBSITE_TICKET_TRUSTED_DEFAULTS,
  type IntakeSourceChannel,
} from "@/lib/public-intake/constants";
import type { ValidatedWebsiteTicketInput } from "@/lib/public-intake/validate";
import { parseCampaignMonthForDb } from "@/lib/tickets/map";
import type {
  DbRequestCategory,
  DbRequesterType,
  DbTicketInsert,
} from "@/lib/tickets/types";

export type WebsiteTicketInsert = Omit<DbTicketInsert, "source_channel"> & {
  source_channel: IntakeSourceChannel;
  request_category: DbRequestCategory;
  company_name: string | null;
  requester_type: DbRequesterType | null;
  topic_or_module: string | null;
  intake_details: Record<string, unknown>;
};

function baseTrustedFields(
  sourceChannel: IntakeSourceChannel = WEBSITE_TICKET_TRUSTED_DEFAULTS.source_channel,
) {
  return {
    source_channel: sourceChannel,
    status: WEBSITE_TICKET_TRUSTED_DEFAULTS.status,
    priority: WEBSITE_TICKET_TRUSTED_DEFAULTS.priority,
    assigned_team: WEBSITE_TICKET_TRUSTED_DEFAULTS.assigned_team,
    assigned_executive_id: null,
    assigned_executive_name: null,
    internal_notes: null,
    acknowledgement_email_requested:
      WEBSITE_TICKET_TRUSTED_DEFAULTS.acknowledgement_email_requested,
  } as const;
}

/**
 * Maps a validated public website form payload to a tickets insert row.
 * Workflow fields are hardcoded server-side and never taken from the browser.
 * Missing campaign fields stay null — never filled with fake placeholders.
 * `sourceChannel` defaults to "website"; WhatsApp intake passes "whatsapp".
 */
export function mapWebsiteFormToDbInsert(
  input: ValidatedWebsiteTicketInput,
  sourceChannel: IntakeSourceChannel = WEBSITE_TICKET_TRUSTED_DEFAULTS.source_channel,
): { insert: WebsiteTicketInsert } | { error: string } {
  const trusted = baseTrustedFields(sourceChannel);

  if (input.category === "creator_support") {
    const campaignMonth = parseCampaignMonthForDb(input.campaignMonth);
    if (!campaignMonth) {
      return {
        error:
          "Enter campaign month as a month and year, for example August 2026.",
      };
    }

    return {
      insert: {
        creator_name: input.name,
        creator_phone: input.phone,
        creator_email: input.email,
        social_handle: input.socialHandle,
        platform: WEBSITE_PLATFORM_TO_DB[input.platform],
        issue_type: WEBSITE_ISSUE_TYPE_TO_DB[input.issueType],
        campaign_name: input.campaignName,
        brand_name: input.brandName,
        campaign_month: campaignMonth,
        cloutflow_poc_name: input.cloutflowPocName,
        cloutflow_poc_contact_number: input.cloutflowPocContactNumber,
        request_category: input.category,
        company_name: null,
        requester_type: null,
        topic_or_module: null,
        intake_details: {
          category: input.category,
          categoryLabel: WEBSITE_CATEGORY_LABELS[input.category],
          platform: input.platform,
          issueType: input.issueType,
        },
        issue_description: input.message || null,
        ...trusted,
      },
    };
  }

  if (input.category === "track_campaign") {
    return {
      insert: {
        creator_name: input.name,
        creator_phone: null,
        creator_email: input.email,
        social_handle: null,
        platform: null,
        issue_type: null,
        campaign_name: input.campaignNameOrId,
        brand_name: null,
        campaign_month: null,
        cloutflow_poc_name: null,
        cloutflow_poc_contact_number: null,
        request_category: input.category,
        company_name: input.company,
        requester_type: null,
        topic_or_module: null,
        intake_details: {
          category: input.category,
          categoryLabel: WEBSITE_CATEGORY_LABELS[input.category],
          company: input.company,
          campaignNameOrId: input.campaignNameOrId,
        },
        issue_description: input.message,
        ...trusted,
      },
    };
  }

  if (input.category === "product_demo") {
    return {
      insert: {
        creator_name: input.name,
        creator_phone: input.phone,
        creator_email: input.email,
        social_handle: null,
        platform: null,
        issue_type: null,
        campaign_name: null,
        brand_name: null,
        campaign_month: null,
        cloutflow_poc_name: null,
        cloutflow_poc_contact_number: null,
        request_category: input.category,
        company_name: input.company,
        requester_type: null,
        topic_or_module: null,
        intake_details: {
          category: input.category,
          categoryLabel: WEBSITE_CATEGORY_LABELS[input.category],
          company: input.company,
          ...(input.phone ? { phone: input.phone } : {}),
        },
        issue_description: input.message,
        ...trusted,
      },
    };
  }

  if (
    input.category === "brand_support" ||
    input.category === "reporting_analytics"
  ) {
    return {
      insert: {
        creator_name: input.name,
        creator_phone: null,
        creator_email: input.email,
        social_handle: null,
        platform: null,
        issue_type: null,
        campaign_name: null,
        brand_name: null,
        campaign_month: null,
        cloutflow_poc_name: null,
        cloutflow_poc_contact_number: null,
        request_category: input.category,
        company_name: input.company,
        requester_type: null,
        topic_or_module: null,
        intake_details: {
          category: input.category,
          categoryLabel: WEBSITE_CATEGORY_LABELS[input.category],
          company: input.company,
        },
        issue_description: input.message,
        ...trusted,
      },
    };
  }

  if (input.category === "payments_commercials") {
    return {
      insert: {
        creator_name: input.name,
        creator_phone: null,
        creator_email: input.email,
        social_handle: input.socialHandle,
        platform: null,
        issue_type: null,
        campaign_name: input.campaignNameOrId,
        brand_name: null,
        campaign_month: null,
        cloutflow_poc_name: null,
        cloutflow_poc_contact_number: null,
        request_category: input.category,
        company_name: input.company,
        requester_type: input.requesterType,
        topic_or_module: null,
        intake_details: {
          category: input.category,
          categoryLabel: WEBSITE_CATEGORY_LABELS[input.category],
          requesterType: input.requesterType,
          requesterTypeLabel: WEBSITE_REQUESTER_TYPE_LABELS[input.requesterType],
          ...(input.company ? { company: input.company } : {}),
          ...(input.socialHandle ? { socialHandle: input.socialHandle } : {}),
          ...(input.campaignNameOrId
            ? { campaignNameOrId: input.campaignNameOrId }
            : {}),
        },
        issue_description: input.message,
        ...trusted,
      },
    };
  }

  return {
    insert: {
      creator_name: input.name,
      creator_phone: null,
      creator_email: input.email,
      social_handle: null,
      platform: null,
      issue_type: null,
      campaign_name: null,
      brand_name: null,
      campaign_month: null,
      cloutflow_poc_name: null,
      cloutflow_poc_contact_number: null,
      request_category: input.category,
      company_name: null,
      requester_type: null,
      topic_or_module: input.topicOrModule,
      intake_details: {
        category: input.category,
        categoryLabel: WEBSITE_CATEGORY_LABELS[input.category],
        topicOrModule: input.topicOrModule,
      },
      issue_description: input.message,
      ...trusted,
    },
  };
}
