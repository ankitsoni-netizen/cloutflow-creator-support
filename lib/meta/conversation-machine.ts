import { detectRoutingCommand } from "@/lib/meta/commands";
import { reduceInstagramPersonaConversation } from "@/lib/meta/instagram-persona-machine";
import {
  emptyIntakeCollected,
  isIntakeComplete,
  mergeCampaignDetails,
  mergeCreatorDetails,
  mergePlatformDetails,
  missingCampaignDetailsPrompt,
  missingCreatorDetailsPrompt,
  missingPlatformDetailsPrompt,
  type IntakeCollectedData,
  type IntakeField,
} from "@/lib/meta/intake-validate";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import { intakeEffectType } from "@/lib/meta/prompt-keys";
import {
  INSTAGRAM_INTAKE_COPY,
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  type ChannelIntakeCopy,
} from "@/lib/meta/routing-copy";

export type { ChannelIntakeCopy };

export const ROUTING_CONVERSATION_STATES = [
  "unclassified",
  "awaiting_route",
  "collaboration",
  "support_intake",
  "awaiting_confirmation",
  "ticket_open",
  "cancelled",
  "awaiting_persona",
  "awaiting_creator_reason",
  "awaiting_creator_issue_category",
  "creator_campaign_details",
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

export type RoutingConversationState =
  (typeof ROUTING_CONVERSATION_STATES)[number];

export const ROUTING_INTENTS = [
  "unclassified",
  "collaboration",
  "creator_support",
] as const;

export type RoutingIntent = (typeof ROUTING_INTENTS)[number];

export const COLLABORATION_IDLE_MS = 24 * 60 * 60 * 1000;

export type InstagramQuickReply = {
  content_type: "text";
  title: string;
  payload: string;
};

export type MachineSendEffect = {
  type: "send_text" | "send_quick_replies";
  text: string;
  promptKey: string;
  quickReplies?: InstagramQuickReply[];
};

export type MachineEffect =
  | MachineSendEffect
  | { type: "create_ticket" }
  | { type: "notify_help_inbound" }
  | { type: "mark_unclassified_as"; routingKind: "collaboration" | "support" }
  | { type: "queue_internal_email"; purpose: "agency" | "other" };

export type ConversationSnapshot = {
  state: string;
  routingIntent: RoutingIntent;
  currentIntakeField: IntakeField | null;
  collected: IntakeCollectedData;
  lastPromptKey: string | null;
  lastActivityAt: string | null;
  lastProcessedExternalMessageId: string | null;
  ticketId: string | null;
  ticketStatus: string | null;
  suggestedSocialHandle: string | null;
  suggestedPhone: string | null;
  intakeSessionVersion: number;
};

export type InboundSignal = {
  text: string;
  quickReplyPayload: string | null;
  timestamp: string;
  messageId: string;
};

export type MachineResult = {
  snapshot: ConversationSnapshot;
  effects: MachineEffect[];
  attachTicketId: string | null;
  inboundRoutingKind: "unclassified" | "collaboration" | "support";
  processed: boolean;
};

function newSessionId(messageId: string): string {
  return `rs_${messageId}`;
}

function routingStates(state: string): RoutingConversationState | "legacy" {
  if ((ROUTING_CONVERSATION_STATES as readonly string[]).includes(state)) {
    return state as RoutingConversationState;
  }
  if (state === "ticket_created" || state === "human_handoff") return "legacy";
  return "unclassified";
}

function hasActiveTicket(snapshot: ConversationSnapshot): boolean {
  return Boolean(
    snapshot.ticketId && isActiveTicketStatus(snapshot.ticketStatus),
  );
}

function isResolvedTicket(snapshot: ConversationSnapshot): boolean {
  return (snapshot.ticketStatus ?? "").trim().toLowerCase() === "resolved";
}

function idleExpired(lastActivityAt: string | null, nowIso: string): boolean {
  if (!lastActivityAt) return true;
  const last = Date.parse(lastActivityAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  return now - last >= COLLABORATION_IDLE_MS;
}

function qr(title: string, payload: string): InstagramQuickReply {
  return {
    content_type: "text",
    title: title.slice(0, 20),
    payload,
  };
}

function routingQuickReplies(copy: ChannelIntakeCopy): InstagramQuickReply[] {
  return [
    qr(copy.collaborationQuickReplyTitle, ROUTE_COLLABORATION_PAYLOAD),
    qr(copy.creatorSupportQuickReplyTitle, ROUTE_CREATOR_SUPPORT_PAYLOAD),
  ];
}

function isPrimaryIntakePrompt(
  field: IntakeField,
  text: string,
  copy: ChannelIntakeCopy,
): boolean {
  if (field === "creator_details") return text === copy.creatorDetailsPrompt;
  if (field === "platform_details") return text === copy.platformDetailsPrompt;
  return text === copy.campaignDetailsPrompt;
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

function seedOriginal(
  collected: IntakeCollectedData,
  signal: InboundSignal,
): IntakeCollectedData {
  const next = { ...collected };
  if (!next.originalInboundText) {
    next.originalInboundText = signal.text;
    next.originalInboundMessageId = signal.messageId;
  }
  return next;
}

function startRouting(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  copy: ChannelIntakeCopy,
): MachineResult {
  const sessionId = newSessionId(signal.messageId);
  const collected = seedOriginal(
    emptyIntakeCollected({
      originalInboundText: signal.text,
      originalInboundMessageId: signal.messageId,
      routingSessionId: sessionId,
    }),
    signal,
  );
  const key = "route";
  return {
    snapshot: withActivity(snapshot, signal, {
      state: "awaiting_route",
      routingIntent: "unclassified",
      currentIntakeField: null,
      collected,
      lastPromptKey: key,
      ticketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    }),
    effects: [
      {
        type: "send_quick_replies",
        text: copy.routingQuestion,
        promptKey: key,
        quickReplies: routingQuickReplies(copy),
      },
    ],
    attachTicketId: null,
    inboundRoutingKind: "unclassified",
    processed: true,
  };
}

function startIntake(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  reason: "route" | "reclassify" | "restart",
  copy: ChannelIntakeCopy,
): MachineResult {
  const sessionId = newSessionId(signal.messageId);
  const intakeSessionVersion = snapshot.intakeSessionVersion + 1;
  const suggestedPhone = snapshot.suggestedPhone;
  const collected = emptyIntakeCollected({
    originalInboundText: snapshot.collected.originalInboundText ?? signal.text,
    originalInboundMessageId:
      snapshot.collected.originalInboundMessageId ?? signal.messageId,
    routingSessionId: sessionId,
    phoneNormalized: suggestedPhone,
    phoneDisplay: suggestedPhone,
    phonePrefill: Boolean(suggestedPhone),
  });
  const key = intakeEffectType("creator_details");
  const effects: MachineEffect[] = [
    { type: "mark_unclassified_as", routingKind: "support" },
  ];
  if (reason === "restart") {
    effects.push({
      type: "send_text",
      text: copy.intakeRestarted,
      promptKey: "support_intro",
    });
  }
  effects.push({
    type: "send_text",
    text: copy.creatorDetailsPrompt,
    promptKey: key,
  });

  return {
    snapshot: withActivity(snapshot, signal, {
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: "creator_details",
      collected,
      lastPromptKey: key,
      intakeSessionVersion,
    }),
    effects,
    attachTicketId: null,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function sendStepPrompt(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  field: IntakeField,
  collected: IntakeCollectedData,
  text: string,
  copy: ChannelIntakeCopy,
): MachineResult {
  const key = isPrimaryIntakePrompt(field, text, copy)
    ? intakeEffectType(field)
    : intakeEffectType(field, `followup:${signal.messageId}`);
  return {
    snapshot: withActivity(snapshot, signal, {
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: field,
      collected,
      lastPromptKey: key,
    }),
    effects: [{ type: "send_text", text, promptKey: key }],
    attachTicketId: null,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function createTicketFromIntake(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  collected: IntakeCollectedData,
): MachineResult {
  return {
    snapshot: withActivity(snapshot, signal, {
      state: "ticket_open",
      routingIntent: "creator_support",
      currentIntakeField: null,
      collected,
    }),
    effects: [{ type: "create_ticket" }],
    attachTicketId: null,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function alreadyProcessed(snapshot: ConversationSnapshot): MachineResult {
  return {
    snapshot,
    effects: [],
    attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
    inboundRoutingKind: snapshot.routingIntent === "collaboration"
      ? "collaboration"
      : snapshot.routingIntent === "creator_support"
        ? "support"
        : "unclassified",
    processed: false,
  };
}

function continueIntake(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  copy: ChannelIntakeCopy,
): MachineResult {
  const step = snapshot.currentIntakeField ?? "creator_details";

  if (step === "creator_details") {
    const collected = mergeCreatorDetails(snapshot.collected, signal.text);
    const missing = missingCreatorDetailsPrompt(collected);
    if (missing) {
      return sendStepPrompt(
        snapshot,
        signal,
        "creator_details",
        collected,
        missing,
        copy,
      );
    }
    return sendStepPrompt(
      snapshot,
      signal,
      "platform_details",
      collected,
      copy.platformDetailsPrompt,
      copy,
    );
  }

  if (step === "platform_details") {
    const collected = mergePlatformDetails(snapshot.collected, signal.text);
    const missing = missingPlatformDetailsPrompt(collected);
    if (missing) {
      return sendStepPrompt(
        snapshot,
        signal,
        "platform_details",
        collected,
        missing,
        copy,
      );
    }
    return sendStepPrompt(
      snapshot,
      signal,
      "campaign_details",
      collected,
      copy.campaignDetailsPrompt,
      copy,
    );
  }

  const collected = mergeCampaignDetails(snapshot.collected, signal.text);
  const missing = missingCampaignDetailsPrompt(collected);
  if (missing) {
    return sendStepPrompt(
      snapshot,
      signal,
      "campaign_details",
      collected,
      missing,
      copy,
    );
  }
  return createTicketFromIntake(snapshot, signal, collected);
}

/**
 * Deterministic routing / intake reducer shared by Instagram and WhatsApp.
 * No I/O, no LLM. Same input always yields the same snapshot and effects.
 */
export function reduceChannelConversation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  copy: ChannelIntakeCopy = INSTAGRAM_INTAKE_COPY,
): MachineResult {
  if (snapshot.lastProcessedExternalMessageId === signal.messageId) {
    return alreadyProcessed(snapshot);
  }

  const command = detectRoutingCommand(signal.text, signal.quickReplyPayload);
  const state = routingStates(snapshot.state);

  if (hasActiveTicket(snapshot) && state !== "support_intake" && state !== "awaiting_confirmation") {
    return {
      snapshot: withActivity(snapshot, signal, {
        state: "ticket_open",
        routingIntent: "creator_support",
      }),
      effects: [{ type: "notify_help_inbound" }],
      attachTicketId: snapshot.ticketId,
      inboundRoutingKind: "support",
      processed: true,
    };
  }

  if (isResolvedTicket(snapshot) && state === "ticket_open") {
    return startRouting(
      {
        ...snapshot,
        ticketId: null,
        ticketStatus: snapshot.ticketStatus,
      },
      signal,
      copy,
    );
  }

  if (state === "legacy" && hasActiveTicket(snapshot)) {
    return {
      snapshot: withActivity(snapshot, signal, { state: "ticket_open" }),
      effects: [{ type: "notify_help_inbound" }],
      attachTicketId: snapshot.ticketId,
      inboundRoutingKind: "support",
      processed: true,
    };
  }

  if (
    (state === "unclassified" ||
      state === "cancelled" ||
      state === "legacy" ||
      snapshot.state === "new" ||
      snapshot.state === "closed" ||
      snapshot.state === "ticket_created") &&
    !hasActiveTicket(snapshot)
  ) {
    return startRouting(snapshot, signal, copy);
  }

  if (state === "awaiting_route") {
    if (command === "collaboration") {
      const key = "collab";
      return {
        snapshot: withActivity(snapshot, signal, {
          state: "collaboration",
          routingIntent: "collaboration",
          currentIntakeField: null,
          lastPromptKey: key,
        }),
        effects: [
          { type: "mark_unclassified_as", routingKind: "collaboration" },
          {
            type: "send_text",
            text: copy.collaborationConfirmed,
            promptKey: key,
          },
        ],
        attachTicketId: null,
        inboundRoutingKind: "collaboration",
        processed: true,
      };
    }
    if (command === "creator_support" || command === "support_reclassify") {
      return startIntake(snapshot, signal, "route", copy);
    }
    const key = "route_clarify";
    return {
      snapshot: withActivity(snapshot, signal, { lastPromptKey: key }),
      effects: [
        {
          type: "send_quick_replies",
          text: copy.routingClarify,
          promptKey: key,
          quickReplies: routingQuickReplies(copy),
        },
      ],
      attachTicketId: null,
      inboundRoutingKind: "unclassified",
      processed: true,
    };
  }

  if (state === "collaboration") {
    if (command === "support_reclassify" || command === "creator_support") {
      return startIntake(snapshot, signal, "reclassify", copy);
    }
    if (idleExpired(snapshot.lastActivityAt, signal.timestamp)) {
      return startRouting(snapshot, signal, copy);
    }
    return {
      snapshot: withActivity(snapshot, signal, {
        state: "collaboration",
        routingIntent: "collaboration",
      }),
      effects: [],
      attachTicketId: null,
      inboundRoutingKind: "collaboration",
      processed: true,
    };
  }

  if (state === "support_intake" || state === "awaiting_confirmation") {
    if (command === "cancel") {
      const key = "cancelled";
      return {
        snapshot: withActivity(snapshot, signal, {
          state: "cancelled",
          routingIntent: "unclassified",
          currentIntakeField: null,
          lastPromptKey: key,
        }),
        effects: [
          { type: "send_text", text: copy.intakeCancelled, promptKey: key },
        ],
        attachTicketId: null,
        inboundRoutingKind: "support",
        processed: true,
      };
    }
    if (command === "restart" || (state === "awaiting_confirmation" && command === "edit")) {
      return startIntake(snapshot, signal, "restart", copy);
    }
  }

  if (state === "awaiting_confirmation") {
    if (
      (command === "confirm" || command === "yes") &&
      isIntakeComplete(snapshot.collected)
    ) {
      return createTicketFromIntake(snapshot, signal, snapshot.collected);
    }
    return startIntake(snapshot, signal, "restart", copy);
  }

  if (state === "support_intake") {
    return continueIntake(snapshot, signal, copy);
  }

  if (state === "ticket_open") {
    return {
      snapshot: withActivity(snapshot, signal, { state: "ticket_open" }),
      effects: hasActiveTicket(snapshot) ? [{ type: "notify_help_inbound" }] : [],
      attachTicketId: hasActiveTicket(snapshot) ? snapshot.ticketId : null,
      inboundRoutingKind: "support",
      processed: true,
    };
  }

  return startRouting(snapshot, signal, copy);
}

export function reduceInstagramConversation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
): MachineResult {
  return reduceInstagramPersonaConversation(snapshot, signal);
}

export function emptyConversationSnapshot(
  overrides: Partial<ConversationSnapshot> = {},
): ConversationSnapshot {
  return {
    state: "unclassified",
    routingIntent: "unclassified",
    currentIntakeField: null,
    collected: emptyIntakeCollected(),
    lastPromptKey: null,
    lastActivityAt: null,
    lastProcessedExternalMessageId: null,
    ticketId: null,
    ticketStatus: null,
    suggestedSocialHandle: null,
    suggestedPhone: null,
    intakeSessionVersion: 0,
    ...overrides,
  };
}
