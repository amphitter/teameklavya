"use client";

import Link from "next/link";
import { UserAvatar } from "@/components/user-avatar";
import { displayNameOf, type PersonResult } from "@/components/people/use-people-search";
import { cn } from "@/lib/utils";

/**
 * One person, as a row (Part 13 §26, §24).
 *
 * Shared by the tag picker, the share sheet and the Discover People surface so
 * that "a person in a list" looks and behaves the same everywhere: avatar
 * first, name, @username, one line of context, and the action on the right.
 *
 * The whole row is the tap target on the People surface — on a phone, a 16px
 * "Follow" pill is a frustrating thing to aim at if the name is not also
 * tappable. When `href` is omitted the row is not a link at all, which is what
 * the pickers want: tapping there selects, it does not navigate away from a
 * half-written post.
 */
export function PersonRow({
  person,
  href,
  onSelect,
  action,
  subtitle,
  className,
}: {
  person: PersonResult;
  /** When set, the row navigates (People surface). Omit inside pickers. */
  href?: string;
  /** When set, the row is a button that selects (pickers). */
  onSelect?: (person: PersonResult) => void;
  /** Trailing slot: a follow pill, a checkbox, a selected tick. */
  action?: React.ReactNode;
  /** Overrides the context line. */
  subtitle?: React.ReactNode;
  className?: string;
}) {
  const context = subtitle ?? (
    <>
      <span className="truncate">@{person.username || "user"}</span>
      {typeof person.mutuals === "number" && person.mutuals > 0 ? (
        <span className="text-primary"> · {person.mutuals} mutual</span>
      ) : person.profile?.institution ? (
        <span className="truncate"> · {person.profile.institution}</span>
      ) : null}
    </>
  );

  const body = (
    <>
      <UserAvatar user={person} size={40} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-foreground">{displayNameOf(person)}</span>
          {person.verified ? <span className="shrink-0 text-xs text-primary">✓</span> : null}
        </span>
        <span className="flex min-w-0 items-center text-xs text-muted-foreground">{context}</span>
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </>
  );

  const base = cn(
    "flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
    className
  );

  if (href) {
    return (
      <Link href={href} className={cn(base, "hover:bg-muted/60")}>
        {body}
      </Link>
    );
  }

  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(person)} className={cn(base, "hover:bg-muted/60")}>
        {body}
      </button>
    );
  }

  return <div className={base}>{body}</div>;
}
