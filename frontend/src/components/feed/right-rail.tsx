"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/utils/api";
import Link from "next/link";
import { cloudinaryUrl } from "@/utils/image";
import { compactCount } from "@/lib/social";
import { fetchEventsWithCounts } from "@/lib/events";
import { UserAvatar } from "@/components/user-avatar";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import type { SessionUser } from "@/components/shell/use-session-user";
import type { FeedPostData } from "@/components/feed/types";

/** Minimal shape both registered events and public event cards satisfy. */
interface RailEvent {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  startDate: string;
  venue?: string;
  participantCount?: number;
}

interface LiveQuizRef {
  quizId: string;
  title?: string;
  eventTitle?: string;
}

interface LbEntry {
  rank: number;
  score: number;
  user?: { _id: string; firstName?: string; lastName?: string; email?: string; profile?: { avatar?: string } } | null;
}

/** GET /api/users/suggested shape (deterministic: mutuals / co-registration / institution). */
interface SuggestedUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string; institution?: string };
}

interface TrendingTopic {
  topic: string;
  posts: number;
}

/** GET /api/organizations/suggested shape. */
interface SuggestedOrg {
  _id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  description?: string;
}

/** Tiny follow pill for organizations (toggle endpoint returns {following}). */
function OrgFollowPill({ orgId }: { orgId: string }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = () => {
    if (busy) return;
    setBusy(true);
    api
      .post(`/organizations/${orgId}/follow`)
      .then((r) => setFollowing(Boolean(r.data?.following)))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        following
          ? "border-border bg-muted text-muted-foreground"
          : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
      }`}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

const RANK_STYLES: Record<number, string> = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-slate-300 text-slate-800",
  3: "bg-amber-700 text-white",
};

function railDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Home right rail — three widgets, all real data:
 *  1. Upcoming events  — the signed-in user's registered upcoming events
 *     (public upcoming for logged-out visitors).
 *  2. Live leaderboard — only rendered when one of the user's ongoing events
 *     has a quiz currently live.
 *  3. Trending now — real topic volume (30d posts) + trending events
 *     (registrations + recent engagement). Deterministic, no ML.
 *  4. Builders to follow — /users/suggested (mutuals, co-registered,
 *     same institution) with a feed-authors fallback for brand-new users.
 *  5. Organizations to follow — orgs behind the user's registered events.
 */
export function RightRail({
  user,
  registeredUpcoming,
  liveQuiz,
  entries,
  posts,
}: {
  user: SessionUser | null;
  registeredUpcoming: RailEvent[];
  liveQuiz: LiveQuizRef | null;
  entries: LbEntry[];
  posts: FeedPostData[];
}) {
  const [publicUpcoming, setPublicUpcoming] = useState<RailEvent[]>([]);
  const [suggested, setSuggested] = useState<SuggestedUser[]>([]);
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [trendingEvents, setTrendingEvents] = useState<RailEvent[]>([]);
  const [suggestedOrgs, setSuggestedOrgs] = useState<SuggestedOrg[]>([]);

  // Logged-out visitors still get real upcoming events (public discovery)
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    fetchEventsWithCounts({ status: "upcoming", limit: 3 })
      .then(({ events }) => {
        if (!cancelled)
          setPublicUpcoming(
            events.map((e) => ({
              _id: e._id,
              title: e.title,
              slug: e.slug,
              bannerUrl: e.bannerUrl,
              startDate: e.startDate || "",
              venue: e.venue,
              participantCount: e.participantCount,
            }))
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Suggested people (deterministic signals) — signed-in only
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .get("/users/suggested", { params: { limit: 3 } })
      .then((r) => !cancelled && setSuggested(r.data?.users || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Suggested organizations — orgs behind my registered events
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .get("/organizations/suggested", { params: { limit: 2 } })
      .then((r) => !cancelled && setSuggestedOrgs(r.data?.organizations || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Trending topics + events — real volume/engagement, safe for logged-out too
  useEffect(() => {
    let cancelled = false;
    api
      .get("/posts/topics", { params: { limit: 6 } })
      .then((r) => !cancelled && setTrendingTopics(r.data?.topics || []))
      .catch(() => {});
    api
      .get("/events/trending", { params: { limit: 3 } })
      .then((r) => !cancelled && setTrendingEvents(r.data?.events || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Real builders from the current feed page: not followed, not me, deduped
  const builders = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedPostData["author"][] = [];
    for (const p of posts) {
      const a = p.author;
      if (!a?._id || seen.has(a._id) || p.authorFollowing) continue;
      if (user && a._id === user._id) continue;
      seen.add(a._id);
      out.push(a);
      if (out.length >= 3) break;
    }
    return out;
  }, [posts, user?._id]);

  const upcoming = user ? registeredUpcoming : publicUpcoming;
  // Prefer server suggestions; brand-new accounts fall back to feed authors
  const people = suggested.length > 0 ? suggested : builders;

  return (
    <aside className="hidden w-80 shrink-0 xl:block">
      <div className="sticky top-24 space-y-5 pb-6">
        {/* Upcoming events */}
        {upcoming.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_10px_40px_rgba(24,39,75,0.06)]">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">
                {user ? "Your upcoming events" : "Upcoming events"}
              </h3>
              <Link
                href={user ? "/user/registrations" : "/events"}
                className="text-xs font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            </header>
            <ul className="space-y-3">
              {upcoming.slice(0, 3).map((e) => (
                <li key={e._id}>
                  <Link
                    href={`/events/${e.slug}`}
                    className="flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-muted/60"
                  >
                    {e.bannerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cloudinaryUrl(e.bannerUrl, { w: 96, h: 96 }) || e.bannerUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#2563FF]/15 to-[#6C35FF]/15 text-primary">
                        <span className="material-symbols-outlined text-[20px] leading-none">calendar_month</span>
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 block text-[13px] font-semibold text-foreground">{e.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {railDate(e.startDate)}
                        {e.venue ? ` • ${e.venue}` : ""}
                      </span>
                      {typeof e.participantCount === "number" && e.participantCount > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {compactCount(e.participantCount)} attending
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-primary">
                      {user ? "View" : "Register"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Live leaderboard — only when a live quiz is actually running */}
        {liveQuiz && entries.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_10px_40px_rgba(24,39,75,0.06)]">
            <header className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                Live leaderboard
                <span className="flex items-center gap-1 rounded-full bg-[#ba1a1a] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  <span className="relative flex h-1 w-1">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
                    <span className="relative inline-flex h-1 w-1 rounded-full bg-white" />
                  </span>
                  Live
                </span>
              </h3>
              <Link href={`/quiz/${liveQuiz.quizId}`} className="text-xs font-semibold text-primary hover:underline">
                Full board
              </Link>
            </header>
            {liveQuiz.eventTitle && (
              <p className="mb-2.5 line-clamp-1 text-xs text-muted-foreground">{liveQuiz.eventTitle}</p>
            )}
            <ul className="space-y-2.5">
              {entries.slice(0, 4).map((en) => (
                <li key={en.user?._id || en.rank} className="flex items-center gap-2.5">
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${
                      RANK_STYLES[en.rank] || "bg-muted text-muted-foreground"
                    }`}
                  >
                    {en.rank}
                  </span>
                  <UserAvatar user={en.user} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 block text-[13px] font-semibold text-foreground">
                      {en.user?.firstName
                        ? `${en.user.firstName}${en.user.lastName ? ` ${en.user.lastName}` : ""}`
                        : "Builder"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-primary">{en.score} pts</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Trending now — real topic volume + engagement-ranked events */}
        {(trendingTopics.length > 0 || trendingEvents.length > 0) && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_10px_40px_rgba(24,39,75,0.06)]">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <span className="material-symbols-outlined text-[16px] text-primary leading-none">trending_up</span>
                Trending now
              </h3>
              <Link href="/explore?tab=trending" className="text-xs font-semibold text-primary hover:underline">
                More
              </Link>
            </header>

            {trendingTopics.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {trendingTopics.map((t) => (
                  <Link
                    key={t.topic}
                    href={`/explore?topic=${encodeURIComponent(t.topic)}`}
                    className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                  >
                    #{t.topic}
                  </Link>
                ))}
              </div>
            )}

            {trendingEvents.length > 0 && (
              <ul className="space-y-2.5">
                {trendingEvents.map((e) => (
                  <li key={e._id}>
                    <Link
                      href={`/events/${e.slug}`}
                      className="flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-muted/60"
                    >
                      {e.bannerUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cloudinaryUrl(e.bannerUrl, { w: 96, h: 96 }) || e.bannerUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#2563FF]/15 to-[#6C35FF]/15 text-primary">
                          <span className="material-symbols-outlined text-[18px] leading-none">local_fire_department</span>
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 block text-[13px] font-semibold text-foreground">{e.title}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {railDate(e.startDate)}
                          {typeof e.participantCount === "number" && e.participantCount > 0
                            ? ` • ${compactCount(e.participantCount)} registered`
                            : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Builders to follow — server suggestions, feed-author fallback */}
        {user && people.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_10px_40px_rgba(24,39,75,0.06)]">
            <header className="mb-3">
              <h3 className="text-sm font-bold text-foreground">Builders to follow</h3>
            </header>
            <ul className="space-y-3">
              {people.map((a) => (
                <li key={a._id} className="flex items-center gap-3">
                  <UserAvatar user={a} size={38} />
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/profile/${a.username || a._id}`}
                      className="line-clamp-1 block text-[13px] font-semibold text-foreground hover:underline"
                    >
                      {a.firstName}
                      {a.lastName ? ` ${a.lastName}` : ""}
                    </Link>
                    {a.profile?.institution ? (
                      <span className="line-clamp-1 block truncate text-xs text-muted-foreground">
                        {a.profile.institution}
                      </span>
                    ) : (
                      <span className="block text-xs text-muted-foreground">Suggested for you</span>
                    )}
                  </span>
                  <FollowAuthorButton userId={a._id} initialFollowing={false} size="sm" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Organizations to follow — orgs behind events you joined */}
        {user && suggestedOrgs.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_10px_40px_rgba(24,39,75,0.06)]">
            <header className="mb-3">
              <h3 className="text-sm font-bold text-foreground">Organizations to follow</h3>
            </header>
            <ul className="space-y-3">
              {suggestedOrgs.map((o) => (
                <li key={o._id} className="flex items-center gap-3">
                  {o.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cloudinaryUrl(o.logoUrl, { w: 96, h: 96 }) || o.logoUrl}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#6C35FF]/15 to-[#D946EF]/15 text-primary">
                      <span className="material-symbols-outlined text-[18px] leading-none">groups</span>
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/organizations/${o.slug}`}
                      className="line-clamp-1 block text-[13px] font-semibold text-foreground hover:underline"
                    >
                      {o.name}
                    </Link>
                    {o.description ? (
                      <span className="line-clamp-1 block text-xs text-muted-foreground">{o.description}</span>
                    ) : null}
                  </span>
                  <OrgFollowPill orgId={o._id} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
