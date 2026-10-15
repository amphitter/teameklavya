"use client";

import Link from "next/link";
import { AtSign, BadgeCheck, Bell, Building2, CalendarClock, Heart, Megaphone, MessageCircle, Ticket, UserPlus, X } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { timeAgo } from "@/lib/social";
import { cn } from "@/lib/utils";

/** Shape returned by GET /api/notifications (populated refs). */
export interface NotificationData {
  _id: string;
  type:
    | "follow"
    | "follow_request"
    | "follow_accepted"
    | "like"
    | "comment"
    | "mention"
    | "event_registration"
    | "org_follow"
    | "organization_invite"
    | "announcement"
    | "event_update"
    | "event_reminder"
    | "community_invite"
    | "message"
    | "achievement"
    | "organization_request_submitted"
    | "organization_request_approved"
    | "organization_request_rejected"
    | "organization_request_needs_info";
  read: boolean;
  createdAt: string;
  actor: { _id: string; firstName: string; lastName: string; username?: string; profile?: any } | null;
  post?: { _id: string; content: string } | null;
  event?: { _id?: string; title: string; slug: string } | null;
  organization?: { _id?: string; name: string; slug: string } | null;
  community?: { _id?: string; name: string; slug: string } | null;
  conversation?: { _id?: string } | null;
}

const META: Record<
  NotificationData["type"],
  { icon: any; tint: string; text: (n: NotificationData) => React.ReactNode; href: (n: NotificationData) => string }
> = {
  follow: {
    icon: UserPlus,
    tint: "bg-brand-light text-primary",
    text: (n) => <>started following you</>,
    href: (n) => `/profile/${n.actor?._id}`,
  },
  follow_request: {
    icon: UserPlus,
    tint: "bg-brand-light text-primary",
    text: (n) => <>requested to follow you</>,
    href: (n) => `/profile/${n.actor?._id}`,
  },
  follow_accepted: {
    icon: BadgeCheck,
    tint: "bg-success-light text-success",
    text: (n) => <>accepted your follow request</>,
    href: (n) => `/profile/${n.actor?._id}`,
  },
  mention: {
    icon: AtSign,
    tint: "bg-cyan/10 text-cyan",
    text: (n) => <>mentioned you in a post</>,
    href: (n) => `/post/${n.post?._id}`,
  },
  event_update: {
    icon: Bell,
    tint: "bg-warning-light text-warning",
    text: (n) => (
      <>
        updated <span className="font-bold text-foreground">{n.event?.title || "an event"}</span>
      </>
    ),
    href: (n) => (n.event?.slug ? `/events/${n.event.slug}` : "#"),
  },
  event_reminder: {
    icon: CalendarClock,
    tint: "bg-warning-light text-warning",
    text: (n) => (
      <>
        <span className="font-bold text-foreground">{n.event?.title || "Your event"}</span> starts soon
      </>
    ),
    href: (n) => (n.event?.slug ? `/events/${n.event.slug}` : "#"),
  },
  community_invite: {
    icon: Building2,
    tint: "bg-purple-light text-purple",
    text: (n) => (
      <>
        added you to{" "}
        <span className="font-bold text-foreground">{n.community?.name || "a community"}</span>
      </>
    ),
    href: (n) => (n.community?.slug ? `/communities/${n.community.slug}` : "#"),
  },
  message: {
    icon: MessageCircle,
    tint: "bg-brand-light text-primary",
    text: (n) => <>sent you a message</>,
    href: (n) => (n.conversation?._id ? `/messages?c=${n.conversation._id}` : "/messages"),
  },
  achievement: {
    icon: BadgeCheck,
    tint: "bg-success-light text-success",
    text: (n) => <>You unlocked a new achievement</>,
    href: (n) => "/user/profile",
  },
  like: {
    icon: Heart,
    tint: "bg-destructive/10 text-destructive",
    text: (n) => <>liked your post{n.post?.content ? ` — "${n.post.content.slice(0, 40)}${n.post.content.length > 40 ? "…" : ""}"` : ""}</>,
    href: (n) => `/post/${n.post?._id}`,
  },
  comment: {
    icon: MessageCircle,
    tint: "bg-cyan/10 text-cyan",
    text: (n) => <>commented on your post</>,
    href: (n) => `/post/${n.post?._id}`,
  },
  event_registration: {
    icon: Ticket,
    tint: "bg-success-light text-success",
    text: (n) => (
      <>
        registered for <span className="font-bold text-foreground">{n.event?.title || "your event"}</span>
      </>
    ),
    href: (n) => (n.event?.slug ? `/events/${n.event.slug}` : "#"),
  },
  org_follow: {
    icon: Building2,
    tint: "bg-purple-light text-purple",
    text: (n) => (
      <>
        followed your community <span className="font-bold text-foreground">{n.organization?.name || ""}</span>
      </>
    ),
    href: (n) => (n.organization?.slug ? `/organizations/${n.organization.slug}` : "#"),
  },
  organization_invite: {
    icon: Building2,
    tint: "bg-purple-light text-purple",
    text: (n) => (
      <>
        invited you to join <span className="font-bold text-foreground">{n.organization?.name || "an organization"}</span>
      </>
    ),
    href: (n) => (n.organization?.slug ? `/organizations/${n.organization.slug}` : "#"),
  },
  announcement: {
    icon: Megaphone,
    tint: "bg-warning-light text-warning",
    text: (n) => (
      <>
        announced <span className="font-bold text-foreground">{n.event?.title || "an event"}</span>
      </>
    ),
    href: (n) => (n.event?.slug ? `/events/${n.event.slug}` : "#"),
  },
  organization_request_submitted: {
    icon: Building2,
    tint: "bg-blue-100 text-blue-600",
    text: (n) => <>submitted organization request {n.organization?.name || ""}</>,
    href: () => "/user/organizations",
  },
  organization_request_approved: {
    icon: Building2,
    tint: "bg-emerald-100 text-emerald-700",
    text: (n) => (
      <>
        approved your organization <span className="font-bold text-foreground">{n.organization?.name || ""}</span> — you are OWNER (UNVERIFIED)
      </>
    ),
    href: (n) => (n.organization?.slug ? `/organizations/${n.organization.slug}` : "/user/organizations"),
  },
  organization_request_rejected: {
    icon: Building2,
    tint: "bg-red-100 text-red-700",
    text: () => <>your organization request was rejected — check reason</>,
    href: () => "/user/organizations",
  },
  organization_request_needs_info: {
    icon: Building2,
    tint: "bg-amber-100 text-amber-700",
    text: () => <>needs more info for your organization request</>,
    href: () => "/user/organizations",
  },
};

/** One notification row — shared by the bell dropdown and the full page. */
export function NotificationRow({
  n,
  onRead,
  onDelete,
  compact = false,
}: {
  n: NotificationData;
  onRead?: (id: string) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  const meta = META[n.type];
  const Icon = meta.icon;
  // System notifications (reminders, achievements) have no actor → "EventHub"
  const actorName = n.actor?.firstName
    ? `${n.actor.firstName}${n.actor.lastName ? ` ${n.actor.lastName}` : ""}`
    : "EventHub";
  const body = (
    <>
      {/* An actor-less notification is from EventHub itself (announcement,
          reminders, event updates). It used to render the initials fallback for
          a null user — an empty grey circle. It carries the product mark now, so
          "this came from EventHub" is visible at a glance. */}
      {n.actor ? (
        <UserAvatar user={n.actor} size={compact ? 30 : 36} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/eventhub-icon.png"
          alt=""
          width={compact ? 30 : 36}
          height={compact ? 30 : 36}
          className="shrink-0 rounded-full bg-muted object-contain p-0.5"
          style={{ height: compact ? 30 : 36, width: compact ? 30 : 36 }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", n.read ? "text-muted-foreground" : "text-foreground")}>
          <span className="font-bold text-foreground">{actorName}</span> {meta.text(n)}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</p>
      </div>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          meta.tint,
          n.read && "opacity-50"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      {!n.read && <span className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary" />}
    </>
  );

  return (
    <div className="group/notif relative flex items-center gap-1">
      <Link
        href={meta.href(n)}
        onClick={() => !n.read && onRead?.(n._id)}
        className={cn(
          "relative flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted",
          compact ? "px-2.5" : "border border-border bg-card px-4 py-3.5"
        )}
      >
        {body}
      </Link>
      {onDelete && (
        <button
          type="button"
          aria-label="Delete notification"
          onClick={() => onDelete(n._id)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-[#ba1a1a] group-hover/notif:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
