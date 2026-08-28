import { formatCampaignMonthNameYear } from "@/lib/tickets/campaign-month";

export const CAMPAIGN_MONTH_YES_PAYLOAD = "MONTH_CONFIRM_YES";
export const CAMPAIGN_MONTH_NO_PAYLOAD = "MONTH_CONFIRM_NO";
export const CAMPAIGN_MONTH_YES_TITLE = "Yes";
export const CAMPAIGN_MONTH_NO_TITLE = "No";

export const CAMPAIGN_MONTH_REASK_TEXT =
  "No problem. Please send the campaign month again.";

export const CAMPAIGN_MONTH_CHOOSE_TEXT = "Please choose Yes or No.";

export function campaignMonthConfirmationText(iso: string): string {
  return `I understood the campaign month as ${formatCampaignMonthNameYear(iso)}. Is that correct?`;
}

export function monthConfirmationQuickReplies(): Array<{
  content_type: "text";
  title: string;
  payload: string;
}> {
  return [
    {
      content_type: "text",
      title: CAMPAIGN_MONTH_YES_TITLE,
      payload: CAMPAIGN_MONTH_YES_PAYLOAD,
    },
    {
      content_type: "text",
      title: CAMPAIGN_MONTH_NO_TITLE,
      payload: CAMPAIGN_MONTH_NO_PAYLOAD,
    },
  ];
}

export function isMonthConfirmYesPayload(payload: string | null): boolean {
  return payload?.trim().toUpperCase() === CAMPAIGN_MONTH_YES_PAYLOAD;
}

export function isMonthConfirmNoPayload(payload: string | null): boolean {
  return payload?.trim().toUpperCase() === CAMPAIGN_MONTH_NO_PAYLOAD;
}
