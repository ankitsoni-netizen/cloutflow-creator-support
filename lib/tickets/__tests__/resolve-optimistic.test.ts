import { describe, expect, it } from "vitest";
import type { Ticket } from "@/lib/types";
import {
  RESOLVE_FAILURE_MESSAGE,
  RESOLVE_PENDING_NOTICE,
  RESOLVE_CHECKING_NOTICE,
  RESOLVE_SUCCESS_NOTICE,
  applyOptimisticResolve,
  beginOptimisticResolve,
  classifyCanonicalVerification,
  classifyResolveActionResult,
  completeOptimisticResolveFailure,
  completeOptimisticResolveSuccess,
  createOptimisticResolveController,
  inboxCountsForCache,
  mergeCanonicalTicket,
  resolveActionA11y,
  resolveTicketIdempotencyKey,
  shouldApplyCanonicalTicket,
  ticketsInInboxView,
  type TicketsCacheSnapshot,
} from "@/lib/tickets/resolve-cache";

const STAFF_ID = "staff-1";
const STAFF_NAME = "Priya Sharma";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    ticketNumber: "CF-2026-00001",
    creatorName: "Aarav Malhotra",
    phone: "+919876543210",
    email: "aarav@example.com",
    socialHandle: "@aarav",
    platform: "Instagram",
    issueType: "Payment Delayed",
    issueCategory: "Payment Delayed",
    requestCategory: "",
    requestCategoryKey: "",
    companyName: "",
    requesterType: "",
    topicOrModule: "",
    intakeDetails: {},
    campaignName: "Launch",
    brand: "Samsung",
    campaignMonth: "August 2026",
    cloutflowPoc: "Neha",
    cloutflowPocContactNumber: "+919000000000",
    issueDescription: "Payment delayed",
    sourceChannel: "WhatsApp",
    status: "Open",
    priority: "High",
    assignedTeam: "Creator Support",
    assignedExecutive: STAFF_NAME,
    assignedExecutiveId: STAFF_ID,
    createdAt: "2026-08-08T09:15:00.000Z",
    updatedAt: "2026-08-11T10:42:00.000Z",
    activity: [],
    ...overrides,
  };
}

function cache(tickets: Ticket[], selectedId = tickets[0]?.id ?? null): TicketsCacheSnapshot {
  return {
    tickets,
    selectedId,
    pendingReplyIds: new Set(tickets.map((item) => item.id)),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("optimistic resolve cache", () => {
  it("updates the ticket to Resolved before the mutation settles", async () => {
    const deferred = createDeferred<{ data: Ticket }>();
    const open = ticket();
    const controller = createOptimisticResolveController();
    const started = beginOptimisticResolve({
      controller,
      cache: cache([open, ticket({ id: "ticket-2", ticketNumber: "CF-2" })]),
      ticket: open,
      resolutionSummary: "Paid today",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    expect(started.started).toBe(true);
    if (!started.started) return;

    expect(started.optimisticTicket.status).toBe("Resolved");
    expect(started.cache.tickets[0]?.status).toBe("Resolved");
    expect(started.cache.tickets[0]?.resolvedAt).toBe("2026-08-27T12:00:00.000Z");
    expect(deferred.promise).toBeInstanceOf(Promise);

    deferred.resolve({
      data: {
        ...started.optimisticTicket,
        resolvedAt: "2026-08-27T12:00:05.000Z",
      },
    });
    const result = await deferred.promise;
    const reconciled = completeOptimisticResolveSuccess({
      controller,
      cache: started.cache,
      canonical: result.data,
    });
    expect(reconciled.tickets[0]?.resolvedAt).toBe("2026-08-27T12:00:05.000Z");
  });

  it("disables Resolve while a mutation is in flight", () => {
    const pending = resolveActionA11y({
      status: "Open",
      pending: true,
      failed: false,
    });
    expect(pending.disabled).toBe(true);
    expect(pending.ariaBusy).toBe(true);
    expect(pending.label).toBe("Resolving...");
    expect(pending.statusMessage).toBe("Resolving ticket…");
  });

  it("removes the ticket from the active queue and updates counters immediately", () => {
    const open = ticket();
    const other = ticket({ id: "ticket-2", ticketNumber: "CF-2", status: "In Progress" });
    const started = beginOptimisticResolve({
      controller: createOptimisticResolveController(),
      cache: cache([open, other]),
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    if (!started.started) throw new Error("expected start");

    const active = ticketsInInboxView(
      started.cache.tickets,
      "all-active",
      STAFF_ID,
      STAFF_NAME,
      started.cache.pendingReplyIds,
    );
    const resolved = ticketsInInboxView(
      started.cache.tickets,
      "resolved",
      STAFF_ID,
      STAFF_NAME,
      started.cache.pendingReplyIds,
    );
    const counts = inboxCountsForCache(
      started.cache.tickets,
      STAFF_ID,
      STAFF_NAME,
      started.cache.pendingReplyIds,
    );

    expect(active.map((item) => item.id)).toEqual(["ticket-2"]);
    expect(resolved.map((item) => item.id)).toEqual(["ticket-1"]);
    expect(counts["all-active"]).toBe(1);
    expect(counts.resolved).toBe(1);
    expect(counts.open).toBe(0);
    expect(started.cache.pendingReplyIds.has("ticket-1")).toBe(false);
  });

  it("reconciles provisional resolved_at with canonical server data", () => {
    const open = ticket();
    const controller = createOptimisticResolveController();
    const started = beginOptimisticResolve({
      controller,
      cache: cache([open]),
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    if (!started.started) throw new Error("expected start");
    const canonical = {
      ...started.optimisticTicket,
      resolvedAt: "2026-08-27T12:00:09.123Z",
      resolutionSummary: "Done",
    };
    const reconciled = completeOptimisticResolveSuccess({
      controller,
      cache: started.cache,
      canonical,
    });
    expect(reconciled.tickets[0]?.resolvedAt).toBe("2026-08-27T12:00:09.123Z");
    expect(controller.inFlight.has(open.id)).toBe(false);
  });

  it("rolls back ticket, queue, and counters when the mutation fails", () => {
    const open = ticket();
    const other = ticket({ id: "ticket-2", ticketNumber: "CF-2" });
    const original = cache([open, other], open.id);
    const controller = createOptimisticResolveController();
    const started = beginOptimisticResolve({
      controller,
      cache: original,
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    if (!started.started) throw new Error("expected start");

    const rolled = completeOptimisticResolveFailure({
      controller,
      cache: started.cache,
      ticketId: open.id,
    });
    const counts = inboxCountsForCache(
      rolled.cache.tickets,
      STAFF_ID,
      STAFF_NAME,
      rolled.cache.pendingReplyIds,
    );
    const active = ticketsInInboxView(
      rolled.cache.tickets,
      "all-active",
      STAFF_ID,
      STAFF_NAME,
      rolled.cache.pendingReplyIds,
    );

    expect(rolled.cache.tickets.find((item) => item.id === open.id)?.status).toBe(
      "Open",
    );
    expect(rolled.cache.selectedId).toBe(open.id);
    expect(active.map((item) => item.id).sort()).toEqual(["ticket-1", "ticket-2"]);
    expect(counts["all-active"]).toBe(2);
    expect(counts.resolved).toBe(0);
    expect(rolled.failure?.message).toBe(RESOLVE_FAILURE_MESSAGE);
    expect(resolveActionA11y({ status: "Open", pending: false, failed: true }).disabled).toBe(
      false,
    );
  });

  it("allows retry after a failed mutation", () => {
    const open = ticket();
    const controller = createOptimisticResolveController();
    const started = beginOptimisticResolve({
      controller,
      cache: cache([open]),
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    if (!started.started) throw new Error("expected start");
    const rolled = completeOptimisticResolveFailure({
      controller,
      cache: started.cache,
      ticketId: open.id,
    });
    const retry = beginOptimisticResolve({
      controller,
      cache: rolled.cache,
      ticket: rolled.cache.tickets[0] as Ticket,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:01:00.000Z",
    });
    expect(retry.started).toBe(true);
    if (retry.started) expect(retry.cache.tickets[0]?.status).toBe("Resolved");
  });

  it("ignores a second Resolve click while the first mutation is pending", () => {
    const open = ticket();
    const controller = createOptimisticResolveController();
    const first = beginOptimisticResolve({
      controller,
      cache: cache([open]),
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    const second = beginOptimisticResolve({
      controller,
      cache: first.started ? first.cache : cache([open]),
      ticket: first.started ? first.optimisticTicket : open,
      resolutionSummary: "Done again",
      resolvedAtIso: "2026-08-27T12:00:01.000Z",
    });
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(controller.inFlight.size).toBe(1);
  });

  it("does not require a full-page refresh to update queue, badge, or counters", () => {
    const open = ticket();
    const started = beginOptimisticResolve({
      controller: createOptimisticResolveController(),
      cache: cache([open]),
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    if (!started.started) throw new Error("expected start");
    expect(started.cache.tickets[0]?.status).toBe("Resolved");
    expect(inboxCountsForCache(started.cache.tickets, STAFF_ID, STAFF_NAME).resolved).toBe(1);
    expect(RESOLVE_SUCCESS_NOTICE).toBe("Ticket marked as resolved");
  });

  it("keeps assignment and other active tickets unchanged", () => {
    const open = ticket({ assignedExecutive: "Rahul Mehta", assignedExecutiveId: "staff-2" });
    const waiting = ticket({
      id: "ticket-2",
      ticketNumber: "CF-2",
      status: "Waiting",
      assignedExecutive: STAFF_NAME,
      assignedExecutiveId: STAFF_ID,
    });
    const started = beginOptimisticResolve({
      controller: createOptimisticResolveController(),
      cache: cache([open, waiting]),
      ticket: open,
      resolutionSummary: "Done",
      resolvedAtIso: "2026-08-27T12:00:00.000Z",
    });
    if (!started.started) throw new Error("expected start");
    const stillWaiting = started.cache.tickets.find((item) => item.id === "ticket-2");
    expect(stillWaiting?.status).toBe("Waiting");
    expect(stillWaiting?.assignedExecutiveId).toBe(STAFF_ID);
    expect(started.cache.tickets[0]?.assignedExecutiveId).toBe("staff-2");
  });

  it("communicates pending and resolved accessibility state", () => {
    const resolved = resolveActionA11y({
      status: "Resolved",
      pending: false,
      failed: false,
    });
    expect(resolved.label).toBe("Resolved");
    expect(resolved.disabled).toBe(true);
    expect(resolved.ariaLive).toBe("polite");
    expect(resolved.statusMessage).toBe(RESOLVE_SUCCESS_NOTICE);

    const pending = resolveActionA11y({
      status: "Open",
      pending: true,
      failed: false,
    });
    expect(pending.ariaBusy).toBe(true);
    expect(pending.ariaDisabled).toBe(true);
  });

  it("uses a stable idempotency key per ticket", () => {
    expect(resolveTicketIdempotencyKey("ticket-1")).toBe("ticket-resolution:ticket-1");
  });

  it("shows a pending notice until the authoritative commit succeeds", () => {
    const pending = resolveActionA11y({
      status: "Resolved",
      pending: true,
      failed: false,
    });
    expect(pending.statusMessage).toBe(RESOLVE_PENDING_NOTICE);
    expect(pending.statusMessage).not.toBe(RESOLVE_SUCCESS_NOTICE);
  });

  it("keeps an explicit checking state when verification is unknown", () => {
    const checking = resolveActionA11y({
      status: "Resolved",
      pending: false,
      checking: true,
      failed: false,
    });
    expect(checking.statusMessage).toBe(RESOLVE_CHECKING_NOTICE);
    expect(checking.disabled).toBe(true);
    expect(checking.label).toBe("Checking...");
  });

  it("classifies authorization failures as definite and timeouts as ambiguous", () => {
    expect(
      classifyResolveActionResult({
        error: "Your account is not authorized for Creator Support.",
      }).kind,
    ).toBe("definite_failure");
    expect(classifyResolveActionResult(undefined).kind).toBe("ambiguous");
    expect(
      classifyResolveActionResult({
        data: ticket({ status: "Resolved" }),
      }).kind,
    ).toBe("success");
  });

  it("refetches canonical status after an ambiguous failure instead of rolling back immediately", () => {
    expect(
      classifyCanonicalVerification(ticket({ status: "Resolved" }), false).kind,
    ).toBe("success");
    expect(
      classifyCanonicalVerification(ticket({ status: "Open" }), false).kind,
    ).toBe("rollback");
    expect(classifyCanonicalVerification(null, true).kind).toBe("checking");
  });

  it("does not reopen an optimistic Resolved ticket from stale refetch data", () => {
    const optimistic = ticket({
      status: "Resolved",
      updatedAt: "2026-08-27T12:00:10.000Z",
    });
    const stale = ticket({
      status: "Open",
      updatedAt: "2026-08-27T12:00:00.000Z",
    });
    expect(
      shouldApplyCanonicalTicket(optimistic, stale, { allowReopen: false }),
    ).toBe(false);
    const merged = mergeCanonicalTicket([optimistic], stale, { allowReopen: false });
    expect(merged[0]?.status).toBe("Resolved");
  });

  it("applies optimistic resolve onto an existing cache snapshot", () => {
    const open = ticket();
    const next = applyOptimisticResolve(
      cache([open]),
      open,
      "Done",
      "2026-08-27T12:00:00.000Z",
    );
    expect(next.tickets[0]?.status).toBe("Resolved");
    expect(next.tickets[0]?.resolutionSummary).toBe("Done");
  });
});
