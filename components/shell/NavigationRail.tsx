"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type ComponentType, type SVGProps } from "react";
import {
  AiAgentIcon,
  AnalyticsIcon,
  AutomationsIcon,
  BookIcon,
  CampaignsIcon,
  ChannelsIcon,
  CollapseIcon,
  CreatorsIcon,
  ExpandIcon,
  HomeIcon,
  InboxIcon,
  LogoutIcon,
  ResolvedIcon,
  SettingsIcon,
  SlaIcon,
  TeamIcon,
  UnassignedIcon,
  UserIcon,
  WaitingIcon,
} from "@/components/ui/Icons";
import type { StaffProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import type { NavItem } from "@/lib/types";
import { getInitials } from "@/lib/utils";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>;

const NAV_SECTIONS: {
  label: string;
  items: { id: NavItem; label: string; Icon: IconComponent }[];
}[] = [
  {
    label: "Overview",
    items: [{ id: "command-centre", label: "Command Centre", Icon: HomeIcon }],
  },
  {
    label: "Workspace",
    items: [
      { id: "inbox", label: "Inbox", Icon: InboxIcon },
      { id: "my-tickets", label: "My Tickets", Icon: UserIcon },
      { id: "unassigned", label: "Unassigned", Icon: UnassignedIcon },
      { id: "waiting", label: "Waiting", Icon: WaitingIcon },
      { id: "sla-risk", label: "SLA Risk", Icon: SlaIcon },
      { id: "resolved", label: "Resolved", Icon: ResolvedIcon },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "creators", label: "Creators", Icon: CreatorsIcon },
      { id: "campaigns", label: "Campaigns", Icon: CampaignsIcon },
      { id: "resolution-base", label: "Resolution Base", Icon: BookIcon },
      { id: "analytics", label: "Analytics", Icon: AnalyticsIcon },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "automations", label: "Automations", Icon: AutomationsIcon },
      { id: "ai-agent", label: "AI Agent", Icon: AiAgentIcon },
      { id: "channels", label: "Channels", Icon: ChannelsIcon },
      { id: "team", label: "Team", Icon: TeamIcon },
      { id: "settings", label: "Settings", Icon: SettingsIcon },
    ],
  },
];

interface NavigationRailProps {
  activeNav: NavItem;
  onNavigate: (item: NavItem) => void;
  staffProfile: StaffProfile;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export default function NavigationRail({
  activeNav,
  onNavigate,
  staffProfile,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: NavigationRailProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const initials = getInitials(staffProfile.full_name || "Staff");

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function renderNavButton(item: {
    id: NavItem;
    label: string;
    Icon: IconComponent;
  }) {
    const active = activeNav === item.id;
    const Icon = item.Icon;

    return (
      <button
        key={item.id}
        type="button"
        title={collapsed ? item.label : undefined}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          onNavigate(item.id);
          onCloseMobile();
        }}
        className={`group relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors ${
          active
            ? "bg-sidebar-active text-white"
            : "text-sidebar-muted hover:bg-[var(--sidebar-hover)] hover:text-white"
        } ${collapsed ? "justify-center px-2" : ""}`}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r bg-[var(--brand-cyan)]"
          />
        ) : null}
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
        {collapsed ? (
          <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-white shadow-md group-hover:block">
            {item.label}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onCloseMobile}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-[var(--sidebar-border)] bg-sidebar text-sidebar-text transition-[width,transform] duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-[72px]" : "w-[240px]"}`}
      >
        <div
          className={`border-b border-[var(--sidebar-border)] ${
            collapsed ? "px-2 py-4" : "px-3 py-4"
          }`}
        >
          <div
            className={`relative ${collapsed ? "mx-auto h-9 w-9" : "h-9 w-full"}`}
          >
            <Image
              src="/cloutflow-logo.png"
              alt="Cloutflow"
              fill
              priority
              className={`object-contain ${collapsed ? "object-center" : "object-left"}`}
              sizes={collapsed ? "36px" : "200px"}
            />
          </div>
          {!collapsed ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-sidebar-muted uppercase">
                Creator Care OS
              </p>
              <p className="mt-1 text-xs leading-5 text-sidebar-muted">
                Creator support, engineered for trust.
              </p>
            </div>
          ) : null}
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="space-y-1">
              {!collapsed ? (
                <p className="px-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-sidebar-muted uppercase">
                  {section.label}
                </p>
              ) : null}
              {section.items.map(renderNavButton)}
            </div>
          ))}
        </nav>

        <div className="mt-auto space-y-2 border-t border-[var(--sidebar-border)] p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={`hidden w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-sidebar-muted transition-colors hover:bg-[var(--sidebar-hover)] hover:text-white lg:flex ${
              collapsed ? "justify-center" : ""
            }`}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <ExpandIcon className="h-4 w-4" />
            ) : (
              <>
                <CollapseIcon className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>

          <div
            className={`rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] ${
              collapsed ? "p-2" : "p-2.5"
            }`}
          >
            <div
              className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}
            >
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-violet)] text-xs font-semibold text-white"
                aria-hidden="true"
              >
                {initials}
              </span>
              {!collapsed ? (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {staffProfile.full_name || "Staff"}
                  </p>
                  <p className="truncate text-xs text-sidebar-muted">
                    {staffProfile.team || staffProfile.role || "Creator Support"}
                  </p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                void handleLogout();
              }}
              disabled={loggingOut}
              title={collapsed ? "Logout" : undefined}
              aria-label="Logout"
              className={`mt-2 inline-flex w-full items-center gap-2 rounded-md border border-[var(--sidebar-border)] px-2.5 py-1.5 text-sm font-medium text-sidebar-text transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70 ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <LogoutIcon className="h-4 w-4" />
              {!collapsed ? (
                <span>{loggingOut ? "Logging out..." : "Logout"}</span>
              ) : null}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
