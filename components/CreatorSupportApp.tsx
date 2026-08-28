"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import AIAgentStudio from "@/components/ai/AIAgentStudio";
import CampaignsView from "@/components/campaigns/CampaignsView";
import CommandCentre from "@/components/command/CommandCentre";
import CreatorsView from "@/components/creators/CreatorsView";
import TicketQueue from "@/components/inbox/TicketQueue";
import NewTicketModal from "@/components/NewTicketModal";
import {
  AnalyticsView,
  AutomationsView,
  ChannelsView,
  ResolutionBaseView,
  SettingsView,
} from "@/components/SecondaryViews";
import NavigationRail from "@/components/shell/NavigationRail";
import TopCommandBar from "@/components/shell/TopCommandBar";
import TeamManagement from "@/components/team/TeamManagement";
import TicketWorkspace from "@/components/ticket/TicketWorkspace";
import ResizeHandle, { clampSize } from "@/components/ui/ResizeHandle";
import type { StaffProfile } from "@/lib/auth";
import { createTicketAction } from "@/lib/tickets/actions";
import { fetchTicketById, fetchTickets } from "@/lib/tickets/api";
import { getEmailChannelStatusAction } from "@/lib/tickets/email-actions";
import {
  fetchPendingReplyTicketIds,
  fetchStaffDirectory,
} from "@/lib/tickets/ops-api";
import { fetchActiveStaffOptions } from "@/lib/tickets/workflow-api";
import type { StaffOption } from "@/lib/tickets/workflow-types";
import { resolveTicketAction } from "@/lib/tickets/workflow-actions";
import {
  RESOLVE_FAILURE_MESSAGE,
  RESOLVE_SUCCESS_NOTICE,
  beginOptimisticResolve,
  classifyCanonicalVerification,
  classifyResolveActionResult,
  completeOptimisticResolveFailure,
  completeOptimisticResolveSuccess,
  createOptimisticResolveController,
  mergeCanonicalTicket,
  resolveTicketIdempotencyKey,
  shouldApplyCanonicalTicket,
  type ResolveFailureState,
  type TicketsCacheSnapshot,
} from "@/lib/tickets/resolve-cache";
import type {
  InboxView,
  NavItem,
  NewTicketFormData,
  StaffDirectoryMember,
  Ticket,
} from "@/lib/types";
import {
  countTicketsForView,
  ticketMatchesInboxView,
  ticketMatchesSearch,
} from "@/lib/utils";

interface CreatorSupportAppProps {
  staffProfile: StaffProfile;
  initialTickets: Ticket[];
  initialLoadError: string | null;
}

const INBOX_VIEWS: InboxView[] = [
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

function navToInboxView(nav: NavItem): InboxView | null {
  switch (nav) {
    case "inbox":
      return "all-active";
    case "resolved":
      return "resolved";
    default:
      return null;
  }
}

function inboxTitle(view: InboxView): string {
  switch (view) {
    case "my-tickets":
      return "My Tickets";
    case "unassigned":
      return "Unassigned";
    case "open":
      return "Open";
    case "in-progress":
      return "In Progress";
    case "waiting":
      return "Waiting";
    case "urgent":
      return "Urgent";
    case "pending-reply":
      return "Pending Reply";
    case "resolved":
      return "Resolved";
    default:
      return "Unified Inbox";
  }
}

export default function CreatorSupportApp({
  staffProfile,
  initialTickets,
  initialLoadError,
}: CreatorSupportAppProps) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [activeNav, setActiveNav] = useState<NavItem>("command-centre");
  const [inboxView, setInboxView] = useState<InboxView>("all-active");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTickets[0]?.id ?? null,
  );
  const [globalSearch, setGlobalSearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [queueWidth, setQueueWidth] = useState(360);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [emailAcknowledgements, setEmailAcknowledgements] = useState(true);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [pendingReplyIds, setPendingReplyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [resolveFailure, setResolveFailure] =
    useState<ResolveFailureState | null>(null);
  const [pendingResolveIds, setPendingResolveIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [checkingTicketIds, setCheckingTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const resolveControllerRef = useRef(createOptimisticResolveController());
  const resolveRetryRef = useRef<{
    ticket: Ticket;
    summary: string;
  } | null>(null);
  const ticketsRef = useRef(tickets);
  const selectedIdRef = useRef(selectedId);
  const pendingReplyIdsRef = useRef(pendingReplyIds);
  const checkingTicketIdsRef = useRef(checkingTicketIds);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryMember[]>(
    [],
  );
  const [staffDirectoryError, setStaffDirectoryError] = useState<string | null>(
    null,
  );
  const [staffDirectoryLoading, setStaffDirectoryLoading] = useState(true);
  const [emailConnected, setEmailConnected] = useState(false);
  const [emailFromDisplay, setEmailFromDisplay] = useState<string | null>(null);

  const staffName = staffProfile.full_name?.trim() ?? "";
  const staffUserId = staffProfile.user_id;

  useEffect(() => {
    ticketsRef.current = tickets;
    selectedIdRef.current = selectedId;
    pendingReplyIdsRef.current = pendingReplyIds;
    checkingTicketIdsRef.current = checkingTicketIds;
  }, [tickets, selectedId, pendingReplyIds, checkingTicketIds]);

  const refreshPendingReplies = useCallback(async () => {
    const result = await fetchPendingReplyTicketIds();
    if ("error" in result) return;
    setPendingReplyIds(() => {
      const next = new Set(result.ticketIds);
      for (const id of resolveControllerRef.current.inFlight) {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const refreshStaffDirectory = useCallback(async () => {
    setStaffDirectoryLoading(true);
    const result = await fetchStaffDirectory();
    setStaffDirectoryLoading(false);
    if ("error" in result) {
      setStaffDirectoryError(result.error);
      return;
    }
    setStaffDirectoryError(null);
    setStaffDirectory(result.data);
  }, []);

  const refreshStaffOptions = useCallback(async () => {
    const result = await fetchActiveStaffOptions();
    if ("data" in result) setStaffOptions(result.data);
  }, []);

  const handleStaffChanged = useCallback(() => {
    void refreshStaffDirectory();
    void refreshStaffOptions();
  }, [refreshStaffDirectory, refreshStaffOptions]);

  useEffect(() => {
    let cancelled = false;

    void fetchActiveStaffOptions().then((result) => {
      if (cancelled) return;
      if ("data" in result) setStaffOptions(result.data);
    });

    void fetchPendingReplyTicketIds().then((result) => {
      if (cancelled) return;
      if ("ticketIds" in result) {
        setPendingReplyIds(new Set(result.ticketIds));
      }
    });

    void fetchStaffDirectory().then((result) => {
      if (cancelled) return;
      setStaffDirectoryLoading(false);
      if ("error" in result) {
        setStaffDirectoryError(result.error);
        return;
      }
      setStaffDirectoryError(null);
      setStaffDirectory(result.data);
    });

    void getEmailChannelStatusAction().then((status) => {
      if (cancelled) return;
      setEmailConnected(status.configured);
      setEmailFromDisplay(status.fromDisplay);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function refreshTickets() {
    startRefreshTransition(async () => {
      const result = await fetchTickets();
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }

      setLoadError(null);
      setTickets((prev) =>
        result.tickets.map((incoming) => {
          const current = prev.find((ticket) => ticket.id === incoming.id);
          if (!current) return incoming;
          const guarded =
            resolveControllerRef.current.inFlight.has(incoming.id) ||
            checkingTicketIdsRef.current.has(incoming.id);
          if (
            guarded &&
            !shouldApplyCanonicalTicket(current, incoming, { allowReopen: false })
          ) {
            return current;
          }
          return incoming;
        }),
      );
      setSelectedId((current) => {
        if (current && result.tickets.some((ticket) => ticket.id === current)) {
          return current;
        }
        return result.tickets[0]?.id ?? null;
      });
      await refreshPendingReplies();
    });
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    window.setTimeout(() => {
      setSuccessMessage((current) => (current === message ? null : current));
    }, 3200);
  }

  function handleTicketUpdated(updated: Ticket) {
    setTickets((prev) => {
      const guarded =
        resolveControllerRef.current.inFlight.has(updated.id) ||
        checkingTicketIdsRef.current.has(updated.id);
      return mergeCanonicalTicket(prev, updated, { allowReopen: !guarded });
    });
  }

  const currentCache = useCallback((): TicketsCacheSnapshot => {
    return {
      tickets,
      selectedId,
      pendingReplyIds,
    };
  }, [tickets, selectedId, pendingReplyIds]);

  const applyCache = useCallback((cache: TicketsCacheSnapshot) => {
    setTickets(cache.tickets);
    setSelectedId(cache.selectedId);
    setPendingReplyIds(cache.pendingReplyIds);
  }, []);

  function handleResolveTicket(ticket: Ticket, resolutionSummary: string) {
    const started = beginOptimisticResolve({
      controller: resolveControllerRef.current,
      cache: currentCache(),
      ticket,
      resolutionSummary,
      resolvedAtIso: new Date().toISOString(),
    });
    if (!started.started) return;

    resolveRetryRef.current = { ticket, summary: resolutionSummary };
    applyCache(started.cache);
    ticketsRef.current = started.cache.tickets;
    selectedIdRef.current = started.cache.selectedId;
    pendingReplyIdsRef.current = started.cache.pendingReplyIds;
    setMobileDetailOpen(true);
    setResolveFailure(null);
    setCheckingTicketIds((prev) => {
      const next = new Set(prev);
      next.delete(ticket.id);
      return next;
    });
    setPendingResolveIds((prev) => {
      const next = new Set(prev);
      next.add(ticket.id);
      return next;
    });

    const finishPending = () => {
      setPendingResolveIds((prev) => {
        const next = new Set(prev);
        next.delete(ticket.id);
        return next;
      });
    };

    const applySuccess = (canonical: Ticket) => {
      finishPending();
      setCheckingTicketIds((prev) => {
        const next = new Set(prev);
        next.delete(ticket.id);
        return next;
      });
      const reconciled = completeOptimisticResolveSuccess({
        controller: resolveControllerRef.current,
        cache: {
          tickets: ticketsRef.current,
          selectedId: selectedIdRef.current,
          pendingReplyIds: pendingReplyIdsRef.current,
        },
        canonical,
      });
      applyCache(reconciled);
      ticketsRef.current = reconciled.tickets;
      selectedIdRef.current = reconciled.selectedId;
      pendingReplyIdsRef.current = reconciled.pendingReplyIds;
      setResolveFailure(null);
      showSuccess(RESOLVE_SUCCESS_NOTICE);
      void fetchTicketById(ticket.id).then((fresh) => {
        if ("ticket" in fresh) {
          setTickets((prev) =>
            mergeCanonicalTicket(prev, fresh.ticket, { allowReopen: false }),
          );
        }
      });
    };

    const applyDefiniteFailure = () => {
      finishPending();
      setCheckingTicketIds((prev) => {
        const next = new Set(prev);
        next.delete(ticket.id);
        return next;
      });
      const rolled = completeOptimisticResolveFailure({
        controller: resolveControllerRef.current,
        cache: {
          tickets: ticketsRef.current,
          selectedId: selectedIdRef.current,
          pendingReplyIds: pendingReplyIdsRef.current,
        },
        ticketId: ticket.id,
      });
      applyCache(rolled.cache);
      ticketsRef.current = rolled.cache.tickets;
      selectedIdRef.current = rolled.cache.selectedId;
      pendingReplyIdsRef.current = rolled.cache.pendingReplyIds;
      setResolveFailure({
        ticketId: ticket.id,
        resolutionSummary,
        message: RESOLVE_FAILURE_MESSAGE,
      });
    };

    const verifyAfterAmbiguous = async () => {
      finishPending();
      setCheckingTicketIds((prev) => {
        const next = new Set(prev);
        next.add(ticket.id);
        return next;
      });
      const fresh = await fetchTicketById(ticket.id);
      const verification = classifyCanonicalVerification(
        "ticket" in fresh ? fresh.ticket : null,
        "error" in fresh,
      );
      if (verification.kind === "success") {
        applySuccess(verification.ticket);
        return;
      }
      if (verification.kind === "rollback") {
        applyDefiniteFailure();
        return;
      }
    };

    void resolveTicketAction({
      ticketId: ticket.id,
      resolutionSummary,
      idempotencyKey: resolveTicketIdempotencyKey(ticket.id),
    })
      .then((result) => {
        const classified = classifyResolveActionResult(result);
        if (classified.kind === "success") {
          applySuccess(classified.ticket);
          return;
        }
        if (classified.kind === "definite_failure") {
          applyDefiniteFailure();
          return;
        }
        return verifyAfterAmbiguous();
      })
      .catch(() => verifyAfterAmbiguous());
  }

  function handleRetryResolve() {
    const pending = resolveRetryRef.current;
    const failure = resolveFailure;
    if (!pending && !failure) return;
    const ticket =
      tickets.find((item) => item.id === (failure?.ticketId ?? pending?.ticket.id)) ??
      pending?.ticket;
    const summary = failure?.resolutionSummary || pending?.summary;
    if (!ticket || !summary) return;
    handleResolveTicket(ticket, summary);
  }

  const viewCounts = useMemo(() => {
    return Object.fromEntries(
      INBOX_VIEWS.map((view) => [
        view,
        countTicketsForView(
          tickets,
          view,
          staffUserId,
          staffName,
          pendingReplyIds,
        ),
      ]),
    ) as Record<InboxView, number>;
  }, [tickets, staffUserId, staffName, pendingReplyIds]);

  const filteredTickets = useMemo(() => {
    const globalQuery = globalSearch.trim().toLowerCase();
    const localQuery = queueSearch.trim().toLowerCase();

    return tickets
      .filter((ticket) =>
        ticketMatchesInboxView(
          ticket,
          inboxView,
          staffUserId,
          staffName,
          pendingReplyIds,
        ),
      )
      .filter((ticket) => ticketMatchesSearch(ticket, globalQuery))
      .filter((ticket) => ticketMatchesSearch(ticket, localQuery))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [
    tickets,
    inboxView,
    globalSearch,
    queueSearch,
    staffName,
    staffUserId,
    pendingReplyIds,
  ]);

  // Selection is only valid when the ticket is still in the current filtered view.
  // Otherwise fall back to the first visible ticket, or null for an empty queue.
  const visibleSelectedId = useMemo(() => {
    if (
      selectedId &&
      filteredTickets.some((ticket) => ticket.id === selectedId)
    ) {
      return selectedId;
    }
    return filteredTickets[0]?.id ?? null;
  }, [filteredTickets, selectedId]);

  const selectedTicket = useMemo(() => {
    if (!visibleSelectedId) return null;
    return (
      filteredTickets.find((ticket) => ticket.id === visibleSelectedId) ?? null
    );
  }, [filteredTickets, visibleSelectedId]);

  function handleNavigate(item: NavItem) {
    setActiveNav(item);
    setMobileDetailOpen(false);
    const view = navToInboxView(item);
    if (view) {
      setInboxView(view);
      setQueueSearch("");
    }
  }

  function handleInboxViewChange(view: InboxView) {
    setInboxView(view);
    setActiveNav(view === "resolved" ? "resolved" : "inbox");
  }

  function openInboxView(view: InboxView) {
    setActiveNav(view === "resolved" ? "resolved" : "inbox");
    setInboxView(view);
    setQueueSearch("");
    setMobileDetailOpen(false);
  }

  function handleSelectTicket(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
    if (navToInboxView(activeNav) === null && activeNav !== "inbox") {
      setActiveNav("inbox");
      setInboxView("all-active");
    }
  }

  function openTicketFromModule(id: string) {
    setSelectedId(id);
    setActiveNav("inbox");
    setInboxView("all-active");
    setMobileDetailOpen(true);
  }

  async function handleCreateTicket(
    data: NewTicketFormData,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const selectedStaff = staffOptions.find(
      (option) => option.userId === data.assignedExecutive,
    );

    if (!selectedStaff) {
      return {
        ok: false,
        message: "Select an active assigned executive.",
      };
    }

    const result = await createTicketAction({
      form: {
        ...data,
        assignedExecutive: selectedStaff.fullName,
      },
      assignedTeam:
        selectedStaff.team || staffProfile.team || "Creator Support",
      assignedExecutiveId: selectedStaff.userId,
    });

    if ("error" in result) {
      return { ok: false, message: result.error };
    }

    setTickets((prev) => [result.ticket, ...prev]);
    setSelectedId(result.ticket.id);
    setActiveNav("inbox");
    setInboxView("all-active");
    setGlobalSearch("");
    setQueueSearch("");
    setLoadError(null);
    setModalOpen(false);
    setMobileDetailOpen(true);

    if (result.acknowledgement === "sent") {
      showSuccess("Ticket created and acknowledgement email sent.");
    } else if (result.acknowledgement === "failed") {
      showSuccess(
        result.acknowledgementMessage ||
          "Ticket created, but the acknowledgement email could not be sent.",
      );
    } else {
      showSuccess(`Ticket ${result.ticket.ticketNumber} created successfully.`);
    }
    return { ok: true };
  }

  const showTicketWorkspace = navToInboxView(activeNav) !== null;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <NavigationRail
        activeNav={activeNav}
        onNavigate={handleNavigate}
        staffProfile={staffProfile}
        collapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed((prev) => !prev)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopCommandBar
          search={globalSearch}
          onSearchChange={setGlobalSearch}
          onNewTicket={() => setModalOpen(true)}
          onOpenMenu={() => setMobileSidebarOpen(true)}
          staffProfile={staffProfile}
          showMenuButton
          emailConnected={emailConnected}
        />

        <main className="min-h-0 flex-1">
          {activeNav === "command-centre" ? (
            <CommandCentre
              tickets={tickets}
              pendingReplyIds={pendingReplyIds}
              staffName={staffProfile.full_name || "Staff"}
              onOpenInbox={() => handleNavigate("inbox")}
              onOpenTicket={openTicketFromModule}
              onOpenInboxView={openInboxView}
            />
          ) : null}

          {showTicketWorkspace ? (
            <div className="flex h-full min-h-0">
              <div
                className={`min-h-0 shrink-0 ${
                  mobileDetailOpen
                    ? "hidden lg:block lg:w-[var(--queue-width)]"
                    : "block w-full lg:w-[var(--queue-width)]"
                }`}
                style={
                  {
                    "--queue-width": `${queueWidth}px`,
                  } as CSSProperties
                }
              >
                <TicketQueue
                  title={inboxTitle(inboxView)}
                  tickets={filteredTickets}
                  viewCounts={viewCounts}
                  activeView={inboxView}
                  selectedId={visibleSelectedId}
                  localSearch={queueSearch}
                  onLocalSearchChange={setQueueSearch}
                  onViewChange={handleInboxViewChange}
                  onSelectTicket={handleSelectTicket}
                  onNewTicket={() => setModalOpen(true)}
                  onRefresh={refreshTickets}
                  loading={isRefreshing && tickets.length === 0}
                  refreshing={isRefreshing}
                  error={loadError}
                  hasTickets={tickets.length > 0}
                  pendingReplyIds={pendingReplyIds}
                />
              </div>
              <ResizeHandle
                orientation="vertical"
                label="Resize inbox column"
                className="hidden lg:block"
                onResize={(delta) => {
                  setQueueWidth((prev) => clampSize(prev + delta, 280, 560));
                }}
              />
              <div
                className={`min-h-0 min-w-0 flex-1 ${mobileDetailOpen ? "block" : "hidden lg:block"}`}
              >
                <TicketWorkspace
                  ticket={selectedTicket}
                  staffOptions={staffOptions}
                  onTicketUpdated={handleTicketUpdated}
                  onResolveTicket={handleResolveTicket}
                  resolvePending={
                    selectedTicket
                      ? pendingResolveIds.has(selectedTicket.id)
                      : false
                  }
                  resolveChecking={
                    selectedTicket
                      ? checkingTicketIds.has(selectedTicket.id)
                      : false
                  }
                  resolveError={
                    selectedTicket &&
                    resolveFailure?.ticketId === selectedTicket.id
                      ? resolveFailure.message
                      : null
                  }
                  onRetryResolve={handleRetryResolve}
                  onConversationMutated={() => {
                    void refreshPendingReplies();
                  }}
                  showClose
                  onClose={() => setMobileDetailOpen(false)}
                  pendingReplyIds={pendingReplyIds}
                />
              </div>
            </div>
          ) : null}

          {activeNav === "creators" ? (
            <CreatorsView
              tickets={tickets}
              onOpenTicket={openTicketFromModule}
              onOpenInbox={() => handleNavigate("inbox")}
            />
          ) : null}

          {activeNav === "campaigns" ? (
            <CampaignsView
              tickets={tickets}
              onOpenTicket={openTicketFromModule}
              onOpenInbox={() => handleNavigate("inbox")}
            />
          ) : null}

          {activeNav === "analytics" ? (
            <AnalyticsView
              tickets={tickets}
              pendingReplyCount={pendingReplyIds.size}
              onOpenInbox={() => handleNavigate("inbox")}
            />
          ) : null}

          {activeNav === "resolution-base" ? (
            <ResolutionBaseView onOpenInbox={() => handleNavigate("inbox")} />
          ) : null}

          {activeNav === "automations" ? (
            <AutomationsView onOpenInbox={() => handleNavigate("inbox")} />
          ) : null}

          {activeNav === "ai-agent" ? (
            <AIAgentStudio onOpenInbox={() => handleNavigate("inbox")} />
          ) : null}

          {activeNav === "channels" ? (
            <ChannelsView
              onOpenInbox={() => handleNavigate("inbox")}
              emailConnected={emailConnected}
              emailFromDisplay={emailFromDisplay}
            />
          ) : null}

          {activeNav === "team" ? (
            <TeamManagement
              staff={staffDirectory}
              tickets={tickets}
              loading={staffDirectoryLoading}
              error={staffDirectoryError}
              onRetry={() => {
                void refreshStaffDirectory();
              }}
              onStaffChanged={handleStaffChanged}
              onOpenInbox={() => handleNavigate("inbox")}
              currentRole={staffProfile.role}
              currentUserId={staffProfile.user_id}
            />
          ) : null}

          {activeNav === "settings" ? (
            <SettingsView
              emailAcknowledgements={emailAcknowledgements}
              onToggleEmailAcknowledgements={() =>
                setEmailAcknowledgements((prev) => !prev)
              }
              onOpenInbox={() => handleNavigate("inbox")}
              staffName={staffProfile.full_name || "Staff"}
              staffTeam={staffProfile.team}
            />
          ) : null}
        </main>
      </div>

      <NewTicketModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreateTicket}
        defaultSendAcknowledgementEmail={emailAcknowledgements}
        staffOptions={staffOptions}
      />

      {successMessage ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-[60] max-w-sm rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-[var(--shadow-md)]"
        >
          <p className="font-medium text-accent">Success</p>
          <p className="mt-0.5 text-muted">{successMessage}</p>
        </div>
      ) : null}

      {resolveFailure ? (
        <div
          role="alert"
          className="fixed right-4 bottom-20 z-[60] max-w-sm rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-[var(--shadow-md)]"
        >
          <p className="font-medium text-[var(--danger)]">Could not resolve</p>
          <p className="mt-0.5 text-muted">{resolveFailure.message}</p>
          <button
            type="button"
            onClick={handleRetryResolve}
            className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
