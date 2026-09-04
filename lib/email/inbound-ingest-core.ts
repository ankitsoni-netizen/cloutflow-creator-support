export type InboundEmailIngestOutcome =
  | "appended"
  | "duplicate"
  | "ignored"
  | "rejected";

export type InboundEmailIngestResult = {
  outcome: InboundEmailIngestOutcome;
  errorCode: string | null;
  reopened: boolean;
  commentId: string | null;
};

export type InboundEmailIngestInput = {
  messageId: string;
  aliasLocalPart: string | null;
  senderNormalized: string | null;
  bodyText: string;
  ignoreReason: string | null;
  attachments: Array<{
    filename: string;
    content_type: string;
    byte_size: number | null;
    status: string;
  }>;
};

export type InMemoryInboundTicket = {
  id: string;
  creatorEmail: string | null;
  status: string;
  sourceChannel: string;
  externalContactId: string | null;
  externalConversationId: string | null;
  recipientAccountId: string | null;
  identityStatus: string | null;
  resolvedAt: string | null;
};

export type InMemoryInboundState = {
  tickets: InMemoryInboundTicket[];
  aliases: Array<{ ticketId: string; localPart: string; revokedAt: string | null }>;
  events: Array<{
    messageId: string;
    outcome: InboundEmailIngestOutcome;
    errorCode: string | null;
    ticketId: string | null;
    commentId: string | null;
    reopened: boolean;
  }>;
  comments: Array<{
    id: string;
    ticketId: string;
    commentText: string;
    sendToCreator: boolean;
    visibility: "creator";
    authorName: string;
  }>;
  eventsAudit: Array<{
    ticketId: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
  }>;
  attachments: Array<{ filename: string; status: string; eventMessageId: string }>;
};

export function applyIngestBrevoInboundEmail(
  state: InMemoryInboundState,
  input: InboundEmailIngestInput,
  nextId: () => string,
): InboundEmailIngestResult {
  const existing = state.events.find((row) => row.messageId === input.messageId);
  if (existing) {
    return {
      outcome: "duplicate",
      errorCode: null,
      reopened: existing.reopened,
      commentId: existing.commentId,
    };
  }

  if (input.ignoreReason) {
    state.events.push({
      messageId: input.messageId,
      outcome: "ignored",
      errorCode: input.ignoreReason,
      ticketId: null,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "ignored",
      errorCode: input.ignoreReason,
      reopened: false,
      commentId: null,
    };
  }

  const local = input.aliasLocalPart;
  if (!local || !/^t-[0-9a-f]{32}$/.test(local)) {
    state.events.push({
      messageId: input.messageId,
      outcome: "rejected",
      errorCode: "alias_invalid",
      ticketId: null,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "rejected",
      errorCode: "alias_invalid",
      reopened: false,
      commentId: null,
    };
  }

  const alias = state.aliases.find((row) => row.localPart === local);
  if (!alias) {
    state.events.push({
      messageId: input.messageId,
      outcome: "rejected",
      errorCode: "alias_unknown",
      ticketId: null,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "rejected",
      errorCode: "alias_unknown",
      reopened: false,
      commentId: null,
    };
  }
  if (alias.revokedAt) {
    state.events.push({
      messageId: input.messageId,
      outcome: "rejected",
      errorCode: "alias_revoked",
      ticketId: alias.ticketId,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "rejected",
      errorCode: "alias_revoked",
      reopened: false,
      commentId: null,
    };
  }

  const ticket = state.tickets.find((row) => row.id === alias.ticketId);
  if (!ticket) {
    state.events.push({
      messageId: input.messageId,
      outcome: "rejected",
      errorCode: "ticket_not_found",
      ticketId: null,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "rejected",
      errorCode: "ticket_not_found",
      reopened: false,
      commentId: null,
    };
  }

  const bound = (ticket.creatorEmail ?? "").trim().toLowerCase();
  if (!bound) {
    state.events.push({
      messageId: input.messageId,
      outcome: "rejected",
      errorCode: "creator_email_missing",
      ticketId: ticket.id,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "rejected",
      errorCode: "creator_email_missing",
      reopened: false,
      commentId: null,
    };
  }
  if ((input.senderNormalized ?? "").trim().toLowerCase() !== bound) {
    state.events.push({
      messageId: input.messageId,
      outcome: "rejected",
      errorCode: "sender_mismatch",
      ticketId: ticket.id,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "rejected",
      errorCode: "sender_mismatch",
      reopened: false,
      commentId: null,
    };
  }

  const commentId = nextId();
  const body = input.bodyText.trim();
  if (!body) {
    state.events.push({
      messageId: input.messageId,
      outcome: "ignored",
      errorCode: "empty_reply",
      ticketId: ticket.id,
      commentId: null,
      reopened: false,
    });
    return {
      outcome: "ignored",
      errorCode: "empty_reply",
      reopened: false,
      commentId: null,
    };
  }
  state.comments.push({
    id: commentId,
    ticketId: ticket.id,
    commentText: body.slice(0, 20000),
    sendToCreator: false,
    visibility: "creator",
    authorName: "Creator",
  });

  let reopened = false;
  if (ticket.status === "resolved") {
    state.eventsAudit.push({
      ticketId: ticket.id,
      eventType: "status_changed",
      fromStatus: "resolved",
      toStatus: "open",
    });
    ticket.status = "open";
    ticket.resolvedAt = null;
    reopened = true;
  }

  for (const attachment of input.attachments) {
    state.attachments.push({
      filename: attachment.filename,
      status: attachment.status,
      eventMessageId: input.messageId,
    });
  }

  state.events.push({
    messageId: input.messageId,
    outcome: "appended",
    errorCode: null,
    ticketId: ticket.id,
    commentId,
    reopened,
  });
  return { outcome: "appended", errorCode: null, reopened, commentId };
}
