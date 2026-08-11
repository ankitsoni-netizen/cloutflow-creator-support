"use client";

import type { SourceChannel } from "@/lib/types";
import { channelAccentClass } from "@/lib/utils";
import {
  EmailIcon,
  InstagramIcon,
  PhoneIcon,
  WebsiteIcon,
  WhatsAppIcon,
} from "@/components/ui/Icons";

const CHANNEL_META: Record<
  SourceChannel,
  { label: string; Icon: typeof PhoneIcon }
> = {
  "Phone Call": { label: "Phone", Icon: PhoneIcon },
  WhatsApp: { label: "WhatsApp", Icon: WhatsAppIcon },
  Instagram: { label: "Instagram", Icon: InstagramIcon },
  Website: { label: "Website", Icon: WebsiteIcon },
  Email: { label: "Email", Icon: EmailIcon },
};

interface ChannelBadgeProps {
  channel: SourceChannel;
  showLabel?: boolean;
  className?: string;
}

export default function ChannelBadge({
  channel,
  showLabel = true,
  className = "",
}: ChannelBadgeProps) {
  const meta = CHANNEL_META[channel];
  const Icon = meta.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${channelAccentClass(channel)} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" title={meta.label} />
      {showLabel ? <span className="text-muted">{meta.label}</span> : null}
    </span>
  );
}
