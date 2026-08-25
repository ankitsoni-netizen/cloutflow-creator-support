import { detectRoutingCommand } from "@/lib/meta/commands";
import {
  applyIntakeValue,
  emptyIntakeCollected,
  formatIntakeSummary,
  INTAKE_FIELDS,
  INTAKE_ISSUE_TYPE_LABELS,
  intakePromptForField,
  nextIntakeField,
  type IntakeCollectedData,
  type IntakeField,
  type IntakeIssueType,
  validateIntakeField,
} from "@/lib/meta/intake-validate";
import { isActiveTicketStatus } from "@/lib/meta/instagram-ticket";
import {
  CANCEL_PAYLOAD,
  COLLABORATION_CONFIRMED_TEXT,
  CONFIRM_PAYLOAD,
  CONFIRMATION_PROMPT_TEXT,
  CREATOR_SUPPORT_STARTED_TEXT,
  EDIT_PAYLOAD,
  INTAKE_CANCELLED_TEXT,
  INTAKE_RESTARTED_TEXT,
  ROUTE_COLLABORATION_PAYLOAD,
  ROUTE_CREATOR_SUPPORT_PAYLOAD,
  ROUTING_CLARIFY_TEXT,
  ROUTING_COLLABORATION_QUICK_REPLY_TITLE,
  ROUTING_CREATOR_SUPPORT_TITLE,
  ROUTING_QUESTION_TEXT,
  YES_PAYLOAD,
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

function issueTypeQuickReplies(): InstagramQuickReply[] {
  return (Object.keys(INTAKE_ISSUE_TYPE_LABELS) as IntakeIssueType[]).map(
    (key) => qr(INTAKE_ISSUE_TYPE_LABELS[key], key.toUpperCase()),
  );
}

function confirmationQuickReplies(): InstagramQuickReply[] {
  return [
    qr("Confirm", CONFIRM_PAYLOAD),
    qr("Edit", EDIT_PAYLOAD),
    qr("Cancel", CANCEL_PAYLOAD),
  ];
}

function yesCancelQuickReplies(): InstagramQuickReply[] {
  return [qr("Yes", YES_PAYLOAD), qr("Cancel", CANCEL_PAYLOAD)];
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
  suggestedSocialHandle: string | null,
): IntakeCollectedData {
  const next = { ...collected };
  if (!next.originalInboundText) {
    next.originalInboundText = signal.text;
    next.originalInboundMessageId = signal.messageId;
  }
  if (!next.socialHandle && suggestedSocialHandle) {
    next.socialHandle = suggestedSocialHandle.replace(/^@/, "");
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
      socialHandle: snapshot.suggestedSocialHandle,
    }),
    signal,
    snapshot.suggestedSocialHandle,
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
    socialHandle: snapshot.collected.socialHandle ?? snapshot.suggestedSocialHandle,
  });
  const firstField = INTAKE_FIELDS[0];
  const introKey = promptKey("support_intro", sessionId, reason);
  const fieldKey = promptKey("intake", sessionId, firstField);
  const introText =
    reason === "restart" ? INTAKE_RESTARTED_TEXT : CREATOR_SUPPORT_STARTED_TEXT;
  const prompt = intakePromptForField(firstField, collected);

  return {
    snapshot: withActivity(snapshot, signal, {
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: firstField,
      collected,
      lastPromptKey: fieldKey,
    }),
    effects: [
      { type: "mark_unclassified_as", routingKind: "support" },
      { type: "send_text", text: introText, promptKey: introKey },
      {
        type: "send_text",
        text: prompt,
        promptKey: fieldKey,
      },
    ],
    attachTicketId: null,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function sendFieldPrompt(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  field: IntakeField,
  collected: IntakeCollectedData,
  extraText?: string,
): MachineResult {
  const sessionId =
    collected.routingSessionId ?? newSessionId(signal.messageId);
  const key = promptKey("intake", sessionId, field);
  const prompt = intakePromptForField(field, collected);
  const text = extraText ? `${extraText}\n\n${prompt}` : prompt;
  const quickReplies =
    field === "issue_type"
      ? issueTypeQuickReplies()
      : field === "social_handle" && collected.socialHandle
        ? yesCancelQuickReplies()
        : field === "issue_description" && collected.originalInboundText
          ? yesCancelQuickReplies()
          : undefined;
  return {
    snapshot: withActivity(snapshot, signal, {
      state: "support_intake",
      routingIntent: "creator_support",
      currentIntakeField: field,
      collected,
      lastPromptKey: key,
    }),
    effects: [
      quickReplies
        ? {
            type: "send_quick_replies",
            text,
            promptKey: key,
            quickReplies,
          }
        : { type: "send_text", text, promptKey: key },
    ],
    attachTicketId: null,
    inboundRoutingKind: "support",
    processed: true,
  };
}

function sendConfirmation(
  snapshot: ConversationSnapshot,
  signal: InboundSignal,
  collected: IntakeCollectedData,
): MachineResult {
  const sessionId =
    collected.routingSessionId ?? newSessionId(signal.messageId);
  const key = promptKey("confirm", sessionId);
  const text = `${formatIntakeSummary(collected)}\n\n${CONFIRMATION_PROMPT_TEXT}`;
  return {
    snapshot: withActivity(snapshot, signal, {
      state: "awaiting_confirmation",
      routingIntent: "creator_support",
      currentIntakeField: null,
      collected,
      lastPromptKey: key,
    }),
    effects: [
      {
        type: "send_quick_replies",
        text,
        promptKey: key,
        quickReplies: confirmationQuickReplies(),
      },
    ],
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
    if (command === "confirm" || command === "yes") {
      return {
        snapshot: withActivity(snapshot, signal, {
          state: "ticket_open",
          routingIntent: "creator_support",
          currentIntakeField: null,
        }),
        effects: [{ type: "create_ticket" }],
        attachTicketId: null,
        inboundRoutingKind: "support",
        processed: true,
      };
    }
    const sessionId =
      snapshot.collected.routingSessionId ?? newSessionId(signal.messageId);
    const key = promptKey("confirm_retry", sessionId);
    return {
      snapshot: withActivity(snapshot, signal, { lastPromptKey: key }),
      effects: [
        {
          type: "send_quick_replies",
          text: CONFIRMATION_PROMPT_TEXT,
          promptKey: key,
          quickReplies: confirmationQuickReplies(),
        },
      ],
      attachTicketId: null,
      inboundRoutingKind: "support",
      processed: true,
    };
  }

  if (state === "support_intake") {
    const field = snapshot.currentIntakeField ?? INTAKE_FIELDS[0];
    const answerText =
      command === "yes" && (field === "social_handle" || field === "issue_description")
        ? signal.quickReplyPayload === YES_PAYLOAD || /^yes$/i.test(signal.text)
          ? "yes"
          : signal.text
        : signal.quickReplyPayload && field === "issue_type"
          ? signal.quickReplyPayload
          : signal.text;
    const validated = validateIntakeField(field, answerText, snapshot.collected);
    if (!validated.ok) {
      const sessionId =
        snapshot.collected.routingSessionId ?? newSessionId(signal.messageId);
      const key = promptKey("intake_retry", sessionId, field);
      const quickReplies =
        field === "issue_type" ? issueTypeQuickReplies() : undefined;
      return {
        snapshot: withActivity(snapshot, signal, { lastPromptKey: key }),
        effects: [
          quickReplies
            ? {
                type: "send_quick_replies",
                text: validated.errorText,
                promptKey: key,
                quickReplies,
              }
            : {
                type: "send_text",
                text: validated.errorText,
                promptKey: key,
              },
        ],
        attachTicketId: null,
        inboundRoutingKind: "support",
        processed: true,
      };
    }

    const collected = applyIntakeValue(snapshot.collected, field, validated);
    const nextField = nextIntakeField(field);
    if (!nextField) {
      return sendConfirmation(snapshot, signal, collected);
    }
    return sendFieldPrompt(snapshot, signal, nextField, collected);
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
