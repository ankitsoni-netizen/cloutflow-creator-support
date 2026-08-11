"use client";

import { useEffect, useMemo, useState } from "react";
import NewTicketModal from "@/components/NewTicketModal";
import {
  AnalyticsView,
  ResolutionBaseView,
  SettingsView,
} from "@/components/SecondaryViews";
import Sidebar from "@/components/Sidebar";
import TicketDetail from "@/components/TicketDetail";
import TicketList from "@/components/TicketList";
import { CURRENT_USER, SAMPLE_TICKETS } from "@/lib/sample-data";
import type {
  NavItem,
  NewTicketFormData,
  StatusFilter,
  Ticket,
} from "@/lib/types";
import { matchesStatusFilter, nextTicketNumber } from "@/lib/utils";

export default function CreatorSupportApp() {
  const [tickets, setTickets] = useState<Ticket[]>(SAMPLE_TICKETS);
  const [activeNav, setActiveNav] = useState<NavItem>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(
    SAMPLE_TICKETS[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [emailAcknowledgements, setEmailAcknowledgements] = useState(true);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tickets
      .filter((ticket) => {
        if (activeNav === "my-tickets") {
          return ticket.assignedExecutive === CURRENT_USER;
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
  }, [tickets, activeNav, search, statusFilter]);

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

  function handleCreateTicket(data: NewTicketFormData) {
    const now = new Date().toISOString();
    const ticketNumber = nextTicketNumber(tickets);
    const newTicket: Ticket = {
      id: ticketNumber,
      ticketNumber,
      creatorName: data.creatorName.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      socialHandle: data.socialHandle.trim(),
      platform: data.platform,
      issueType: data.issueType,
      issueCategory: data.issueType,
      campaignName: data.campaignName.trim(),
      brand: data.brand.trim(),
      campaignMonth: data.campaignMonth.trim(),
      cloutflowPoc: data.cloutflowPoc.trim(),
      cloutflowPocContactNumber: data.cloutflowPocContactNumber.trim(),
      issueDescription: data.issueDescription.trim(),
      internalCallNotes: data.internalCallNotes.trim() || undefined,
      sourceChannel: "Phone Call",
      status: "Open",
      priority: "Normal",
      assignedTeam: "Creator Support",
      assignedExecutive: data.assignedExecutive,
      createdAt: now,
      updatedAt: now,
      sendAcknowledgementEmail: data.sendAcknowledgementEmail,
      activity: [
        {
          id: `${ticketNumber}-a1`,
          timestamp: now,
          actor: CURRENT_USER,
          action: "Ticket created via phone call intake.",
        },
        ...(data.sendAcknowledgementEmail
          ? [
              {
                id: `${ticketNumber}-a2`,
                timestamp: now,
                actor: "System",
                action: "Acknowledgement email queued for the creator.",
              },
            ]
          : []),
      ],
    };

    setTickets((prev) => [newTicket, ...prev]);
    setSelectedId(newTicket.id);
    setActiveNav("inbox");
    setStatusFilter("All");
    setSearch("");
    setModalOpen(false);
    setMobileDetailOpen(true);
    setSuccessMessage(`Ticket ${ticketNumber} created successfully.`);
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
