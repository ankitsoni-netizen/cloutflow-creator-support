import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Icon({ title, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="m4 8 8 5 8-5" />
    </Icon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </Icon>
  );
}

export function UnassignedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 9.2-5.9" />
      <path d="M16 16h5" />
      <path d="M18.5 13.5v5" />
    </Icon>
  );
}

export function WaitingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.5" />
    </Icon>
  );
}

export function ResolvedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Icon>
  );
}

export function AnalyticsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 19h16" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-4" />
    </Icon>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 0 5 22" />
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19" />
    </Icon>
  );
}

export function AutomationsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2" />
      <path d="M12 18.3v2.2" />
      <path d="m18.4 5.6-1.6 1.6" />
      <path d="m7.2 16.8-1.6 1.6" />
      <path d="M20.5 12h-2.2" />
      <path d="M5.7 12H3.5" />
      <path d="m18.4 18.4-1.6-1.6" />
      <path d="m7.2 7.2-1.6-1.6" />
    </Icon>
  );
}

export function ChannelsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 8h8v5H8z" />
      <path d="M10 13v3l-2 1" />
      <path d="M14 13v3l2 1" />
      <path d="M5 5h14" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16.5 16.5 4 4" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 16h12l-1.2-1.2A2 2 0 0 1 16.2 13.4V10a4.2 4.2 0 1 0-8.4 0v3.4a2 2 0 0 1-.6 1.4L6 16Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 5-7 7 7 7" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}

export function CollapseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h16" />
      <path d="m17 9 3 3-3 3" />
    </Icon>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <path d="M15 16l4-4-4-4" />
      <path d="M19 12H9" />
    </Icon>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 13.4 8.6 18.5 10 13.4 11.4 12 16.5 10.6 11.4 5.5 10l5.1-1.4Z" />
      <path d="m18 15 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7Z" />
    </Icon>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 4.5h3l1.2 3-1.8 1.2a11 11 0 0 0 4.6 4.6l1.2-1.8 3 1.2v3A2 2 0 0 1 16.7 18 12.2 12.2 0 0 1 6 7.3a2 2 0 0 1 1.5-2.8Z" />
    </Icon>
  );
}

export function WhatsAppIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 18.5 6 21l2.7-1.3A8 8 0 1 0 7.5 18.5Z" />
      <path d="M9.2 10.8c.3-.4.6-.4.9-.4h.3c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.5l-.4.5c-.1.1-.1.3 0 .4.4.6 1 1.2 1.6 1.6.1.1.3.1.4 0l.5-.4c.2-.1.4-.2.5-.1l1.7.7c.3.1.4.3.4.5v.3c0 .3 0 .6-.4.9-.4.3-1 .5-1.6.5A6.3 6.3 0 0 1 9 11.8c0-.6.2-1.2.2-1Z" />
    </Icon>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="4" />
      <circle cx="12" cy="12" r="3.25" />
      <circle cx="16.7" cy="7.3" r="0.8" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function WebsiteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4.5 12h15" />
      <path d="M12 4.5c2.2 2.4 3.3 5 3.3 7.5s-1.1 5.1-3.3 7.5" />
      <path d="M12 4.5C9.8 6.9 8.7 9.5 8.7 12s1.1 5.1 3.3 7.5" />
    </Icon>
  );
}

export function EmailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="m5 8 7 5 7-5" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M6 15V6a2 2 0 0 1 2-2h9" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 7l10 10" />
      <path d="M17 7 7 17" />
    </Icon>
  );
}

export function CommandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 8h2v2H8z" />
      <path d="M14 8h2v2h-2z" />
      <path d="M8 14h2v2H8z" />
      <path d="M14 14h2v2h-2z" />
      <path d="M10 9h4" />
      <path d="M9 10v4" />
      <path d="M15 10v4" />
      <path d="M10 15h4" />
    </Icon>
  );
}

export function SortIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 6v12" />
      <path d="m5.5 15.5 2.5 2.5 2.5-2.5" />
      <path d="M16 18V6" />
      <path d="m13.5 8.5 2.5-2.5 2.5 2.5" />
    </Icon>
  );
}

export function PanelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M15 5v14" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.5 20 19H4Z" />
      <path d="M12 10v4" />
      <path d="M12 16.5h.01" />
    </Icon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 10.5V19h4.5v-5h3V19H18v-8.5" />
    </Icon>
  );
}

export function SlaIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v4l2.5 1.5" />
      <circle cx="12" cy="13" r="7" />
      <path d="M12 10v3.5l2 1" />
    </Icon>
  );
}

export function CreatorsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="2.75" />
      <circle cx="16" cy="9" r="2.25" />
      <path d="M4.5 18.5a4.5 4.5 0 0 1 9 0" />
      <path d="M13.5 18.5a3.8 3.8 0 0 1 6 0" />
    </Icon>
  );
}

export function CampaignsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6h10l4 3-4 3H5z" />
      <path d="M5 6v12" />
      <path d="M9 18h2" />
    </Icon>
  );
}

export function TeamIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h3" />
      <path d="M8 13h8" />
      <path d="M8 16h5" />
      <circle cx="16" cy="9" r="1.5" />
    </Icon>
  );
}

export function AiAgentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="7" width="14" height="11" rx="3" />
      <path d="M12 4v3" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
      <path d="M9 15.5h6" />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function AttachmentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15.5 8.5-6.3 6.3a2.2 2.2 0 1 1-3.1-3.1l7.4-7.4a3.5 3.5 0 0 1 5 5l-7.8 7.8a4.8 4.8 0 0 1-6.8-6.8L11 2.7" />
    </Icon>
  );
}
