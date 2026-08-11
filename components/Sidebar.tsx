"use client";

import Image from "next/image";
import type { NavItem } from "@/lib/types";

const NAV_ITEMS: { id: NavItem; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "my-tickets", label: "My Tickets" },
  { id: "resolved", label: "Resolved" },
  { id: "analytics", label: "Analytics" },
  { id: "resolution-base", label: "Resolution Base" },
  { id: "settings", label: "Settings" },
];

interface SidebarProps {
  activeNav: NavItem;
  onNavigate: (item: NavItem) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export default function Sidebar({
  activeNav,
  onNavigate,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-text transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-white/10 px-4 py-5">
          <div className="relative h-10 w-full overflow-hidden">
            <Image
              src="/cloutflow-logo.png"
              alt="Cloutflow"
              fill
              priority
              className="object-contain object-left"
              sizes="224px"
            />
          </div>
          <p className="mt-3 text-xs font-medium tracking-[0.14em] text-sidebar-muted uppercase">
            Creator Support
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  onCloseMobile();
                }}
                className={`rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-active text-white"
                    : "text-sidebar-muted hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 text-xs text-sidebar-muted">
          Internal CRM prototype
        </div>
      </aside>
    </>
  );
}
