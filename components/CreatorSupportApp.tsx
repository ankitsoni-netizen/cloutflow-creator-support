"use client";

import { useMemo, useState, useTransition } from "react";
import NewTicketModal from "@/components/NewTicketModal";
import {
  AnalyticsView,
  ResolutionBaseView,
  SettingsView,
} from "@/components/SecondaryViews";
import Sidebar from "@/components/Sidebar";
import TicketDetail from "@/components/TicketDetail";
import TicketList from "@/components/TicketList";
import type { StaffProfile } from "@/lib/auth";
import { createTicketAction } from "@/lib/tickets/actions";
import { fetchTickets, resolveAssignedExecutiveId } from "@/lib/tickets/api";
import type {
  NavItem,
  NewTicketFormData,
  StatusFilter,
  Ticket,
} from "@/lib/types";
import { matchesStatusFilter } from "@/lib/utils";

interface CreatorSupportAppProps {
  staffProfile: StaffProfile;
  initialTickets: Ticket[];
  initialLoadError: string | null;
}

export default function CreatorSupportApp({
  staffProfile,
  initialTickets,
  initialLoadError,
}: CreatorSupportAppProps) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [activeNav, setActiveNav] = useState<NavItem>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTickets[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [emailAcknowledgements, setEmailAcknowledgements] = useState(true);

  function refreshTickets() {
    startRefreshTransition(async () => {
      const result = await fetchTickets();
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }

      setLoadError(null);
      setTickets(result.tickets);
      setSelectedId((current) => {
        if (current && result.tickets.some((ticket) => ticket.id === current)) {
          return current;
        }
        return result.tickets[0]?.id ?? null;
      });
    });
  }

  function showSuccess(message: string) {
    setSuccessMessage(message);
    window.setTimeout(() => {
      setSuccessMessage((current) => (current === message ? null : current));
    }, 3200);
  }

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const currentName = staffProfile.full_name?.trim() ?? "";

    return tickets
      .filter((ticket) => {
        if (activeNav === "my-tickets") {
          const matchesId =
            !!ticket.assignedExecutiveId &&
            ticket.assignedExecutiveId === staffProfile.user_id;
          const matchesName =
            !!currentName &&
            ticket.assignedExecutive.toLowerCase() ===
              currentName.toLowerCase();
          return matchesId || matchesName;
        }
        if (activeNav === "resolved") {
          return ticket.status === "Resolved";
        }
        return true;
      })
      .filter((ticket) => {
        if (activeNav === "resolved") return true;
        return matchesStatusFilter(ticket.status, statusFilter);
      })
      .filter((ticket) => {
        if (!query) return true;
        return [
          ticket.ticketNumber,
          ticket.creatorName,
          ticket.brand,
          ticket.issueCategory,
          ticket.issueType,
          ticket.sourceChannel,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [
    tickets,
    activeNav,
    search,
    statusFilter,
    staffProfile.full_name,
    staffProfile.user_id,
  ]);

  const selectedTicket =
    tickets.find((ticket) => ticket.id === selectedId) ?? null;

  function handleNavigate(item: NavItem) {
    setActiveNav(item);
    setMobileDetailOpen(false);

    if (item === "resolved") {
      setStatusFilter("Resolved");
    } else if (item === "inbox" || item === "my-tickets") {
      setStatusFilter("All");
    }
  }

  function handleSelectTicket(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
  }

  async function handleCreateTicket(
    data: NewTicketFormData,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const assignedExecutiveId = await resolveAssignedExecutiveId(
      data.assignedExecutive,
    );

    const result = await createTicketAction({
      form: data,
      assignedTeam: staffProfile.team || "Creator Support",
      assignedExecutiveId,
    });

    if ("error" in result) {
      return { ok: false, message: result.error };
    }

    setTickets((prev) => [result.ticket, ...prev]);
    setSelectedId(result.ticket.id);
    setActiveNav("inbox");
    setStatusFilter("All");
    setSearch("");
    setLoadError(null);
    setModalOpen(false);
    setMobileDetailOpen(true);
    showSuccess(`Ticket ${result.ticket.ticketNumber} created successfully.`);
    return { ok: true };
  }

  const showTicketWorkspace =
    activeNav === "inbox" ||
    activeNav === "my-tickets" ||
    activeNav === "resolved";

  const listTitle =
    activeNav === "my-tickets"
      ? "My Tickets"
      : activeNav === "resolved"
        ? "Resolved Tickets"
        : "Creator Support Inbox";

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        activeNav={activeNav}
        onNavigate={handleNavigate}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground"
          >
            Menu
          </button>
          <p className="text-sm font-semibold text-foreground">
            Creator Support
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            New
          </button>
        </header>

        <main className="min-h-0 flex-1">
          {showTicketWorkspace ? (
            <div className="grid h-full min-h-0 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
              <div
                className={`min-h-0 ${mobileDetailOpen ? "hidden lg:block" : "block"}`}
              >
                <TicketList
                  tickets={filteredTickets}
                  selectedId={selectedId}
                  search={search}
                  statusFilter={statusFilter}
                  onSearchChange={setSearch}
                  onStatusFilterChange={setStatusFilter}
                  onSelectTicket={handleSelectTicket}
                  onNewTicket={() => setModalOpen(true)}
                  title={listTitle}
                  loading={isRefreshing && tickets.length === 0}
                  error={loadError}
                  onRetry={refreshTickets}
                  hasTickets={tickets.length > 0}
                />
              </div>
              <div
                className={`min-h-0 ${mobileDetailOpen ? "block" : "hidden lg:block"}`}
              >
                <TicketDetail
                  ticket={selectedTicket}
                  showClose
                  onClose={() => setMobileDetailOpen(false)}
                />
              </div>
            </div>
          ) : null}

          {activeNav === "analytics" ? (
            <AnalyticsView
              tickets={tickets}
              onOpenInbox={() => handleNavigate("inbox")}
            />
          ) : null}

          {activeNav === "resolution-base" ? (
            <ResolutionBaseView onOpenInbox={() => handleNavigate("inbox")} />
          ) : null}

          {activeNav === "settings" ? (
            <SettingsView
              emailAcknowledgements={emailAcknowledgements}
              onToggleEmailAcknowledgements={() =>
                setEmailAcknowledgements((prev) => !prev)
              }
              onOpenInbox={() => handleNavigate("inbox")}
            />
          ) : null}
        </main>
      </div>

      <NewTicketModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreateTicket}
        defaultSendAcknowledgementEmail={emailAcknowledgements}
      />

      {successMessage ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-[60] max-w-sm rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-lg"
        >
          <p className="font-medium text-accent">Success</p>
          <p className="mt-0.5 text-muted">{successMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
