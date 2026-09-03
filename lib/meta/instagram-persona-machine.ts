import {
  commandAllowedAtState,
  detectInstagramPersonaCommand,
  isGlobalFlowBack,
  isGlobalMenuOrRestart,
  type InstagramPersonaCommand,
} from "@/lib/meta/instagram-persona-commands";
import {
  activeTicketAttachText,
  AGENCY_DETAILS_TEXT,
  AGENCY_EDIT_PAYLOAD,
  AGENCY_EDIT_TITLE,
  AGENCY_SEND_CONFIRMED_TEXT,
  AGENCY_SEND_PAYLOAD,
  AGENCY_SEND_TITLE,
  agencySummaryText,
  BRAND_ACTION_TEXT,
  BRAND_BOOK_CALL_PAYLOAD,
  BRAND_BOOK_CALL_TITLE,
  BRAND_BOOK_DEMO_PAYLOAD,
  BRAND_BOOK_DEMO_TITLE,
  BRAND_BOOKING_TEXT,
  CREATOR_APPLY_TEXT,
  CREATOR_CAMPAIGN_DETAILS_TEXT,
  CREATOR_CAMPAIGN_ISSUE_PAYLOAD,
  CREATOR_CAMPAIGN_ISSUE_TITLE,
  CREATOR_EXISTING_CAMPAIGN_PAYLOAD,
  CREATOR_EXISTING_CAMPAIGN_TITLE,
  CREATOR_ISSUE_CATEGORY_TEXT,
  CREATOR_ISSUE_DETAILS_TEXT,
  CREATOR_NEW_WORK_PAYLOAD,
  CREATOR_NEW_WORK_TITLE,
  CREATOR_PAYMENT_ISSUE_PAYLOAD,
  CREATOR_PAYMENT_ISSUE_TITLE,
  CREATOR_REASON_TEXT,
  CREATOR_TICKET_CONFIRM_PAYLOAD,
  CREATOR_TICKET_CONFIRM_TITLE,
  CREATOR_TICKET_EDIT_PAYLOAD,
  CREATOR_TICKET_EDIT_TITLE,
  creatorConfirmationText,
  FLOW_BACK_PAYLOAD,
  FLOW_BACK_TITLE,
  FLOW_CANCEL_PAYLOAD,
  FLOW_CANCEL_TITLE,
  INSTAGRAM_SAFE_MESSAGE_LENGTH,
  INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
  OTHER_CONTACT_TEXT,
  OTHER_EDIT_PAYLOAD,
  OTHER_EDIT_TITLE,
  OTHER_INQUIRY_TEXT,
  OTHER_SEND_CONFIRMED_TEXT,
  OTHER_SEND_PAYLOAD,
  OTHER_SEND_TITLE,
  otherSummaryText,
  PERSONA_AGENCY_PAYLOAD,
  PERSONA_AGENCY_TITLE,
  PERSONA_BRAND_PAYLOAD,
  PERSONA_BRAND_TITLE,
  PERSONA_CREATOR_PAYLOAD,
  PERSONA_CREATOR_TITLE,
  PERSONA_OTHER_PAYLOAD,
  PERSONA_OTHER_TITLE,
  personaWelcomeText,
  POST_COMPLETION_QUESTION_TEXT,
  POST_DONE_PAYLOAD,
  POST_DONE_TEXT,
  POST_DONE_TITLE,
  POST_MAIN_MENU_PAYLOAD,
  POST_MAIN_MENU_TITLE,
  truncateDisplayedIssue,
  withPostCompletionQuestion,
} from "@/lib/meta/instagram-persona-copy";
import {
  mergeAgencyDetailFields,
  mergeCreatorCampaignFields,
  mergeOtherContactFields,
  missingAgencyDetailsPrompt,
  missingCreatorCampaignPrompt,
  missingOtherContactPrompt,
  parseAgencyDetailsBundle,
  parseCreatorCampaignBundle,
  parseMeaningfulDetails,
  parseOtherContactBundle,
} from "@/lib/meta/instagram-persona-parse";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  clearInstagramJourneyCollected,
  originalInboundForTicket,
  type IntakeCollectedData,
} from "@/lib/meta/intake-validate";
import {
  PERSONA_PROMPT,
  personaStatePromptKey,
} from "@/lib/meta/prompt-keys";
import { formatCampaignMonthForDisplay } from "@/lib/tickets/map";
import {
  campaignMonthConfirmationText,
  CAMPAIGN_MONTH_CHOOSE_TEXT,
  CAMPAIGN_MONTH_REASK_TEXT,
  monthConfirmationQuickReplies,
} from "@/lib/meta/month-confirmation";
import type {
  ConversationSnapshot,
  InboundSignal,
  InstagramQuickReply,
  MachineEffect,
  MachineResult,
  MachineSendEffect,
} from "@/lib/meta/conversation-machine";

export const INSTAGRAM_PERSONA_STATES = [
  "awaiting_persona",
  "awaiting_creator_reason",
  "awaiting_creator_issue_category",
  "creator_campaign_details",
  "awaiting_month_confirmation",
  "creator_issue_details",
  "creator_confirmation",
  "brand_action",
  "agency_details",
  "agency_confirmation",
  "other_inquiry",
  "other_contact",
  "other_confirmation",
  "awaiting_post_completion",
  "completed",
] as const;

export type InstagramPersonaState = (typeof INSTAGRAM_PERSONA_STATES)[number];

const PERSONA_STATE_SET = new Set<string>(INSTAGRAM_PERSONA_STATES);

/** Reversible intake states and where FLOW_BACK / typed back navigates. */
export const INSTAGRAM_FLOW_BACK_TRANSITIONS: Readonly<
  Record<string, InstagramPersonaState>
> = {
  awaiting_creator_reason: "awaiting_persona",
  awaiting_creator_issue_category: "awaiting_creator_reason",
  creator_campaign_details: "awaiting_creator_issue_category",
  awaiting_month_confirmation: "creator_campaign_details",
  creator_issue_details: "creator_campaign_details",
  creator_confirmation: "awaiting_month_confirmation",
  brand_action: "awaiting_persona",
  agency_details: "awaiting_persona",
  agency_confirmation: "agency_details",
  other_inquiry: "awaiting_persona",
  other_contact: "other_inquiry",
  other_confirmation: "other_contact",
};

const LEGACY_CHATBOT_STATES = new Set<string>([
  "unclassified",
  "awaiting_route",
  "collaboration",
  "support_intake",
  "awaiting_confirmation",
  "cancelled",
  "new",
  "closed",
  "ticket_created",
  "human_handoff",
  "collecting_name",
  "collecting_email",
  "collecting_phone",
  "collecting_social_handle",
  "collecting_platform",
  "collecting_issue_type",
  "collecting_campaign",
  "collecting_brand",
  "collecting_campaign_month",
  "collecting_poc",
  "collecting_description",
  "confirming",
]);

function qr(title: string, payload: string): InstagramQuickReply {
  return {
    content_type: "text",
    title: title.slice(0, 20),
    payload,
  };
}

function flowBackQuickReply(): InstagramQuickReply {
  return qr(FLOW_BACK_TITLE, FLOW_BACK_PAYLOAD);
}

export function isInstagramFlowBackState(state: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    INSTAGRAM_FLOW_BACK_TRANSITIONS,
    state,
  );
}

/** Append Go back to reversible prompts; leave non-reversible prompts unchanged. */
export function withFlowBackQuickReply(
  state: string,
  replies: InstagramQuickReply[],
): InstagramQuickReply[] {
  if (!isInstagramFlowBackState(state)) return replies;
  if (replies.some((reply) => reply.payload === FLOW_BACK_PAYLOAD)) {
    return replies;
  }
  return [...replies, flowBackQuickReply()];
}

export function personaQuickReplies(): InstagramQuickReply[] {
  return [
    qr(PERSONA_CREATOR_TITLE, PERSONA_CREATOR_PAYLOAD),
    qr(PERSONA_BRAND_TITLE, PERSONA_BRAND_PAYLOAD),
    qr(PERSONA_AGENCY_TITLE, PERSONA_AGENCY_PAYLOAD),
    qr(PERSONA_OTHER_TITLE, PERSONA_OTHER_PAYLOAD),
  ];
}

export function creatorReasonQuickReplies(): InstagramQuickReply[] {
  return [
    qr(CREATOR_NEW_WORK_TITLE, CREATOR_NEW_WORK_PAYLOAD),
    qr(CREATOR_EXISTING_CAMPAIGN_TITLE, CREATOR_EXISTING_CAMPAIGN_PAYLOAD),
  ];
}

export function creatorIssueCategoryQuickReplies(): InstagramQuickReply[] {
  return [
    qr(CREATOR_CAMPAIGN_ISSUE_TITLE, CREATOR_CAMPAIGN_ISSUE_PAYLOAD),
    qr(CREATOR_PAYMENT_ISSUE_TITLE, CREATOR_PAYMENT_ISSUE_PAYLOAD),
  ];
}

export function creatorConfirmationQuickReplies(): InstagramQuickReply[] {
  return [
    qr(CREATOR_TICKET_CONFIRM_TITLE, CREATOR_TICKET_CONFIRM_PAYLOAD),
    qr(CREATOR_TICKET_EDIT_TITLE, CREATOR_TICKET_EDIT_PAYLOAD),
    qr(FLOW_CANCEL_TITLE, FLOW_CANCEL_PAYLOAD),
  ];
}

export function brandActionQuickReplies(): InstagramQuickReply[] {
  return [
    qr(BRAND_BOOK_CALL_TITLE, BRAND_BOOK_CALL_PAYLOAD),
    qr(BRAND_BOOK_DEMO_TITLE, BRAND_BOOK_DEMO_PAYLOAD),
  ];
}

export function agencyConfirmationQuickReplies(): InstagramQuickReply[] {
  return [
    qr(AGENCY_SEND_TITLE, AGENCY_SEND_PAYLOAD),
    qr(AGENCY_EDIT_TITLE, AGENCY_EDIT_PAYLOAD),
    qr(FLOW_CANCEL_TITLE, FLOW_CANCEL_PAYLOAD),
  ];
}

export function otherConfirmationQuickReplies(): InstagramQuickReply[] {
  return [
    qr(OTHER_SEND_TITLE, OTHER_SEND_PAYLOAD),
    qr(OTHER_EDIT_TITLE, OTHER_EDIT_PAYLOAD),
    qr(FLOW_CANCEL_TITLE, FLOW_CANCEL_PAYLOAD),
  ];
}

export function postCompletionQuickReplies(): InstagramQuickReply[] {
  return [
    qr(POST_MAIN_MENU_TITLE, POST_MAIN_MENU_PAYLOAD),
    qr(POST_DONE_TITLE, POST_DONE_PAYLOAD),
  ];
}

export function personaPromptKey(
  state: string,
  retryMessageId?: string | null,
  promptKeyBase?: string | null,
): string {
  if (promptKeyBase) {
    return retryMessageId
      ? `${promptKeyBase}:retry:${retryMessageId}`
      : promptKeyBase;
  }
  return personaStatePromptKey(state, retryMessageId);
}

/** Navigation-specific prompt key so revisiting a state does not reuse the prior outbound row. */
export function personaBackPromptKey(
  targetState: string,
  inboundMessageId: string,
): string {
  return `${targetState}:back:${inboundMessageId}`;
}

function greetingName(snapshot: ConversationSnapshot): string | null {
  return snapshot.collected.cachedUsername ?? snapshot.suggestedSocialHandle;
}

function hasActiveTicket(snapshot: ConversationSnapshot): boolean {
  return Boolean(
    snapshot.ticketId && isActiveTicketStatus(snapshot.ticketStatus),
  );
}

function isStuckPostCompletionWithoutTicket(
  snapshot: ConversationSnapshot,
): boolean {
  if (snapshot.state !== "awaiting_post_completion") return false;
  if (snapshot.ticketId) return false;
  return !hasActiveTicket(snapshot);
}

function isCompletedNonTicketPostCompletion(
  snapshot: ConversationSnapshot,
): boolean {
  const collected = snapshot.collected;
  if (collected.igCreatorReason === "new_work") return true;
  return (
    collected.igPersona === "brand" ||
    collected.igPersona === "agency" ||
    collected.igPersona === "other"
  );
}

/** Broken Production rows after month Yes skipped Raise ticket. */
export function isRecoverableCreatorConfirmation(
  snapshot: ConversationSnapshot,
): boolean {
  if (!isStuckPostCompletionWithoutTicket(snapshot)) return false;
  const collected = snapshot.collected;
  return Boolean(
    collected.igIssueCategory &&
      collected.brandName &&
      collected.campaignMonth &&
      collected.email &&
      collected.campaignMonthConfirmed,
  );
}

/**
 * Stuck creator-ticket intake with incomplete collected data. Brand / agency /
 * other / apply-link completions stay on the post-completion question.
 */
export function isIncompletePostCompletionWithoutTicket(
  snapshot: ConversationSnapshot,
): boolean {
  if (!isStuckPostCompletionWithoutTicket(snapshot)) return false;
  if (isRecoverableCreatorConfirmation(snapshot)) return false;
  return !isCompletedNonTicketPostCompletion(snapshot);
}

export function isSafeStuckPostCompletionRecovery(
  result: MachineResult,
): boolean {
  if (result.effects.some((effect) => effect.type === "create_ticket")) {
    return false;
  }
  return (
    result.snapshot.state === "creator_confirmation" ||
    result.snapshot.state === "awaiting_persona"
  );
}

function isResolvedTicket(snapshot: ConversationSnapshot): boolean {
  return (snapshot.ticketStatus ?? "").trim().toLowerCase() === "resolved";
}

function withActivity(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  patch: Partial<ConversationSnapshot>,
): ConversationSnapshot {
  return {
    ...snapshot,
    ...patch,
    lastActivityAt: signal.timestamp,
    lastProcessedExternalMessageId: signal.messageId,
  };
}

function alreadyProcessed(snapshot: ConversationSnapshot): MachineResult {
  return {
    snapshot,
    effects: [],
    attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    inboundRoutingKind:
      snapshot.routingIntent === "collaboration"
        ? "collaboration"
        : snapshot.routingIntent === "creator_support"
          ? "support"
          : "unclassified",
    processed: false,
  };
}

function sendQr(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  patch: Partial<ConversationSnapshot>,
  text: string,
  state: string,
  replies: InstagramQuickReply[],
  retry: boolean,
  inboundRoutingKind: MachineResult["inboundRoutingKind"] = "unclassified",
  extraEffects: MachineEffect[] = [],
  promptKeyBase?: string,
): MachineResult {
  const key = personaPromptKey(
    state,
    retry ? signal.messageId : null,
    promptKeyBase,
  );
  return {
    snapshot: withActivity(snapshot, signal, {
      ...patch,
      state,
      lastPromptKey: key,
    }),
    effects: [
      ...extraEffects,
      {
        type: "send_quick_replies",
        text,
        promptKey: key,
        quickReplies: withFlowBackQuickReply(state, replies),
      },
    ],
    attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    inboundRoutingKind,
    processed: true,
  };
}

function sendText(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  patch: Partial<ConversationSnapshot>,
  text: string,
  state: string,
  retry: boolean,
  inboundRoutingKind: MachineResult["inboundRoutingKind"] = "unclassified",
  promptKeyBase?: string,
): MachineResult {
  if (isInstagramFlowBackState(state)) {
    return sendQr(
      snapshot,
      signal,
      patch,
      text,
      state,
      [],
      retry,
      inboundRoutingKind,
      [],
      promptKeyBase,
    );
  }
  const key = personaPromptKey(
    state,
    retry ? signal.messageId : null,
    promptKeyBase,
  );
  return {
    snapshot: withActivity(snapshot, signal, {
      ...patch,
      state,
      lastPromptKey: key,
    }),
    effects: [{ type: "send_text", text, promptKey: key }],
    attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    inboundRoutingKind,
    processed: true,
  };
}

export function startInstagramPersonaMenu(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  options: { incrementSession: boolean } = { incrementSession: true },
): MachineResult {
  const collected = clearInstagramJourneyCollected(snapshot.collected, {
    originalInboundText: snapshot.collected.originalInboundText ?? signal.text,
    originalInboundMessageId:
      snapshot.collected.originalInboundMessageId ?? signal.messageId,
    routingSessionId: `rs_${signal.messageId}`,
    cachedUsername: snapshot.collected.cachedUsername ?? snapshot.suggestedSocialHandle,
  });
  return sendQr(
    snapshot,
    signal,
    {
      routingIntent: "unclassified",
      currentIntakeField: null,
      collected,
      intakeSessionVersion: options.incrementSession
        ? snapshot.intakeSessionVersion + 1
        : snapshot.intakeSessionVersion,
      ticketId: snapshot.ticketId,
      ticketCode: snapshot.ticketCode,
    },
    personaWelcomeText(greetingName({ ...snapshot, collected })),
    "awaiting_persona",
    personaQuickReplies(),
    false,
    "unclassified",
  );
}

export function recoverIncompletePostCompletionIntake(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  const collected = clearInstagramJourneyCollected(snapshot.collected, {
    originalInboundText: signal.text,
    originalInboundMessageId: signal.messageId,
    routingSessionId: `rs_${signal.messageId}`,
    cachedUsername:
      snapshot.collected.cachedUsername ?? snapshot.suggestedSocialHandle,
  });
  return sendQr(
    snapshot,
    signal,
    {
      routingIntent: "unclassified",
      currentIntakeField: null,
      collected,
      intakeSessionVersion: snapshot.intakeSessionVersion + 1,
      ticketId: null,
      ticketCode: null,
    },
    personaWelcomeText(greetingName({ ...snapshot, collected })),
    "awaiting_persona",
    personaQuickReplies(),
    false,
    "unclassified",
    [],
    PERSONA_PROMPT.personaRecover,
  );
}

function completePostPath(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  collected: IntakeCollectedData,
  body: string,
  extraEffects: MachineEffect[] = [],
  inboundRoutingKind: MachineResult["inboundRoutingKind"] = "unclassified",
): MachineResult {
  return sendQr(
    snapshot,
    signal,
    {
      currentIntakeField: null,
      collected,
    },
    withPostCompletionQuestion(body),
    "awaiting_post_completion",
    postCompletionQuickReplies(),
    false,
    inboundRoutingKind,
    extraEffects,
  );
}

function creatorCampaignFields(collected: IntakeCollectedData) {
  return {
    campaignName: collected.campaignName,
    brandName: collected.brandName,
    campaignMonth: collected.campaignMonth,
    contactEmail: collected.email,
  };
}

function signalNow(signal: InboundSignal): Date {
  const parsed = Date.parse(signal.timestamp);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

function agencyFields(collected: IntakeCollectedData) {
  return {
    agencyName: collected.agencyName,
    contactName: collected.creatorName,
    contactEmail: collected.email,
    rosterUrl: collected.rosterUrl,
  };
}

function otherContactFields(collected: IntakeCollectedData) {
  return {
    contactName: collected.creatorName,
    contactEmail: collected.email,
    contactPhoneDisplay: collected.phoneDisplay,
    contactPhoneNormalized: collected.phoneNormalized,
  };
}

function creatorIssueCategoryLabel(collected: IntakeCollectedData): string | null {
  if (collected.igIssueCategory === "payment") return "Payment issue";
  if (collected.igIssueCategory === "campaign") return "Campaign issue";
  return null;
}

function creatorIssueContext(collected: IntakeCollectedData): string | null {
  const described = collected.issueDescription?.trim();
  if (described) return described;
  return originalInboundForTicket(collected);
}

function buildCreatorConfirmation(collected: IntakeCollectedData): string | null {
  if (!collected.brandName || !collected.campaignMonth || !collected.email) {
    return null;
  }
  const storedIssue = creatorIssueContext(collected) ?? "";
  return truncateDisplayedIssue(
    (issueDetails) =>
      creatorConfirmationText({
        campaignName: null,
        brandName: collected.brandName as string,
        displayCampaignMonth: formatCampaignMonthForDisplay(collected.campaignMonth),
        contactEmail: collected.email as string,
        issueCategory: creatorIssueCategoryLabel(collected),
        issueDetails,
      }),
    storedIssue,
    INSTAGRAM_SAFE_MESSAGE_LENGTH,
  );
}

function showCreatorConfirmation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  collected: IntakeCollectedData,
  retry: boolean,
): MachineResult {
  const confirmation = buildCreatorConfirmation(collected);
  if (!confirmation) {
    return sendText(
      snapshot,
      signal,
      { collected, routingIntent: "creator_support" },
      missingCreatorCampaignPrompt(creatorCampaignFields(collected)) ??
        CREATOR_CAMPAIGN_DETAILS_TEXT,
      "creator_campaign_details",
      true,
      "support",
    );
  }
  return sendQr(
    snapshot,
    signal,
    {
      collected: { ...collected, campaignName: null },
      routingIntent: "creator_support",
      currentIntakeField: null,
    },
    confirmation,
    "creator_confirmation",
    creatorConfirmationQuickReplies(),
    retry,
    "support",
    [],
    PERSONA_PROMPT.creatorConfirm,
  );
}

function buildAgencySummary(collected: IntakeCollectedData): string | null {
  if (
    !collected.agencyName ||
    !collected.creatorName ||
    !collected.email ||
    !collected.rosterUrl
  ) {
    return null;
  }
  return agencySummaryText({
    agencyName: collected.agencyName,
    contactName: collected.creatorName,
    contactEmail: collected.email,
    rosterUrl: collected.rosterUrl,
  });
}

function buildOtherSummary(collected: IntakeCollectedData): string | null {
  if (
    !collected.creatorName ||
    !collected.email ||
    !collected.phoneNormalized ||
    !collected.inquiryDetails
  ) {
    return null;
  }
  const stored = collected.inquiryDetails;
  return truncateDisplayedIssue(
    (inquiryDetails) =>
      otherSummaryText({
        contactName: collected.creatorName as string,
        contactEmail: collected.email as string,
        contactPhone: collected.phoneDisplay ?? collected.phoneNormalized ?? "",
        inquiryDetails,
      }),
    stored,
    INSTAGRAM_SAFE_MESSAGE_LENGTH,
  );
}

export function instagramPromptForState(
  snapshot: ConversationSnapshot,
): MachineSendEffect | null {
  const state = snapshot.state;
  const key = personaPromptKey(state);
  if (state === "awaiting_persona") {
    return {
      type: "send_quick_replies",
      text: personaWelcomeText(greetingName(snapshot)),
      promptKey: key,
      quickReplies: personaQuickReplies(),
    };
  }
  if (state === "awaiting_creator_reason") {
    return {
      type: "send_quick_replies",
      text: CREATOR_REASON_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, creatorReasonQuickReplies()),
    };
  }
  if (state === "awaiting_creator_issue_category") {
    return {
      type: "send_quick_replies",
      text: CREATOR_ISSUE_CATEGORY_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(
        state,
        creatorIssueCategoryQuickReplies(),
      ),
    };
  }
  if (state === "creator_campaign_details") {
    return {
      type: "send_quick_replies",
      text:
        missingCreatorCampaignPrompt(creatorCampaignFields(snapshot.collected)) ??
        CREATOR_CAMPAIGN_DETAILS_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, []),
    };
  }
  if (state === "awaiting_month_confirmation") {
    const month = snapshot.collected.campaignMonth;
    return {
      type: "send_quick_replies",
      text: month
        ? campaignMonthConfirmationText(month)
        : CREATOR_CAMPAIGN_DETAILS_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, monthConfirmationQuickReplies()),
    };
  }
  if (state === "creator_issue_details") {
    return {
      type: "send_quick_replies",
      text: CREATOR_ISSUE_DETAILS_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, []),
    };
  }
  if (state === "creator_confirmation") {
    const text = buildCreatorConfirmation(snapshot.collected);
    if (!text) return null;
    return {
      type: "send_quick_replies",
      text,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(
        state,
        creatorConfirmationQuickReplies(),
      ),
    };
  }
  if (state === "brand_action") {
    return {
      type: "send_quick_replies",
      text: BRAND_ACTION_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, brandActionQuickReplies()),
    };
  }
  if (state === "agency_details") {
    return {
      type: "send_quick_replies",
      text:
        missingAgencyDetailsPrompt(agencyFields(snapshot.collected)) ??
        AGENCY_DETAILS_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, []),
    };
  }
  if (state === "agency_confirmation") {
    const text = buildAgencySummary(snapshot.collected);
    if (!text) return null;
    return {
      type: "send_quick_replies",
      text,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(
        state,
        agencyConfirmationQuickReplies(),
      ),
    };
  }
  if (state === "other_inquiry") {
    return {
      type: "send_quick_replies",
      text: OTHER_INQUIRY_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, []),
    };
  }
  if (state === "other_contact") {
    return {
      type: "send_quick_replies",
      text:
        missingOtherContactPrompt(otherContactFields(snapshot.collected)) ??
        OTHER_CONTACT_TEXT,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(state, []),
    };
  }
  if (state === "other_confirmation") {
    const text = buildOtherSummary(snapshot.collected);
    if (!text) return null;
    return {
      type: "send_quick_replies",
      text,
      promptKey: key,
      quickReplies: withFlowBackQuickReply(
        state,
        otherConfirmationQuickReplies(),
      ),
    };
  }
  if (state === "awaiting_post_completion") {
    return {
      type: "send_quick_replies",
      text: POST_COMPLETION_QUESTION_TEXT,
      promptKey: key,
      quickReplies: postCompletionQuickReplies(),
    };
  }
  return null;
}

function routingKindForSnapshot(
  snapshot: ConversationSnapshot,
): MachineResult["inboundRoutingKind"] {
  if (snapshot.routingIntent === "collaboration") return "collaboration";
  if (snapshot.routingIntent === "creator_support") return "support";
  return "unclassified";
}

function collectedAfterFlowBack(
  fromState: string,
  collected: IntakeCollectedData,
): IntakeCollectedData {
  if (fromState === "creator_campaign_details") {
    return {
      ...collected,
      campaignName: null,
      brandName: null,
      campaignMonth: null,
      campaignMonthConfirmed: false,
      email: null,
    };
  }
  if (fromState === "awaiting_creator_issue_category") {
    return {
      ...collected,
      igIssueCategory: null,
      issueDescription: null,
      campaignName: null,
      brandName: null,
      campaignMonth: null,
      campaignMonthConfirmed: false,
      email: null,
    };
  }
  return collected;
}

function handleFlowBack(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult | null {
  const targetState = INSTAGRAM_FLOW_BACK_TRANSITIONS[snapshot.state];
  if (!targetState) return null;

  const collected = collectedAfterFlowBack(snapshot.state, snapshot.collected);
  const prompt = instagramPromptForState({
    ...snapshot,
    collected,
    state: targetState,
  });
  if (!prompt) return null;

  const key = personaBackPromptKey(targetState, signal.messageId);
  return {
    snapshot: withActivity(snapshot, signal, {
      state: targetState,
      collected,
      lastPromptKey: key,
    }),
    effects: [
      {
        ...prompt,
        promptKey: key,
      },
    ],
    attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    inboundRoutingKind: routingKindForSnapshot(snapshot),
    processed: true,
  };
}

function absorbFlowBackWithoutEffects(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  return {
    snapshot: withActivity(snapshot, signal, {}),
    effects: [],
    attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    inboundRoutingKind: routingKindForSnapshot(snapshot),
    processed: true,
  };
}

function isPersonaState(state: string): state is InstagramPersonaState {
  return PERSONA_STATE_SET.has(state);
}

function ticketFollowUp(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  return {
    snapshot: withActivity(snapshot, signal, {
      state: snapshot.state === "completed" ? "completed" : "ticket_open",
      routingIntent: "creator_support",
    }),
    effects: [{ type: "notify_help_inbound" }],
    attachTicketId: snapshot.ticketId,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function handlePostCompletion(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  if (command === "post_main_menu") {
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }
  if (command === "post_done") {
    return sendText(
      snapshot,
      signal,
      {
        currentIntakeField: null,
      },
      POST_DONE_TEXT,
      "completed",
      false,
      snapshot.routingIntent === "creator_support" ? "support" : "unclassified",
    );
  }
  return sendQr(
    snapshot,
    signal,
    {},
    POST_COMPLETION_QUESTION_TEXT,
    "awaiting_post_completion",
    postCompletionQuickReplies(),
    true,
    snapshot.routingIntent === "creator_support" ? "support" : "unclassified",
  );
}

function handlePersonaChoice(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "persona_creator",
    "persona_brand",
    "persona_agency",
    "persona_other",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    return sendQr(
      snapshot,
      signal,
      {},
      personaWelcomeText(greetingName(snapshot)),
      "awaiting_persona",
      personaQuickReplies(),
      true,
    );
  }
  if (command === "persona_creator") {
    return sendQr(
      snapshot,
      signal,
      {
        routingIntent: "unclassified",
        collected: { ...snapshot.collected, igPersona: "creator" },
      },
      CREATOR_REASON_TEXT,
      "awaiting_creator_reason",
      creatorReasonQuickReplies(),
      false,
    );
  }
  if (command === "persona_brand") {
    return sendQr(
      snapshot,
      signal,
      {
        routingIntent: "unclassified",
        collected: { ...snapshot.collected, igPersona: "brand" },
      },
      BRAND_ACTION_TEXT,
      "brand_action",
      brandActionQuickReplies(),
      false,
    );
  }
  if (command === "persona_agency") {
    return sendText(
      snapshot,
      signal,
      {
        routingIntent: "unclassified",
        collected: { ...snapshot.collected, igPersona: "agency" },
      },
      AGENCY_DETAILS_TEXT,
      "agency_details",
      false,
    );
  }
  return sendText(
    snapshot,
    signal,
    {
      routingIntent: "unclassified",
      collected: { ...snapshot.collected, igPersona: "other" },
    },
    OTHER_INQUIRY_TEXT,
    "other_inquiry",
    false,
  );
}

function handleCreatorReason(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "creator_new_work",
    "creator_existing_campaign",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    return sendQr(
      snapshot,
      signal,
      {},
      CREATOR_REASON_TEXT,
      "awaiting_creator_reason",
      creatorReasonQuickReplies(),
      true,
    );
  }
  if (command === "creator_new_work") {
    return completePostPath(
      snapshot,
      signal,
      {
        ...snapshot.collected,
        igPersona: "creator",
        igCreatorReason: "new_work",
      },
      CREATOR_APPLY_TEXT,
    );
  }
  const issueIntro =
    hasActiveTicket(snapshot) && snapshot.ticketCode
      ? `${activeTicketAttachText(snapshot.ticketCode)}\n\n${CREATOR_ISSUE_CATEGORY_TEXT}`
      : CREATOR_ISSUE_CATEGORY_TEXT;
  return sendQr(
    snapshot,
    signal,
    {
      collected: {
        ...snapshot.collected,
        igPersona: "creator",
        igCreatorReason: "existing_campaign",
      },
    },
    issueIntro,
    "awaiting_creator_issue_category",
    creatorIssueCategoryQuickReplies(),
    false,
  );
}

function handleCreatorIssueCategory(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "creator_campaign_issue",
    "creator_payment_issue",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    return sendQr(
      snapshot,
      signal,
      {},
      CREATOR_ISSUE_CATEGORY_TEXT,
      "awaiting_creator_issue_category",
      creatorIssueCategoryQuickReplies(),
      true,
    );
  }
  const category = command === "creator_payment_issue" ? "payment" : "campaign";
  return sendText(
    snapshot,
    signal,
    {
      routingIntent: "creator_support",
      collected: {
        ...snapshot.collected,
        igPersona: "creator",
        igCreatorReason: "existing_campaign",
        igIssueCategory: category,
        issueType: category === "payment" ? "payment_delayed" : "other",
      },
    },
    CREATOR_CAMPAIGN_DETAILS_TEXT,
    "creator_campaign_details",
    false,
    "support",
  );
}

function handleCreatorCampaignDetails(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  options: { preserveIssueDetails: boolean } = { preserveIssueDetails: true },
): MachineResult {
  const merged = mergeCreatorCampaignFields(
    creatorCampaignFields(snapshot.collected),
    parseCreatorCampaignBundle(signal.text, signalNow(signal)),
  );
  const monthUnconfirmed =
    Boolean(merged.campaignMonth) &&
    (merged.campaignMonth !== snapshot.collected.campaignMonth ||
      !snapshot.collected.campaignMonthConfirmed);
  const collected: IntakeCollectedData = {
    ...snapshot.collected,
    campaignName: null,
    brandName: merged.brandName,
    campaignMonth: merged.campaignMonth,
    campaignMonthConfirmed: monthUnconfirmed
      ? false
      : snapshot.collected.campaignMonthConfirmed,
    email: merged.contactEmail,
    issueDescription: options.preserveIssueDetails
      ? snapshot.collected.issueDescription
      : snapshot.collected.issueDescription,
  };
  const missing = missingCreatorCampaignPrompt(merged);
  if (missing && !merged.campaignMonth) {
    return sendText(
      snapshot,
      signal,
      { collected, routingIntent: "creator_support" },
      missing,
      "creator_campaign_details",
      true,
      "support",
    );
  }
  if (collected.campaignMonth && !collected.campaignMonthConfirmed) {
    const previousKey = snapshot.lastPromptKey ?? "";
    const corrected =
      previousKey.startsWith(PERSONA_PROMPT.monthConfirm) ||
      previousKey.startsWith(PERSONA_PROMPT.monthConfirmReask) ||
      previousKey.startsWith(PERSONA_PROMPT.monthConfirmCorrected) ||
      snapshot.state === "awaiting_month_confirmation";
    return sendQr(
      snapshot,
      signal,
      { collected, routingIntent: "creator_support", currentIntakeField: null },
      campaignMonthConfirmationText(collected.campaignMonth),
      "awaiting_month_confirmation",
      monthConfirmationQuickReplies(),
      true,
      "support",
      [],
      corrected ? PERSONA_PROMPT.monthConfirmCorrected : PERSONA_PROMPT.monthConfirm,
    );
  }
  if (missing) {
    return sendText(
      snapshot,
      signal,
      { collected, routingIntent: "creator_support" },
      missing,
      "creator_campaign_details",
      true,
      "support",
    );
  }
  if (collected.campaignMonthConfirmed) {
    return showCreatorConfirmation(snapshot, signal, collected, true);
  }
  return sendText(
    snapshot,
    signal,
    { collected, routingIntent: "creator_support" },
    CREATOR_CAMPAIGN_DETAILS_TEXT,
    "creator_campaign_details",
    true,
    "support",
  );
}

function raiseCreatorTicket(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  collected: IntakeCollectedData,
): MachineResult {
  return {
    snapshot: withActivity(snapshot, signal, {
      state: "awaiting_post_completion",
      routingIntent: "creator_support",
      currentIntakeField: null,
      collected: {
        ...collected,
        campaignName: null,
      },
    }),
    effects: [{ type: "create_ticket" }],
    attachTicketId: null,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function handleMonthConfirmation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  if (command === "yes") {
    if (!snapshot.collected.campaignMonth) {
      return sendText(
        snapshot,
        signal,
        { routingIntent: "creator_support" },
        CREATOR_CAMPAIGN_DETAILS_TEXT,
        "creator_campaign_details",
        true,
        "support",
      );
    }
    const collected: IntakeCollectedData = {
      ...snapshot.collected,
      campaignName: null,
      campaignMonthConfirmed: true,
    };
    const missing = missingCreatorCampaignPrompt(creatorCampaignFields(collected));
    if (missing) {
      return sendText(
        snapshot,
        signal,
        { collected, routingIntent: "creator_support" },
        missing,
        "creator_campaign_details",
        false,
        "support",
      );
    }
    return showCreatorConfirmation(snapshot, signal, collected, true);
  }
  if (command === "flow_cancel") {
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }
  if (command === "no") {
    const collected: IntakeCollectedData = {
      ...snapshot.collected,
      campaignMonth: null,
      campaignMonthConfirmed: false,
    };
    return sendText(
      snapshot,
      signal,
      { collected, routingIntent: "creator_support" },
      CAMPAIGN_MONTH_REASK_TEXT,
      "awaiting_month_confirmation",
      true,
      "support",
      PERSONA_PROMPT.monthConfirmReask,
    );
  }
  if (!snapshot.collected.campaignMonth && (!command || command === "edit")) {
    return handleCreatorCampaignDetails(snapshot, signal);
  }
  const month = snapshot.collected.campaignMonth;
  return sendQr(
    snapshot,
    signal,
    { routingIntent: "creator_support" },
    month ? CAMPAIGN_MONTH_CHOOSE_TEXT : CREATOR_CAMPAIGN_DETAILS_TEXT,
    month ? "awaiting_month_confirmation" : "creator_campaign_details",
    month ? monthConfirmationQuickReplies() : [],
    true,
    "support",
  );
}

function handleCreatorIssueDetails(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  const details = parseMeaningfulDetails(signal.text);
  if (!details) {
    return sendText(
      snapshot,
      signal,
      {},
      CREATOR_ISSUE_DETAILS_TEXT,
      "creator_issue_details",
      true,
      "support",
    );
  }
  const collected = { ...snapshot.collected, issueDescription: details };
  return showCreatorConfirmation(snapshot, signal, collected, true);
}

function handleCreatorConfirmation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "creator_ticket_confirm",
    "creator_ticket_edit",
    "edit",
    "flow_cancel",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    const text = buildCreatorConfirmation(snapshot.collected);
    return sendQr(
      snapshot,
      signal,
      {},
      text ?? CREATOR_ISSUE_DETAILS_TEXT,
      "creator_confirmation",
      creatorConfirmationQuickReplies(),
      true,
      "support",
    );
  }
  if (command === "flow_cancel") {
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }
  if (command === "creator_ticket_edit" || command === "edit") {
    const collected: IntakeCollectedData = {
      ...snapshot.collected,
      campaignName: null,
      brandName: null,
      campaignMonth: null,
      campaignMonthConfirmed: false,
      email: null,
    };
    return sendText(
      snapshot,
      signal,
      { collected, routingIntent: "creator_support" },
      CREATOR_CAMPAIGN_DETAILS_TEXT,
      "creator_campaign_details",
      true,
      "support",
      PERSONA_PROMPT.creatorEdit,
    );
  }
  if (command === "creator_ticket_confirm") {
    return raiseCreatorTicket(snapshot, signal, snapshot.collected);
  }
  const text = buildCreatorConfirmation(snapshot.collected);
  return sendQr(
    snapshot,
    signal,
    {},
    text ?? CREATOR_ISSUE_DETAILS_TEXT,
    "creator_confirmation",
    creatorConfirmationQuickReplies(),
    true,
    "support",
  );
}

function handleBrandAction(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "brand_book_call",
    "brand_book_demo",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    return sendQr(
      snapshot,
      signal,
      {},
      BRAND_ACTION_TEXT,
      "brand_action",
      brandActionQuickReplies(),
      true,
    );
  }
  return completePostPath(
    snapshot,
    signal,
    { ...snapshot.collected, igPersona: "brand" },
    BRAND_BOOKING_TEXT,
  );
}

function handleAgencyDetails(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  const merged = mergeAgencyDetailFields(
    agencyFields(snapshot.collected),
    parseAgencyDetailsBundle(signal.text),
  );
  const collected: IntakeCollectedData = {
    ...snapshot.collected,
    igPersona: "agency",
    agencyName: merged.agencyName,
    creatorName: merged.contactName,
    email: merged.contactEmail,
    rosterUrl: merged.rosterUrl,
  };
  const missing = missingAgencyDetailsPrompt(merged);
  if (missing) {
    return sendText(
      snapshot,
      signal,
      { collected },
      missing,
      "agency_details",
      true,
    );
  }
  const summary = buildAgencySummary(collected);
  return sendQr(
    snapshot,
    signal,
    { collected },
    summary ?? AGENCY_DETAILS_TEXT,
    "agency_confirmation",
    agencyConfirmationQuickReplies(),
    false,
  );
}

function handleAgencyConfirmation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "agency_send",
    "agency_edit",
    "edit",
    "flow_cancel",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    const text = buildAgencySummary(snapshot.collected);
    return sendQr(
      snapshot,
      signal,
      {},
      text ?? AGENCY_DETAILS_TEXT,
      "agency_confirmation",
      agencyConfirmationQuickReplies(),
      true,
    );
  }
  if (command === "flow_cancel") {
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }
  if (command === "agency_edit" || command === "edit") {
    const collected: IntakeCollectedData = {
      ...snapshot.collected,
      agencyName: null,
      creatorName: null,
      email: null,
      rosterUrl: null,
    };
    return sendText(
      snapshot,
      signal,
      { collected },
      AGENCY_DETAILS_TEXT,
      "agency_details",
      false,
    );
  }
  return completePostPath(
    snapshot,
    signal,
    snapshot.collected,
    AGENCY_SEND_CONFIRMED_TEXT,
    [{ type: "queue_internal_email", purpose: "agency" }],
  );
}

function handleOtherInquiry(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  const details = parseMeaningfulDetails(signal.text);
  if (!details) {
    return sendText(
      snapshot,
      signal,
      {},
      OTHER_INQUIRY_TEXT,
      "other_inquiry",
      true,
    );
  }
  return sendText(
    snapshot,
    signal,
    {
      collected: {
        ...snapshot.collected,
        igPersona: "other",
        inquiryDetails: details,
      },
    },
    OTHER_CONTACT_TEXT,
    "other_contact",
    false,
  );
}

function handleOtherContact(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  const merged = mergeOtherContactFields(
    otherContactFields(snapshot.collected),
    parseOtherContactBundle(signal.text),
  );
  const collected: IntakeCollectedData = {
    ...snapshot.collected,
    igPersona: "other",
    creatorName: merged.contactName,
    email: merged.contactEmail,
    phoneDisplay: merged.contactPhoneDisplay,
    phoneNormalized: merged.contactPhoneNormalized,
  };
  const missing = missingOtherContactPrompt(merged);
  if (missing) {
    return sendText(
      snapshot,
      signal,
      { collected },
      missing,
      "other_contact",
      true,
    );
  }
  const summary = buildOtherSummary(collected);
  return sendQr(
    snapshot,
    signal,
    { collected },
    summary ?? OTHER_CONTACT_TEXT,
    "other_confirmation",
    otherConfirmationQuickReplies(),
    false,
  );
}

function handleOtherConfirmation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  command: InstagramPersonaCommand | null,
): MachineResult {
  const allowed: InstagramPersonaCommand[] = [
    "other_send",
    "other_edit",
    "edit",
    "yes",
    "flow_cancel",
  ];
  if (!commandAllowedAtState(command, allowed)) {
    const text = buildOtherSummary(snapshot.collected);
    return sendQr(
      snapshot,
      signal,
      {},
      text ?? OTHER_CONTACT_TEXT,
      "other_confirmation",
      otherConfirmationQuickReplies(),
      true,
    );
  }
  if (command === "flow_cancel") {
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }
  if (command === "other_edit" || command === "edit") {
    const collected: IntakeCollectedData = {
      ...snapshot.collected,
      creatorName: null,
      email: null,
      phoneDisplay: null,
      phoneNormalized: null,
    };
    return sendText(
      snapshot,
      signal,
      { collected },
      OTHER_CONTACT_TEXT,
      "other_contact",
      false,
    );
  }
  if (command === "other_send" || command === "yes") {
    return completePostPath(
      snapshot,
      signal,
      snapshot.collected,
      OTHER_SEND_CONFIRMED_TEXT,
      [{ type: "queue_internal_email", purpose: "other" }],
    );
  }
  const text = buildOtherSummary(snapshot.collected);
  return sendQr(
    snapshot,
    signal,
    {},
    text ?? OTHER_CONTACT_TEXT,
    "other_confirmation",
    otherConfirmationQuickReplies(),
    true,
  );
}

/**
 * Shared Instagram / WhatsApp / WATI persona router. Deterministic, no I/O.
 */
export function reduceInstagramPersonaConversation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  if (snapshot.lastProcessedExternalMessageId === signal.messageId) {
    return alreadyProcessed(snapshot);
  }

  if (isRecoverableCreatorConfirmation(snapshot)) {
    return showCreatorConfirmation(snapshot, signal, snapshot.collected, true);
  }
  if (isIncompletePostCompletionWithoutTicket(snapshot)) {
    return recoverIncompletePostCompletionIntake(snapshot, signal);
  }

  if (signal.unsupportedKind) {
    return sendText(
      snapshot,
      signal,
      {},
      INSTAGRAM_UNSUPPORTED_FALLBACK_TEXT,
      snapshot.state || "unclassified",
      true,
      snapshot.routingIntent === "creator_support" ? "support" : "unclassified",
    );
  }

  const global = isGlobalMenuOrRestart(signal.text, signal.quickReplyPayload);
  if (global) {
    if (hasActiveTicket(snapshot)) {
      return ticketFollowUp(snapshot, signal);
    }
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }

  if (isGlobalFlowBack(signal.text, signal.quickReplyPayload)) {
    const wentBack = handleFlowBack(snapshot, signal);
    if (wentBack) return wentBack;
    // Do not treat exact "back" / FLOW_BACK as a ticket follow-up or side effect.
    if (
      hasActiveTicket(snapshot) &&
      (snapshot.state === "ticket_open" || snapshot.state === "completed")
    ) {
      return absorbFlowBackWithoutEffects(snapshot, signal);
    }
  }

  const command = detectInstagramPersonaCommand(
    signal.text,
    signal.quickReplyPayload,
  );

  if (snapshot.state === "awaiting_post_completion") {
    if (hasActiveTicket(snapshot)) {
      if (command === "creator_ticket_confirm") {
        return raiseCreatorTicket(snapshot, signal, snapshot.collected);
      }
      if (command === "post_done") {
        return handlePostCompletion(snapshot, signal, command);
      }
      return ticketFollowUp(snapshot, signal);
    }
    return handlePostCompletion(snapshot, signal, command);
  }

  if (
    hasActiveTicket(snapshot) &&
    (snapshot.state === "ticket_open" || snapshot.state === "completed")
  ) {
    return ticketFollowUp(snapshot, signal);
  }

  if (isResolvedTicket(snapshot) && snapshot.state === "ticket_open") {
    return startInstagramPersonaMenu(
      { ...snapshot, ticketId: null },
      signal,
      { incrementSession: true },
    );
  }

  if (LEGACY_CHATBOT_STATES.has(snapshot.state) && !hasActiveTicket(snapshot)) {
    return startInstagramPersonaMenu(snapshot, signal, {
      incrementSession: snapshot.intakeSessionVersion > 0 || snapshot.state !== "unclassified",
    });
  }

  if (hasActiveTicket(snapshot) && snapshot.state === "legacy") {
    return ticketFollowUp(snapshot, signal);
  }

  if (!isPersonaState(snapshot.state)) {
    if (hasActiveTicket(snapshot)) return ticketFollowUp(snapshot, signal);
    return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }

  switch (snapshot.state) {
    case "awaiting_persona":
      return handlePersonaChoice(snapshot, signal, command);
    case "awaiting_creator_reason":
      return handleCreatorReason(snapshot, signal, command);
    case "awaiting_creator_issue_category":
      return handleCreatorIssueCategory(snapshot, signal, command);
    case "creator_campaign_details":
      return handleCreatorCampaignDetails(snapshot, signal);
    case "awaiting_month_confirmation":
      return handleMonthConfirmation(snapshot, signal, command);
    case "creator_issue_details":
      return handleCreatorIssueDetails(snapshot, signal);
    case "creator_confirmation":
      return handleCreatorConfirmation(snapshot, signal, command);
    case "brand_action":
      return handleBrandAction(snapshot, signal, command);
    case "agency_details":
      return handleAgencyDetails(snapshot, signal);
    case "agency_confirmation":
      return handleAgencyConfirmation(snapshot, signal, command);
    case "other_inquiry":
      return handleOtherInquiry(snapshot, signal);
    case "other_contact":
      return handleOtherContact(snapshot, signal);
    case "other_confirmation":
      return handleOtherConfirmation(snapshot, signal, command);
    case "completed":
      if (hasActiveTicket(snapshot)) return ticketFollowUp(snapshot, signal);
      return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
    default:
      return startInstagramPersonaMenu(snapshot, signal, { incrementSession: true });
  }
}
