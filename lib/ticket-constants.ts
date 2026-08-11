export const ISSUE_TYPES = [
  "Payment Delayed",
  "TDS Query",
  "POC / Conduct Concern",
  "GST Query",
  "Campaign Brief Clarification",
  "Content Approval Delay",
  "Contract / Agreement",
  "Other",
] as const;

export type IssueTypeLabel = (typeof ISSUE_TYPES)[number];

/** Maps UI labels to likely DB enum/text values. */
export const ISSUE_TYPE_TO_DB: Record<IssueTypeLabel, string> = {
  "Payment Delayed": "payment_delayed",
  "TDS Query": "tds_query",
  "POC / Conduct Concern": "poc_conduct_concern",
  "GST Query": "gst_query",
  "Campaign Brief Clarification": "campaign_brief_clarification",
  "Content Approval Delay": "content_approval_delay",
  "Contract / Agreement": "contract_agreement",
  Other: "other",
};

export const ISSUE_TYPE_FROM_DB: Record<string, IssueTypeLabel> =
  Object.fromEntries(
    Object.entries(ISSUE_TYPE_TO_DB).map(([label, dbValue]) => [
      dbValue,
      label as IssueTypeLabel,
    ]),
  ) as Record<string, IssueTypeLabel>;

export const EXECUTIVES = [
  "Priya Sharma",
  "Rahul Mehta",
  "Ananya Iyer",
  "Vikram Desai",
  "Neha Kapoor",
];
