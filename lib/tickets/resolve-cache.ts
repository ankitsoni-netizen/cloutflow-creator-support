import type { InboxView, Ticket, TicketStatus } from "@/lib/types";
import { countTicketsForView, ticketMatchesInboxView } from "@/lib/utils";

export const RESOLVE_SUCCESS_NOTICE = "Ticket marked as resolved";
export const RESOLVE_PENDING_NOTICE = "Resolving ticket…";
export const RESOLVE_CHECKING_NOTICE = "Checking ticket status…";
export const RESOLVE_FAILURE_MESSAGE =
  "Could not resolve the ticket. Please retry.";
export const RESOLVE_UNAVAILABLE_MESSAGE =
  "Ticket resolution is temporarily unavailable. Please retry.";

export const INBOX_VIEW_IDS: InboxView[] = [
  "all-active",
  "my-tickets",
  "unassigned",
  "open",
  "in-progress",
  "waiting",
  "urgent",
  "pending-reply",
  "resolved",
];

export type TicketsCacheSnapshot = {
  tickets: Ticket[];
  selectedId: string | null;
  pendingReplyIds: Set<string>;
};

export type ResolveFailureState = {
  ticketId: string;
  resolutionSummary: string;
  message: string;
};

export type ResolveActionA11y = {
  label: string;
  disabled: boolean;
  ariaBusy: boolean;
  ariaDisabled: boolean;
  ariaLive: "polite" | "off";
  statusMessage: string | null;
};

export function snapshotTicketsCache(
  cache: TicketsCacheSnapshot,
): TicketsCacheSnapshot {
  return {
    tickets: cache.tickets.map((ticket) => ({ ...ticket })),
    selectedId: cache.selectedId,
    pendingReplyIds: new Set(cache.pendingReplyIds),
  };
}

export function buildOptimisticResolvedTicket(
  ticket: Ticket,
  resolutionSummary: string,
  resolvedAtIso: string,
): Ticket {
  return {
    ...ticket,
    status: "Resolved",
    resolutionSummary,
    resolvedAt: resolvedAtIso,
    updatedAt: resolvedAtIso,
  };
}

export function replaceTicketInCache(
  tickets: Ticket[],
  next: Ticket,
): Ticket[] {
  let found = false;
  const updated = tickets.map((ticket) => {
    if (ticket.id !== next.id) return ticket;
    found = true;
    return next;
  });
  return found ? updated : [next, ...tickets];
}

export function applyOptimisticResolve(
  cache: TicketsCacheSnapshot,
  ticket: Ticket,
  resolutionSummary: string,
  resolvedAtIso: string,
): TicketsCacheSnapshot {
  const optimistic = buildOptimisticResolvedTicket(
    ticket,
    resolutionSummary,
    resolvedAtIso,
  );
  const pendingReplyIds = new Set(cache.pendingReplyIds);
  pendingReplyIds.delete(ticket.id);
  return {
    tickets: replaceTicketInCache(cache.tickets, optimistic),
    selectedId: cache.selectedId,
    pendingReplyIds,
  };
}

export function reconcileResolvedTicket(
  cache: TicketsCacheSnapshot,
  canonical: Ticket,
): TicketsCacheSnapshot {
  const pendingReplyIds = new Set(cache.pendingReplyIds);
  if (canonical.status === "Resolved") {
    pendingReplyIds.delete(canonical.id);
  }
  return {
    tickets: replaceTicketInCache(cache.tickets, canonical),
    selectedId: cache.selectedId,
    pendingReplyIds,
  };
}

export function rollbackResolveCache(
  _current: TicketsCacheSnapshot,
  snapshot: TicketsCacheSnapshot,
): TicketsCacheSnapshot {
  return snapshotTicketsCache(snapshot);
}

export function inboxCountsForCache(
  tickets: Ticket[],
  staffUserId: string,
  staffFullName: string,
  pendingReplyIds?: Set<string>,
): Record<InboxView, number> {
  return Object.fromEntries(
    INBOX_VIEW_IDS.map((view) => [
      view,
      countTicketsForView(
        tickets,
        view,
        staffUserId,
        staffFullName,
        pendingReplyIds,
      ),
    ]),
  ) as Record<InboxView, number>;
}

export function ticketsInInboxView(
  tickets: Ticket[],
  view: InboxView,
  staffUserId: string,
  staffFullName: string,
  pendingReplyIds?: Set<string>,
): Ticket[] {
  return tickets
    .filter((ticket) =>
      ticketMatchesInboxView(
        ticket,
        view,
        staffUserId,
        staffFullName,
        pendingReplyIds,
      ),
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

export function resolveTicketIdempotencyKey(ticketId: string): string {
  return `ticket-resolution:${ticketId}`;
}

export function resolveActionA11y(input: {
  status: TicketStatus;
  pending: boolean;
  checking?: boolean;
  failed: boolean;
}): ResolveActionA11y {
  const resolved = input.status === "Resolved";
  const pending = input.pending || Boolean(input.checking);
  const disabled = resolved || pending;
  let statusMessage: string | null = null;
  if (input.checking) statusMessage = RESOLVE_CHECKING_NOTICE;
  else if (input.pending) statusMessage = RESOLVE_PENDING_NOTICE;
  else if (resolved) statusMessage = RESOLVE_SUCCESS_NOTICE;
  else if (input.failed) statusMessage = RESOLVE_FAILURE_MESSAGE;

  return {
    label: input.checking
      ? "Checking..."
      : input.pending
        ? "Resolving..."
        : resolved
          ? "Resolved"
          : "Mark as Resolved",
    disabled,
    ariaBusy: pending,
    ariaDisabled: disabled,
    ariaLive: pending || resolved || input.failed ? "polite" : "off",
    statusMessage,
  };
}

export type ResolveActionClassification =
  | { kind: "success"; ticket: Ticket }
  | { kind: "definite_failure"; error: string }
  | { kind: "ambiguous" };

export type CanonicalVerification =
  | { kind: "success"; ticket: Ticket }
  | { kind: "rollback" }
  | { kind: "checking" };

export function isDefiniteResolveFailure(error: string): boolean {
  const message = error.trim().toLowerCase();
  return (
    message.includes("required") ||
    message.includes("session expired") ||
    message.includes("not authorized") ||
    message.includes("temporarily unavailable") ||
    message.includes("unable to resolve")
  );
}

export function classifyResolveActionResult(
  result: { data: Ticket } | { error: string } | null | undefined,
): ResolveActionClassification {
  if (!result || typeof result !== "object") return { kind: "ambiguous" };
  if ("data" in result && result.data && typeof result.data === "object") {
    if (result.data.status === "Resolved") {
      return { kind: "success", ticket: result.data };
    }
    return { kind: "ambiguous" };
  }
  if ("error" in result && typeof result.error === "string" && result.error.trim()) {
    if (isDefiniteResolveFailure(result.error)) {
      return { kind: "definite_failure", error: result.error };
    }
    return { kind: "ambiguous" };
  }
  return { kind: "ambiguous" };
}

export function classifyCanonicalVerification(
  fetched: Ticket | null,
  fetchFailed: boolean,
): CanonicalVerification {
  if (fetchFailed || !fetched) return { kind: "checking" };
  if (fetched.status === "Resolved") return { kind: "success", ticket: fetched };
  return { kind: "rollback" };
}

export function mergeCanonicalTicket(
  tickets: Ticket[],
  incoming: Ticket,
  options: { allowReopen: boolean },
): Ticket[] {
  const current = tickets.find((ticket) => ticket.id === incoming.id);
  if (!current) return replaceTicketInCache(tickets, incoming);
  if (!shouldApplyCanonicalTicket(current, incoming, options)) return tickets;
  return replaceTicketInCache(tickets, incoming);
}

export function shouldApplyCanonicalTicket(
  current: Ticket,
  incoming: Ticket,
  options: { allowReopen: boolean },
): boolean {
  if (incoming.id !== current.id) return false;
  const currentTs = Date.parse(current.updatedAt);
  const incomingTs = Date.parse(incoming.updatedAt);
  if (
    Number.isFinite(currentTs) &&
    Number.isFinite(incomingTs) &&
    incomingTs < currentTs
  ) {
    return false;
  }
  if (
    !options.allowReopen &&
    current.status === "Resolved" &&
    incoming.status !== "Resolved"
  ) {
    return false;
  }
  return true;
}

export type OptimisticResolveController = {
  inFlight: Set<string>;
  snapshots: Map<string, TicketsCacheSnapshot>;
};

export function createOptimisticResolveController(): OptimisticResolveController {
  return {
    inFlight: new Set<string>(),
    snapshots: new Map<string, TicketsCacheSnapshot>(),
  };
}

export function beginOptimisticResolve(input: {
  controller: OptimisticResolveController;
  cache: TicketsCacheSnapshot;
  ticket: Ticket;
  resolutionSummary: string;
  resolvedAtIso: string;
}):
  | { started: false; cache: TicketsCacheSnapshot }
  | {
      started: true;
      cache: TicketsCacheSnapshot;
      optimisticTicket: Ticket;
    } {
  if (
    input.controller.inFlight.has(input.ticket.id) ||
    input.ticket.status === "Resolved"
  ) {
    return { started: false, cache: input.cache };
  }
  input.controller.inFlight.add(input.ticket.id);
  input.controller.snapshots.set(
    input.ticket.id,
    snapshotTicketsCache(input.cache),
  );
  const cache = applyOptimisticResolve(
    input.cache,
    input.ticket,
    input.resolutionSummary,
    input.resolvedAtIso,
  );
  return {
    started: true,
    cache,
    optimisticTicket: buildOptimisticResolvedTicket(
      input.ticket,
      input.resolutionSummary,
      input.resolvedAtIso,
    ),
  };
}

export function completeOptimisticResolveSuccess(input: {
  controller: OptimisticResolveController;
  cache: TicketsCacheSnapshot;
  canonical: Ticket;
}): TicketsCacheSnapshot {
  input.controller.inFlight.delete(input.canonical.id);
  input.controller.snapshots.delete(input.canonical.id);
  return reconcileResolvedTicket(input.cache, input.canonical);
}

export function completeOptimisticResolveFailure(input: {
  controller: OptimisticResolveController;
  cache: TicketsCacheSnapshot;
  ticketId: string;
}): {
  cache: TicketsCacheSnapshot;
  failure: ResolveFailureState | null;
} {
  const snapshot = input.controller.snapshots.get(input.ticketId);
  input.controller.inFlight.delete(input.ticketId);
  input.controller.snapshots.delete(input.ticketId);
  const previous = snapshot?.tickets.find((ticket) => ticket.id === input.ticketId);
  const pendingReplyIds = new Set(input.cache.pendingReplyIds);
  if (snapshot?.pendingReplyIds.has(input.ticketId)) {
    pendingReplyIds.add(input.ticketId);
  } else {
    pendingReplyIds.delete(input.ticketId);
  }
  return {
    cache: {
      tickets: previous
        ? replaceTicketInCache(input.cache.tickets, previous)
        : input.cache.tickets,
      selectedId: snapshot?.selectedId ?? input.cache.selectedId,
      pendingReplyIds,
    },
    failure: {
      ticketId: input.ticketId,
      resolutionSummary: "",
      message: RESOLVE_FAILURE_MESSAGE,
    },
  };
}
