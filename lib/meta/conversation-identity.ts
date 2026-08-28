import { META_INSTAGRAM_PROVIDER } from "@/lib/meta/constants";
import { isIdentitySchemaPhaseC } from "@/lib/meta/identity-schema-phase";
import { whatsappExternalConversationId } from "@/lib/meta/whatsapp-ids";
import type {
  ChannelWebhookProvider,
  MetaChannel,
  NormalizedInstagramEcho,
  NormalizedMetaInboundText,
} from "@/lib/meta/types";

export const IDENTITY_MISSING = "identity_missing";
export const IDENTITY_AMBIGUOUS = "identity_ambiguous";

export type ConversationIdentity = {
  provider: ChannelWebhookProvider;
  channel: MetaChannel;
  recipientAccountId: string;
  externalContactId: string;
  /** Canonical scoped key: `{receivingAccountId}:{stableSenderId}`. */
  externalConversationId: string;
};

export type ConversationLookupIdentity = {
  externalContactId?: string | null;
  provider?: string | null;
  recipientAccountId?: string | null;
};

export type IdentityRecord = {
  provider?: string | null;
  channel?: string | null;
  recipientAccountId?: string | null;
  recipient_account_id?: string | null;
  externalContactId?: string | null;
  external_contact_id?: string | null;
  externalConversationId?: string | null;
  external_conversation_id?: string | null;
  identityStatus?: string | null;
  identity_status?: string | null;
};

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function scopedExternalConversationId(
  recipientAccountId: string,
  externalContactId: string,
): string {
  return `${recipientAccountId}:${externalContactId}`;
}

/**
 * Receiving account encoded in `{recipient}:{sender}`. Returns null when the
 * conversation id is the sender-only legacy key or a bare page/recipient id.
 */
export function inferRecipientAccountId(
  conversationId: string | null | undefined,
  contactId: string | null | undefined,
): string | null {
  const conversation = nonEmpty(conversationId);
  const contact = nonEmpty(contactId);
  if (!conversation || !contact) return null;
  const suffix = `:${contact}`;
  if (!conversation.endsWith(suffix)) return null;
  const recipient = conversation.slice(0, -suffix.length);
  if (!recipient || recipient === contact) return null;
  return recipient;
}

export function resolvedRecipientAccountId(
  recipientAccountId: string | null | undefined,
  conversationId: string | null | undefined,
  contactId: string | null | undefined,
): string | null {
  return (
    nonEmpty(recipientAccountId) ??
    inferRecipientAccountId(conversationId, contactId)
  );
}

export function instagramExternalConversationId(
  recipientAccountId: string,
  senderIgSid: string,
): string {
  return scopedExternalConversationId(recipientAccountId, senderIgSid);
}

/** Receiving account from a `{account}:{sender}` conversation key. */
export function recipientAccountIdFromConversationKey(
  externalConversationId: string | null | undefined,
  externalContactId: string | null | undefined,
): string | null {
  return inferRecipientAccountId(externalConversationId, externalContactId);
}

export function channelIdentityFromInbound(
  event: Pick<
    NormalizedMetaInboundText,
    | "channel"
    | "provider"
    | "externalContactId"
    | "externalConversationId"
    | "recipientAccountId"
    | "phoneNumberId"
  >,
): ConversationIdentity | null {
  const externalContactId = nonEmpty(event.externalContactId);
  if (!externalContactId) return null;

  if (event.channel === "instagram") {
    const recipientAccountId = nonEmpty(event.recipientAccountId);
    if (!recipientAccountId) return null;
    if (recipientAccountId === externalContactId) return null;
    return {
      provider: event.provider,
      channel: "instagram",
      recipientAccountId,
      externalContactId,
      externalConversationId: instagramExternalConversationId(
        recipientAccountId,
        externalContactId,
      ),
    };
  }

  if (event.channel !== "whatsapp") return null;
  const recipientAccountId =
    nonEmpty(event.recipientAccountId) ?? nonEmpty(event.phoneNumberId);
  if (!recipientAccountId) return null;
  if (recipientAccountId === externalContactId) return null;
  return {
    provider: event.provider,
    channel: "whatsapp",
    recipientAccountId,
    externalContactId,
    externalConversationId: whatsappExternalConversationId(
      recipientAccountId,
      externalContactId,
    ),
  };
}

export function instagramEchoIdentity(
  echo: Pick<
    NormalizedInstagramEcho,
    "provider" | "senderId" | "recipientId"
  >,
): ConversationIdentity | null {
  const recipientAccountId = nonEmpty(echo.senderId);
  const externalContactId = nonEmpty(echo.recipientId);
  if (!recipientAccountId || !externalContactId) return null;
  if (recipientAccountId === externalContactId) return null;
  return {
    provider: echo.provider || META_INSTAGRAM_PROVIDER,
    channel: "instagram",
    recipientAccountId,
    externalContactId,
    externalConversationId: instagramExternalConversationId(
      recipientAccountId,
      externalContactId,
    ),
  };
}

function recordContactId(row: IdentityRecord): string | null {
  return nonEmpty(row.externalContactId) ?? nonEmpty(row.external_contact_id);
}

function recordConversationId(row: IdentityRecord): string | null {
  return (
    nonEmpty(row.externalConversationId) ??
    nonEmpty(row.external_conversation_id)
  );
}

function recordRecipientAccountId(row: IdentityRecord): string | null {
  return (
    nonEmpty(row.recipientAccountId) ?? nonEmpty(row.recipient_account_id)
  );
}

function recordIdentityStatus(row: IdentityRecord): string | null {
  return nonEmpty(row.identityStatus) ?? nonEmpty(row.identity_status);
}

function identityRecipientAccountId(
  identity: ConversationIdentity,
): string | null {
  return resolvedRecipientAccountId(
    identity.recipientAccountId,
    identity.externalConversationId,
    identity.externalContactId,
  );
}

function canonicalConversationIdFor(
  identity: ConversationIdentity,
): string | null {
  const recipient = identityRecipientAccountId(identity);
  if (!recipient) return null;
  return scopedExternalConversationId(recipient, identity.externalContactId);
}

/**
 * Phase C: exact canonical row. Ambiguous/quarantined/missing metadata are
 * never eligible, even when the conversation id is already scoped.
 */
function isExactCanonicalUnambiguous(
  row: IdentityRecord,
  identity: ConversationIdentity,
): boolean {
  if (!outboundIdentityAllowsReply(recordIdentityStatus(row))) return false;
  const contactId = recordContactId(row);
  const conversationId = recordConversationId(row);
  const canonicalId = canonicalConversationIdFor(identity);
  const identityRecipient = identityRecipientAccountId(identity);
  const recipient =
    recordRecipientAccountId(row) ??
    inferRecipientAccountId(conversationId, contactId);
  if (
    !contactId ||
    !conversationId ||
    !recipient ||
    !canonicalId ||
    !identityRecipient
  ) {
    return false;
  }
  if (contactId !== identity.externalContactId) return false;
  if (recipient !== identityRecipient) return false;
  if (conversationId !== canonicalId) return false;
  const provider = nonEmpty(row.provider);
  if (provider && provider !== identity.provider) return false;
  return true;
}

/**
 * Phase C legacy upgrade: sender-only key, proven unambiguous owner only.
 * Page-only keys, ambiguous, and quarantined rows are never eligible.
 */
function isEligibleUnambiguousLegacy(
  row: IdentityRecord,
  identity: ConversationIdentity,
): boolean {
  if (!outboundIdentityAllowsReply(recordIdentityStatus(row))) return false;
  const contactId = recordContactId(row);
  const conversationId = recordConversationId(row);
  const identityRecipient = identityRecipientAccountId(identity);
  const canonicalId = canonicalConversationIdFor(identity);
  if (!contactId || !conversationId || !identityRecipient || !canonicalId) {
    return false;
  }
  if (contactId !== identity.externalContactId) return false;
  if (conversationId === canonicalId) return false;
  if (conversationId !== contactId) return false;
  const recipient = recordRecipientAccountId(row);
  if (recipient && recipient !== identityRecipient) return false;
  const provider = nonEmpty(row.provider);
  if (provider && provider !== identity.provider) return false;
  return true;
}

function selectPhaseCIdentityMatch<T extends IdentityRecord>(
  structuralMatches: readonly T[],
  identity: ConversationIdentity,
): T | null | { errorCode: typeof IDENTITY_AMBIGUOUS } {
  const canonical = structuralMatches.filter((row) =>
    isExactCanonicalUnambiguous(row, identity),
  );
  if (canonical.length > 1) return { errorCode: IDENTITY_AMBIGUOUS };
  if (canonical.length === 1) return canonical[0] ?? null;

  const legacy = structuralMatches.filter((row) =>
    isEligibleUnambiguousLegacy(row, identity),
  );
  if (legacy.length > 1) return { errorCode: IDENTITY_AMBIGUOUS };
  if (legacy.length === 1) return legacy[0] ?? null;

  if (structuralMatches.length > 0) return { errorCode: IDENTITY_AMBIGUOUS };
  return null;
}

export function conversationIdentityFromLookup(input: {
  channel: MetaChannel;
  externalConversationId: string;
  externalContactId?: string | null;
  provider?: string | null;
  recipientAccountId?: string | null;
}): ConversationIdentity | null {
  const externalContactId = nonEmpty(input.externalContactId);
  const externalConversationId = nonEmpty(input.externalConversationId);
  if (!externalContactId || !externalConversationId) return null;
  const recipientAccountId =
    resolvedRecipientAccountId(
      input.recipientAccountId,
      externalConversationId,
      externalContactId,
    ) ?? "";
  const provider = (nonEmpty(input.provider) ||
    (input.channel === "whatsapp"
      ? "meta_whatsapp"
      : "meta_instagram")) as ChannelWebhookProvider;
  return {
    provider,
    channel: input.channel,
    recipientAccountId,
    externalContactId,
    externalConversationId,
  };
}

/**
 * Conversation lookup candidates for an identity, most specific first.
 * Legacy Instagram/WATI rows used the stable sender id as conversation id.
 * A bare receiving page/account id is never the first candidate.
 */
export function conversationLookupIds(identity: ConversationIdentity): string[] {
  const ids: string[] = [];
  const add = (value: string | null | undefined) => {
    const id = nonEmpty(value);
    if (id && !ids.includes(id)) ids.push(id);
  };
  const recipient = resolvedRecipientAccountId(
    identity.recipientAccountId,
    identity.externalConversationId,
    identity.externalContactId,
  );
  if (recipient) {
    add(scopedExternalConversationId(recipient, identity.externalContactId));
  }
  add(identity.externalConversationId);
  add(identity.externalContactId);
  return ids;
}

export function conversationRowMatchesIdentity(
  row: IdentityRecord,
  identity: ConversationIdentity,
): boolean {
  const contactId = recordContactId(row);
  if (!contactId || contactId !== identity.externalContactId) return false;

  const channel = nonEmpty(row.channel);
  if (channel && channel !== identity.channel) return false;

  if (isIdentitySchemaPhaseC()) {
    const provider = nonEmpty(row.provider);
    if (provider && provider !== identity.provider) return false;

    const recipientAccountId = recordRecipientAccountId(row);
    const identityRecipient = resolvedRecipientAccountId(
      identity.recipientAccountId,
      identity.externalConversationId,
      identity.externalContactId,
    );
    if (
      recipientAccountId &&
      identityRecipient &&
      recipientAccountId !== identityRecipient
    ) {
      return false;
    }
  }

  const conversationId = recordConversationId(row);
  if (!conversationId) return false;
  if (conversationLookupIds(identity).includes(conversationId)) return true;
  return false;
}

/**
 * Active-ticket match: the stable sender id is required. Conversation id may be
 * the canonical scoped key or the legacy sender-only key. Conversation id alone
 * never matches — that is the CF-2026-00027 failure mode when it holds a page id.
 */
export function activeTicketMatchesIdentity(
  ticket: IdentityRecord & { sourceChannel?: string | null; source_channel?: string | null },
  identity: ConversationIdentity,
  sourceChannel: MetaChannel,
): boolean {
  const ticketChannel =
    nonEmpty(ticket.sourceChannel) ?? nonEmpty(ticket.source_channel);
  if (ticketChannel !== sourceChannel) return false;

  const contactId = recordContactId(ticket);
  if (!contactId || contactId !== identity.externalContactId) return false;

  const conversationId = recordConversationId(ticket);
  if (!conversationId) return false;

  if (isIdentitySchemaPhaseC()) {
    const recipientAccountId = recordRecipientAccountId(ticket);
    const identityRecipient = resolvedRecipientAccountId(
      identity.recipientAccountId,
      identity.externalConversationId,
      identity.externalContactId,
    );
    if (
      recipientAccountId &&
      identityRecipient &&
      recipientAccountId !== identityRecipient
    ) {
      return false;
    }
  }

  if (conversationLookupIds(identity).includes(conversationId)) return true;
  return false;
}

export function findConversationForIdentity<T extends IdentityRecord>(
  rows: readonly T[],
  identity: ConversationIdentity,
): T | null | { errorCode: typeof IDENTITY_AMBIGUOUS } {
  const matches = rows.filter((row) =>
    conversationRowMatchesIdentity(row, identity),
  );
  if (isIdentitySchemaPhaseC()) {
    return selectPhaseCIdentityMatch(matches, identity);
  }
  if (matches.length > 1) return { errorCode: IDENTITY_AMBIGUOUS };
  return matches[0] ?? null;
}

export function findActiveTicketForIdentity<T extends IdentityRecord>(
  rows: readonly T[],
  identity: ConversationIdentity,
  sourceChannel: MetaChannel,
  isActive: (row: T) => boolean,
): T | null | { errorCode: typeof IDENTITY_MISSING | typeof IDENTITY_AMBIGUOUS } {
  if (!identity.externalContactId || !identity.externalConversationId) {
    return { errorCode: IDENTITY_MISSING };
  }
  const matches = rows.filter(
    (row) =>
      isActive(row) && activeTicketMatchesIdentity(row, identity, sourceChannel),
  );
  if (isIdentitySchemaPhaseC()) {
    const selected = selectPhaseCIdentityMatch(matches, identity);
    if (selected && "errorCode" in selected) return selected;
    return selected;
  }
  if (matches.length > 1) return { errorCode: IDENTITY_AMBIGUOUS };
  return matches[0] ?? null;
}

export function boundOutboundRecipient(
  conversationContactId: string | null | undefined,
  ticketContactId: string | null | undefined,
): string | null {
  const bound = nonEmpty(conversationContactId);
  if (!bound) return null;
  const ticket = nonEmpty(ticketContactId);
  if (ticket && ticket !== bound) return null;
  return bound;
}

export type LegacyIdentityStatus = "unambiguous" | "ambiguous" | "quarantined";

/**
 * Classify a legacy conversation/ticket. Page-only keys and mixed webhook
 * senders cannot be auto-backfilled. Echo/page senders must be omitted from
 * distinctWebhookSenderIds before calling this.
 */
export function classifyLegacyIdentity(input: {
  contactId: string | null | undefined;
  conversationId: string | null | undefined;
  recipientAccountId: string | null | undefined;
  distinctWebhookSenderIds?: string[];
}): LegacyIdentityStatus {
  const contactId = nonEmpty(input.contactId);
  const conversationId = nonEmpty(input.conversationId);
  const recipientAccountId =
    nonEmpty(input.recipientAccountId) ??
    inferRecipientAccountId(conversationId, contactId);
  if (!contactId || !conversationId) return "ambiguous";
  if (!recipientAccountId || recipientAccountId === contactId) return "ambiguous";

  const senders = [
    ...new Set(
      (input.distinctWebhookSenderIds ?? [])
        .map((value) => nonEmpty(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (senders.length > 1) return "quarantined";
  if (senders.length === 1 && senders[0] !== contactId) return "quarantined";
  if (conversationId === recipientAccountId) {
    if (senders.length === 1 && senders[0] === contactId) return "unambiguous";
    return "ambiguous";
  }
  return "unambiguous";
}

/**
 * Phase C only: outbound requires an explicit unambiguous status.
 * Missing status fails closed so Phase C cannot run on an un-backfilled schema.
 */
export function outboundIdentityAllowsReply(
  identityStatus: string | null | undefined,
): boolean {
  return nonEmpty(identityStatus) === "unambiguous";
}

/**
 * Phase A outbound proof using existing ticket/conversation keys only.
 * Page-only conversation ids, missing contacts, and contact mismatches fail closed.
 */
export function phaseAOutboundIdentityProven(input: {
  ticketContactId?: string | null;
  ticketConversationId?: string | null;
  conversationContactId?: string | null;
  conversationId?: string | null;
}): boolean {
  const ticketContact = nonEmpty(input.ticketContactId);
  if (!ticketContact) return false;
  const conversationContact = nonEmpty(input.conversationContactId);
  if (conversationContact && conversationContact !== ticketContact) return false;
  const conversationId =
    nonEmpty(input.conversationId) ?? nonEmpty(input.ticketConversationId);
  if (!conversationId) return false;
  if (conversationId === ticketContact) return true;
  const recipient = inferRecipientAccountId(conversationId, ticketContact);
  return Boolean(recipient && recipient !== ticketContact);
}

export function allowOutboundReply(input: {
  identityStatus?: string | null;
  ticketContactId?: string | null;
  ticketConversationId?: string | null;
  conversationContactId?: string | null;
  conversationId?: string | null;
}): boolean {
  if (isIdentitySchemaPhaseC()) {
    return outboundIdentityAllowsReply(input.identityStatus);
  }
  return phaseAOutboundIdentityProven(input);
}
