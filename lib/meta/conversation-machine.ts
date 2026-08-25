import { detectRoutingCommand } from "@/lib/meta/commands";
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
import {
  CAMPAIGN_DETAILS_PROMPT_TEXT,
  COLLABORATION_CONFIRMED_TEXT,
  CREATOR_DETAILS_PROMPT_TEXT,
  INTAKE_CANCELLED_TEXT,
  INTAKE_RESTARTED_TEXT,
  PLATFORM_DETAILS_PROMPT_TEXT,
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  ROUTING_CLARIFY_TEXT,
  ROUTING_COLLABORATION_QUICK_REPLY_TITLE,
  ROUTING_CREATOR_SUPPORT_TITLE,
  ROUTING_QUESTION_TEXT,
} from "@/lib/meta/routing-copy";

export const ROUTING_CONVERSATION_STATES = [
  "unclassified",
  "awaiting_route",
  "collaboration",
  "support_intake",
  "awaiting_confirmation",
  "ticket_open",
  "cancelled",
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
  | { type: "mark_unclassified_as"; routingKind: "collaboration" | "support" };

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

function routingQuickReplies(): InstagramQuickReply[] {
  return [
    qr(ROUTING_COLLABORATION_QUICK_REPLY_TITLE, ROUTE_COLLABORATION_PAYLOAD),
    qr(ROUTING_CREATOR_SUPPORT_TITLE, ROUTE_CREATOR_SUPPORT_PAYLOAD),
  ];
}

function promptKey(kind: string, sessionId: string, extra = ""): string {
  return extra ? `${kind}:${sessionId}:${extra}` : `${kind}:${sessionId}`;
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
  const key = promptKey("route", sessionId);
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
        text: ROUTING_QUESTION_TEXT,
        promptKey: key,
        quickReplies: routingQuickReplies(),
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
): MachineResult {
  const sessionId =
    snapshot.collected.routingSessionId ?? newSessionId(signal.messageId);
  const collected = emptyIntakeCollected({
    originalInboundText: snapshot.collected.originalInboundText ?? signal.text,
    originalInboundMessageId:
      snapshot.collected.originalInboundMessageId ?? signal.messageId,
    routingSessionId: sessionId,
  });
  const key = promptKey("intake", sessionId, "creator_details");
  const effects: MachineEffect[] = [
    { type: "mark_unclassified_as", routingKind: "support" },
  ];
  if (reason === "restart") {
    effects.push({
      type: "send_text",
      text: INTAKE_RESTARTED_TEXT,
      promptKey: promptKey("support_intro", sessionId, reason),
    });
  }
  effects.push({
    type: "send_text",
    text: CREATOR_DETAILS_PROMPT_TEXT,
    promptKey: key,
  });

  return {
    snapshot: withActivity(snapshot, signal, {
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: "creator_details",
      collected,
      lastPromptKey: key,
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
): MachineResult {
  const sessionId =
    collected.routingSessionId ?? newSessionId(signal.messageId);
  const key = promptKey("intake", sessionId, field);
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
      );
    }
    return sendStepPrompt(
      snapshot,
      signal,
      "platform_details",
      collected,
      PLATFORM_DETAILS_PROMPT_TEXT,
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
      );
    }
    return sendStepPrompt(
      snapshot,
      signal,
      "campaign_details",
      collected,
      CAMPAIGN_DETAILS_PROMPT_TEXT,
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
    );
  }
  return createTicketFromIntake(snapshot, signal, collected);
}

/**
 * Deterministic Instagram routing / intake reducer.
 * No I/O, no LLM. Same input always yields the same snapshot and effects.
 */
export function reduceInstagramConversation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
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
    return startRouting(snapshot, signal);
  }

  if (state === "awaiting_route") {
    if (command === "collaboration") {
      const sessionId =
        snapshot.collected.routingSessionId ?? newSessionId(signal.messageId);
      const key = promptKey("collab", sessionId);
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
            text: COLLABORATION_CONFIRMED_TEXT,
            promptKey: key,
          },
        ],
        attachTicketId: null,
        inboundRoutingKind: "collaboration",
        processed: true,
      };
    }
    if (command === "creator_support" || command === "support_reclassify") {
      return startIntake(snapshot, signal, "route");
    }
    const sessionId =
      snapshot.collected.routingSessionId ?? newSessionId(signal.messageId);
    const key = promptKey("route_clarify", sessionId);
    return {
      snapshot: withActivity(snapshot, signal, { lastPromptKey: key }),
      effects: [
        {
          type: "send_quick_replies",
          text: ROUTING_CLARIFY_TEXT,
          promptKey: key,
          quickReplies: routingQuickReplies(),
        },
      ],
      attachTicketId: null,
      inboundRoutingKind: "unclassified",
      processed: true,
    };
  }

  if (state === "collaboration") {
    if (command === "support_reclassify" || command === "creator_support") {
      return startIntake(snapshot, signal, "reclassify");
    }
    if (idleExpired(snapshot.lastActivityAt, signal.timestamp)) {
      return startRouting(snapshot, signal);
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
      const sessionId =
        snapshot.collected.routingSessionId ?? newSessionId(signal.messageId);
      const key = promptKey("cancelled", sessionId);
      return {
        snapshot: withActivity(snapshot, signal, {
          state: "cancelled",
          routingIntent: "unclassified",
          currentIntakeField: null,
          lastPromptKey: key,
        }),
        effects: [
          { type: "send_text", text: INTAKE_CANCELLED_TEXT, promptKey: key },
        ],
        attachTicketId: null,
        inboundRoutingKind: "support",
        processed: true,
      };
    }
    if (command === "restart" || (state === "awaiting_confirmation" && command === "edit")) {
      return startIntake(snapshot, signal, "restart");
    }
  }

  if (state === "awaiting_confirmation") {
    if (
      (command === "confirm" || command === "yes") &&
      isIntakeComplete(snapshot.collected)
    ) {
      return createTicketFromIntake(snapshot, signal, snapshot.collected);
    }
    return startIntake(snapshot, signal, "restart");
  }

  if (state === "support_intake") {
    return continueIntake(snapshot, signal);
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

  return startRouting(snapshot, signal);
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
    ...overrides,
  };
}
