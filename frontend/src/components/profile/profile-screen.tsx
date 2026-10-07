"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  BadgeCheck,
  CalendarDays,
  CalendarRange,
  Flag,
  Pencil,
  Bookmark,
  Heart,
  ImageOff,
  Lock,
  Archive as ArchiveIcon,
  MessageCircle,
  MoreHorizontal,
  ShieldOff,
  UserPlus,
} from "lucide-react";
import { api } from "@/utils/api";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FollowListModal } from "@/components/social/follow-list-modal";
import { ErrorState, PageLoader, EmptyState } from "@/components/states";
import { ProfileHeader, type ProfileStats } from "@/components/profile/profile-header";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { updateSessionUser } from "@/components/shell/use-session-user";
import { MediaGrid } from "@/components/profile/media-grid";
import { PostList } from "@/components/feed/post-list";
import { AchievementsGrid, type AchievementBadge } from "@/components/profile/achievements";
import { SESSION_EVENT, useSessionUser } from "@/components/shell/use-session-user";
import { cloudinaryUrl } from "@/utils/image";
import { cn } from "@/lib/utils";
import type { FeedPostData } from "@/components/feed/types";

type Tab = "posts" | "events" | "achievements" | "media" | "saved" | "liked" | "archive";

/* Owner-only tabs (§5). The endpoints behind them are `requireAuth` AND
 * viewer-scoped, so this list decides what is convenient to see, never what is
 * possible to fetch — a visitor who types the URL gets their own empty list,
 * not this profile's. */
const OWNER_TABS: Tab[] = ["saved", "liked", "archive"];

interface ProfileEvent {
  _id: string;
  slug?: string;
  title: string;
  bannerUrl?: string;
  startDate?: string;
  endDate?: string;
  venue?: string;
  eventType?: string;
  category?: string;
}

/** The one line that says an owner-only list is owner-only. */
function PrivateNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * The participant profile — ONE screen, two entry points.
 *
 * It serves /profile/<handle|id> (anyone's profile) and /user/profile (your
 * own, resolved from the session), because those were previously two different
 * screens with two different headers, two tab sets and two post renderers —
 * and /user/profile was the one users actually land on after signing in. The
 * rebuilt screen was reachable only by navigating to the other URL.
 *
 * Private/followers-only profiles are enforced by the backend (canView), so
 * which of the two entry points you arrive through changes nothing about what
 * you may see.
 */
export function ProfileScreen({ id: idProp }: { id?: string }) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const { user: me, ready: sessionReady } = useSessionUser();

  /* The id can arrive from the route (/profile/<handle>), from the session
     (/user/profile — "show me my own profile"), or not at all for a moment
     while the session is being read from storage. */
  const id = idProp ?? params?.id ?? me?.username ?? me?._id ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileUser, setProfileUser] = useState<any>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [canView, setCanView] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "followers" | "private">("public");
  /* Posts are NOT pre-fetched here any more.
   *
   * They used to be: one request for 24 posts, feeding both the Posts tab and
   * a Media tab built by flattening the images it happened to contain. The tab
   * now paginates its own list and the grid reads a real media endpoint, so
   * this screen makes ONE FEWER request before first paint and neither view is
   * limited by what this one page could carry. */
  const [tabCounts, setTabCounts] = useState<Partial<Record<Tab, number>>>({});
  const [achievements, setAchievements] = useState<AchievementBadge[]>([]);
  const [events, setEvents] = useState<{ upcoming: ProfileEvent[]; past: ProfileEvent[] }>({ upcoming: [], past: [] });
  const [following, setFollowing] = useState(false);
  const [requested, setRequested] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [tab, setTab] = useState<Tab>("posts");
  const [listModal, setListModal] = useState<"followers" | "following" | "requests" | null>(null);
  /* Part 9 §2-7 — the edit sheet mounts HERE, on the screen the user is
   * already looking at. The previous build navigated to /user/profile, which
   * was a different, older profile view whose only editable fields were
   * institution/course/year — so username, photo and banner simply could not
   * be changed from anywhere. */
  const [editOpen, setEditOpen] = useState(false);


  /* The image uploaders write to the server the moment a crop is confirmed —
   * they do not wait for the sheet's Save. That write is anonymous to this
   * screen, which keeps its own copy of the profile, so a new photo used to
   * show up in the header and the nav while the banner and photo the user was
   * actually looking at stayed old, until a reload.
   *
   * The uploader publishes the new identity to the session — the same
   * mechanism a profile save uses — and this screen merges it. Only `profile`,
   * and only for this account, so an identity change for someone else can
   * never rewrite the profile you are viewing. */
  useEffect(() => {
    const onSessionChange = () => {
      try {
        const raw = localStorage.getItem("user");
        if (!raw) return;
        const stored = JSON.parse(raw);
        setProfileUser((prev: any) => {
          if (!prev) return prev;
          if (stored?._id && prev._id && stored._id !== prev._id) return prev;
          return { ...prev, profile: { ...(prev.profile || {}), ...(stored.profile || {}) } };
        });
      } catch {
        /* storage unavailable — the next load() reconciles it */
      }
    };
    window.addEventListener(SESSION_EVENT, onSessionChange);
    return () => window.removeEventListener(SESSION_EVENT, onSessionChange);
  }, []);

  const load = () => {
    if (!id) return; // no id yet — the session is still being read
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/users/${id}/profile`).catch(() => null),
      api.get(`/users/${id}/achievements`).catch(() => null),
    ]).then(([pRes, achRes]) => {
      if (pRes?.data?.user) {
        setProfileUser(pRes.data.user);
        setStats(pRes.data.stats);
        setFollowing(Boolean(pRes.data.following));
        setCanView(pRes.data.canView !== false);
        setVisibility(pRes.data.visibility || "public");
        if (achRes?.data?.achievements) setAchievements(achRes.data.achievements);


      } else {
        setError("This profile doesn't exist or isn't visible.");
      }
    }).finally(() => setLoading(false));
  };

  // Precise follow state (requested vs following) + block state — runs when
  // both the session user and the profile are resolved
  useEffect(() => {
    if (!me?._id || !profileUser || me._id === profileUser._id) return;
    const uid = profileUser._id;
    let cancelled = false;
    api.get(`/follow/${uid}/status`).then((r) => {
      if (!cancelled && r.data?.success) {
        setRequested(Boolean(r.data.requested));
        setFollowing(Boolean(r.data.following));
      }
    }).catch(() => {});
    api.get("/blocks").then((r) => {
      if (!cancelled && r.data?.success) setBlocked((r.data.users || []).some((u: any) => u._id === uid));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?._id, profileUser?._id]);

  // Own profile: incoming follow-request count (for the Requests button)
  useEffect(() => {
    if (!profileUser || me?._id !== profileUser._id) return;
    api.get("/follow/requests")
      .then((r) => setRequestCount((r.data?.requests || []).length))
      .catch(() => {});
  }, [profileUser?._id, me?._id]);

  // Event history (own tab) — only when the profile is viewable
  useEffect(() => {
    if (!profileUser || !canView) return;
    let cancelled = false;
    api
      .get(`/users/${id}/events`)
      .then((res) => {
        if (!cancelled && res.data?.success) {
          setEvents({ upcoming: res.data.upcoming || [], past: res.data.past || [] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profileUser?._id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const followInFlight = useRef(false);

  /* Optimistic follow — same behaviour as the shared FollowAuthorButton pill in
     the feed, which this button quietly disagreed with.
   *
   * Before: the label only changed after `api.post` resolved, and the button was
   * `disabled` for the whole round-trip, so on a slow connection tapping Follow
   * looked like nothing happened (measured on a real phone-sized viewport: the
   * label flipped at +2038ms, 6ms AFTER the response). The follow itself always
   * worked; the transition did not exist.
   *
   * The server still has the last word — a private account answers "requested",
   * not "following" — and a genuine failure rolls the label back. Cancelled,
   * stale and unmounted requests stay silent, as everywhere else in this app. */
  const toggleFollow = async () => {
    if (!me) {
      router.push(`/login?returnUrl=${encodeURIComponent(`/profile/${id}`)}`);
      return;
    }
    if (followInFlight.current) return; // one tap, one request
    const wasFollowing = following;
    const wasRequested = requested;
    const next = !(following || requested);
    followInFlight.current = true;
    setFollowBusy(true);
    setFollowing(next);
    setRequested(false);
    try {
      const res = await api.post(`/follow/${profileUser._id}`);
      if (res.data?.success) {
        setFollowing(Boolean(res.data.following));
        setRequested(Boolean(res.data.requested));
        if (res.data.following) {
          setStats((s) => (s ? { ...s, followers: s.followers + 1 } : s));
          // A follow may unlock a followers-only profile — reload content
          if (!canView) load();
          toast.success("Following");
        } else if (res.data.requested) {
          toast.success("Follow request sent");
        } else {
          setStats((s) => (s ? { ...s, followers: s.followers - 1 } : s));
          toast.success(res.data.wasPending ? "Request cancelled" : "Unfollowed");
        }
      } else {
        setFollowing(wasFollowing);
        setRequested(wasRequested);
      }
    } catch {
      /* A genuine failure rolls the optimistic label back and says so. */
      setFollowing(wasFollowing);
      setRequested(wasRequested);
      toast.error("Couldn't update follow");
    } finally {
      followInFlight.current = false;
      setFollowBusy(false);
    }
  };

  const toggleBlock = async () => {
    if (!profileUser) return;
    try {
      const res = await api.post(`/blocks/${profileUser._id}`);
      if (res.data?.success) {
        setBlocked(res.data.blocked);
        if (res.data.blocked) {
          setFollowing(false);
          setRequested(false);
        }
        toast.success(res.data.blocked ? "User blocked" : "User unblocked");
      }
    } catch {
      toast.error("Couldn't update block");
    }
  };

  if (loading || (!id && !sessionReady)) return <PageLoader label="Loading profile…" />;
  if (!id) {
    /* Signed out, or a session with neither handle nor id — nothing to show. */
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <EmptyState
          icon={Lock}
          title="Sign in to see your profile"
          description="Your profile, saved posts and archive live behind your account."
          actionLabel="Sign in"
          onAction={() => router.push("/login")}
        />
      </div>
    );
  }
  if (error || !profileUser)
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorState title="Couldn't load profile" description={error || "Unknown error"} onRetry={load} />
      </div>
    );

  const isMe = me?._id === profileUser._id;

  /**
   * A count appears on a tab only when it is the whole truth (§5).
   *
   * `tabCounts` is written by the list/grid that owns each collection, and only
   * once that collection is fully loaded (`complete`). Before that, the label
   * has no number at all — because a count that silently means "however many we
   * fetched" is worse than no count: the old Posts tab said "· 24" on a profile
   * with forty posts, and "· 12" for media that had more, while the header
   * showed the true totals a few pixels above.
   */
  const withCount = (label: string, value?: number) => (value == null ? label : `${label} · ${value}`);

  const tabs = [
    { id: "posts" as Tab, label: withCount("Posts", tabCounts.posts) },
    { id: "events" as Tab, label: "Events" },
    { id: "media" as Tab, label: withCount("Media", tabCounts.media) },
    { id: "achievements" as Tab, label: "Achievements" },
    /* Owner-only. Kept last so the public profile reads identically to a
       visitor's, and so your own profile does not lead with private lists. */
    ...(isMe
      ? [
          { id: "saved" as Tab, label: withCount("Saved", tabCounts.saved) },
          { id: "liked" as Tab, label: withCount("Liked", tabCounts.liked) },
          { id: "archive" as Tab, label: withCount("Archive", tabCounts.archive) },
        ]
      : []),
  ];

  /* One reporter per collection; each fires only when it has the full picture
     (or when it discovers there is no picture to have). */
  const reportCount = (key: Tab) => ({ count, complete }: { count: number; complete: boolean }) =>
    setTabCounts((prev) => {
      const next = complete ? count : undefined;
      if (prev[key] === next) return prev; // no state churn on every render
      return { ...prev, [key]: next };
    });

  return (
    <>
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-7">
      <ProfileHeader
        isOwn={isMe}
        onChangePhoto={() => setEditOpen(true)}
        user={profileUser}
        stats={stats}
        onOpenFollowers={() => setListModal("followers")}
        onOpenFollowing={() => setListModal("following")}
        actions={
          isMe ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Edit profile
              </Button>
              {requestCount > 0 && (
                <Button size="sm" onClick={() => setListModal("requests")} className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" /> {requestCount} request{requestCount > 1 ? "s" : ""}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={following || requested ? "outline" : "default"}
                onClick={toggleFollow}
                aria-busy={followBusy}
                className="gap-1.5"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {following ? "Following" : requested ? "Requested" : me ? "Follow" : "Sign in to follow"}
              </Button>
              {me && !blocked && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/messages?with=${profileUser._id}`)}
                  className="gap-1.5"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Message
                </Button>
              )}
              {me && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More options"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={toggleBlock} className="gap-2 text-destructive focus:text-destructive">
                      <ShieldOff className="h-4 w-4" />
                      {blocked ? "Unblock user" : "Block user"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setReporting(true)} className="gap-2">
                      <Flag className="h-4 w-4" />
                      Report person
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        }
      />

      {/* Followers / following / requests lists */}
      {listModal && (
        <FollowListModal
          userId={profileUser._id}
          kind={listModal}
          open={listModal !== null}
          onOpenChange={(o) => !o && setListModal(null)}
          onCountChange={(d) => d !== 0 && setStats((st) => (st ? { ...st, followers: st.followers + d } : st))}
        />
      )}

      {/* Locked (private / followers-only and not following) */}
      {!canView && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background text-primary">
            <Lock className="h-7 w-7" />
          </div>
          <h3 className="text-base font-semibold text-foreground">This profile is {visibility === "private" ? "private" : "followers-only"}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Follow {profileUser.firstName} to see their posts, event history, and achievements.
          </p>
          {isMe && (
            <Button asChild size="sm" variant="outline">
              <Link href="/user/profile">Adjust privacy settings</Link>
            </Button>
          )}
        </div>
      )}

      {canView && (
        <>
          {/* The tab strip WRAPS rather than scrolling.
              With Saved · Liked · Archive on your own profile this is seven
              tabs; as a one-line scroller the last three sat past the right
              edge of every phone, behind a scrollbar we hide — so the Archive
              tab was invisible until you happened to drag the strip. Wrapping
              costs one extra row at 390px and removes all hidden state: the
              whole navigation is legible at a glance, which is the entire
              reason this phase exists. */}
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-card p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  "rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors sm:px-3.5 sm:py-2 sm:text-sm",
                  tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "posts" && (
            <PostList
              key={`posts-${profileUser._id}`}
              endpoint={({ page }) => `/users/${profileUser._id}/posts?page=${page}&limit=12`}
              emptyIcon={CalendarDays}
              emptyTitle={isMe ? "Your story starts here." : "Nothing shared yet."}
              emptyDescription={
                isMe
                  ? "Share an event moment and it will show up here — with the same likes, comments and saves as the feed."
                  : `When ${profileUser.firstName} shares event moments, they'll appear here.`
              }
              emptyAction={
                isMe ? (
                  <Button asChild size="sm" className="gap-1.5">
                    <Link href="/?compose=1">
                      <Pencil className="h-3.5 w-3.5" /> Share something
                    </Link>
                  </Button>
                ) : undefined
              }
              onStateChange={reportCount("posts")}
            />
          )}

          {tab === "events" && (
            <div className="space-y-6">
              {(["upcoming", "past"] as const).map((kind) => {
                const list = events[kind];
                return (
                  <section key={kind}>
                    <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                      {kind === "upcoming" ? "Upcoming events" : "Past events"}
                    </h3>
                    {list.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                        {kind === "upcoming" ? "No upcoming events." : "No past events yet."}
                      </p>
                    ) : (
                      <ul className="grid gap-2.5 sm:grid-cols-2">
                        {list.map((e) => (
                          <li key={e._id}>
                            <Link
                              href={`/events/${e.slug || e._id}`}
                              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
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
                                  <CalendarRange className="h-5 w-5" />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="line-clamp-1 block text-sm font-semibold text-foreground">{e.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {e.startDate
                                    ? new Date(e.startDate).toLocaleDateString("en-IN", {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      })
                                    : ""}
                                  {e.venue ? ` • ${e.venue}` : e.eventType ? ` • ${e.eventType}` : ""}
                                </span>
                              </span>
                              <BadgeCheck className="hidden h-4 w-4 shrink-0 text-primary/60 sm:block" aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {tab === "achievements" && (
            <AchievementsGrid achievements={achievements} memberSince={profileUser.createdAt} />
          )}

          {tab === "media" && (
            <MediaGrid
              key={`media-${profileUser._id}`}
              userId={profileUser._id}
              emptyTitle="No media yet"
              emptyDescription={
                isMe
                  ? "Photos you share in posts will show up here."
                  : `${profileUser.firstName} hasn't shared any photos yet.`
              }
              onStateChange={({ count, complete }) =>
                setTabCounts((prev) => {
                  const next = complete ? count : undefined;
                  if (prev.media === next) return prev;
                  return { ...prev, media: next };
                })
              }
            />
          )}

          {/* ── Owner-only collections (§5) ──────────────────────────────
           *  Three different things, deliberately not conflated:
           *    Saved   — posts YOU bookmarked (private bookmark, any author)
           *    Liked   — posts you reacted to
           *    Archive — YOUR OWN posts, set aside: out of public view, not
           *              deleted, restorable
           *  Served by three separate endpoints; the tabs only decide what is
           *  convenient to look at. */}
          {isMe && tab === "saved" && (
            <PostList
              key="saved"
              endpoint={({ cursor }) => `/posts/saved?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
              emptyIcon={Bookmark}
              emptyTitle="Nothing saved yet"
              emptyDescription="Save something you want to come back to — tap the bookmark on any post."
              notice={<PrivateNote>Only you can see what you save. Other people never see this list.</PrivateNote>}
              onStateChange={reportCount("saved")}
            />
          )}

          {isMe && tab === "liked" && (
            <PostList
              key="liked"
              endpoint={({ cursor }) => `/posts/liked?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
              emptyIcon={Heart}
              emptyTitle="Nothing liked yet"
              emptyDescription="Posts you like show up here, newest reaction first."
              notice={<PrivateNote>Only you can see this. Liking a post is public — this list is not.</PrivateNote>}
              onStateChange={reportCount("liked")}
            />
          )}

          {isMe && tab === "archive" && (
            <div>
              {stats && stats.archivedPosts ? (
                <PrivateNote>
                  Archived posts are out of your public profile and the feed, but nothing is deleted —
                  restore any of them to put it back.
                </PrivateNote>
              ) : null}
              <PostList
                key="archive"
                endpoint={({ cursor }) => `/posts/archived?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`}
                emptyIcon={ArchiveIcon}
                emptyTitle="Nothing archived"
                emptyDescription="Archive a post from its ••• menu to set it aside without deleting it."
                /* A restored post belongs on the profile, not in the archive —
                   so it leaves this list the moment it is restored. */
                onArchivedBehavior="remove"
                onStateChange={reportCount("archive")}
              />
            </div>
          )}
        </>
      )}
    </div>
      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        targetType="user"
        targetId={profileUser?._id || ""}
      />

      {/* Edit profile (§2-7). Mounted only for the owner. */}
      {isMe ? (
        <EditProfileSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          user={profileUser}
          onSaved={(saved) => {
            /* §2-7 — "propagates everywhere without logout". Three places
             * hold this identity and all three are refreshed here:
             *   1. this screen's local copy (header, banner, tabs)
             *   2. the shared session (header avatar, nav, author labels)
             *   3. the URL, when the username changed — every link to the
             *      old @handle now 404s, so the address bar is corrected. */
            if (saved) {
              setProfileUser((prev: any) => ({ ...prev, ...saved }));
              updateSessionUser(saved);
              if (saved.username && saved.username !== id) {
                router.replace(`/profile/${saved.username}`);
              }
            }
          }}
        />
      ) : null}
    </>
  );
}
