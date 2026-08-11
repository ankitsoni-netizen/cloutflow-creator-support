"use client";

import {
  BellIcon,
  CommandIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from "@/components/ui/Icons";
import type { StaffProfile } from "@/lib/auth";
import { getInitials } from "@/lib/utils";

interface TopCommandBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onNewTicket: () => void;
  onOpenMenu?: () => void;
  staffProfile: StaffProfile;
  showMenuButton?: boolean;
  emailConnected?: boolean;
}

export default function TopCommandBar({
  search,
  onSearchChange,
  onNewTicket,
  onOpenMenu,
  staffProfile,
  showMenuButton = false,
  emailConnected = false,
}: TopCommandBarProps) {
  const initials = getInitials(staffProfile.full_name || "Staff");

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
      {showMenuButton && onOpenMenu ? (
        <button
          type="button"
          onClick={onOpenMenu}
          className="inline-flex items-center rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-foreground lg:hidden"
          aria-label="Open navigation"
        >
          Menu
        </button>
      ) : null}

      <div className="hidden min-w-0 lg:block">
        <p className="truncate text-sm font-semibold text-foreground">
          Cloutflow Creator Support
        </p>
        <p className="truncate text-[11px] text-muted">
          Creator Operations Resolution System
        </p>
      </div>

      <div className="mx-auto flex min-w-0 max-w-2xl flex-1 items-center justify-center gap-2">
        <label className="relative w-full">
          <span className="sr-only">
            Search tickets by number, creator, phone, email, handle, campaign,
            brand or POC
          </span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search ticket, creator, phone, email, handle, campaign, brand, POC..."
            className="w-full rounded-md border border-border bg-surface-muted py-2 pr-3 pl-9 text-sm text-foreground outline-none transition focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled
          title="Command menu coming soon"
          aria-label="Command menu (coming soon)"
          className="hidden items-center gap-1 rounded-md border border-border px-2 py-2 text-xs text-muted md:inline-flex"
        >
          <CommandIcon className="h-3.5 w-3.5" />
          <span className="tabular-nums">⌘K</span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div
          className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-xs text-muted xl:inline-flex"
          title={
            emailConnected
              ? "Email connected. WhatsApp, Instagram, and website chatbot remain offline."
              : "Channel integrations are not connected"
          }
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              emailConnected ? "bg-[var(--success)]" : "bg-[var(--warning)]"
            }`}
            aria-hidden="true"
          />
          {emailConnected
            ? "Email connected · 3 channels offline"
            : "Channels offline"}
        </div>

        <div
          className="hidden items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--ai-ready)_30%,transparent)] bg-[var(--ai-ready-soft)] px-2.5 py-1.5 text-xs text-[var(--ai-ready)] xl:inline-flex"
          title="Cloutflow Copilot is not connected to an AI backend"
        >
          <SparklesIcon className="h-3.5 w-3.5" />
          AI setup required
        </div>

        <button
          type="button"
          disabled
          aria-label="Notifications (coming soon)"
          title="Notifications coming soon"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted"
        >
          <BellIcon className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onNewTicket}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <PlusIcon className="h-4 w-4" />
          <span className="hidden sm:inline">New Ticket</span>
          <span className="sm:hidden">New</span>
        </button>

        <div
          className="hidden items-center gap-2 rounded-md border border-border px-2 py-1.5 md:flex"
          title={staffProfile.full_name || "Staff"}
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
            {initials}
          </span>
          <span className="max-w-[120px] truncate text-xs font-medium text-foreground">
            {staffProfile.full_name || "Staff"}
          </span>
        </div>
      </div>
    </header>
  );
}
