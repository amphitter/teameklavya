"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  BadgeCheck,
  CalendarDays,
  CalendarRange,
  Flag,
  Pencil,
  ImageOff,
  Lock,
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
import { PostsGrid } from "@/components/profile/posts-grid";
import { AchievementsGrid, type AchievementBadge } from "@/components/profile/achievements";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cloudinaryUrl } from "@/utils/image";
import { cn } from "@/lib/utils";
import type { FeedPostData } from "@/components/feed/types";

type Tab = "posts" | "events" | "achievements" | "media";

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

/**
 * Public participant profile — real stats, real posts, real event history.
 * Route accepts both /profile/<username> and legacy /profile/<id>.
 * Private/followers-only profiles are enforced by the backend (canView).
 */
export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user: me } = useSessionUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileUser, setProfileUser] = useState<any>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [canView, setCanView] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "followers" | "private">("public");
  const [posts, setPosts] = useState<FeedPostData[]>([]);
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

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/users/${id}/profile`).catch(() => null),
      api.get(`/users/${id}/posts?limit=24`).catch(() => null),
      api.get(`/users/${id}/achievements`).catch(() => null),
    ]).then(([pRes, postsRes, achRes]) => {
      if (pRes?.data?.user) {
        setProfileUser(pRes.data.user);
        setStats(pRes.data.stats);
        setFollowing(Boolean(pRes.data.following));
        setCanView(pRes.data.canView !== false);
        setVisibility(pRes.data.visibility || "public");
        if (postsRes?.data?.posts) setPosts(postsRes.data.posts);
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

  const toggleFollow = async () => {
    if (!me) {
      router.push(`/login?returnUrl=${encodeURIComponent(`/profile/${id}`)}`);
      return;
    }
    setFollowBusy(true);
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
      }
    } catch {
      toast.error("Couldn't update follow");
    } finally {
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

  if (loading) return <PageLoader label="Loading profile…" />;
  if (error || !profileUser)
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorState title="Couldn't load profile" description={error || "Unknown error"} onRetry={load} />
      </div>
    );

  const isMe = me?._id === profileUser._id;
  const mediaImages = posts.flatMap((p) => p.images || []).slice(0, 12);

  const tabs = [
    { id: "posts" as Tab, label: `Posts${posts.length ? ` · ${posts.length}` : ""}` },
    { id: "events" as Tab, label: "Events" },
    { id: "achievements" as Tab, label: "Achievements" },
    { id: "media" as Tab, label: `Media${mediaImages.length ? ` · ${mediaImages.length}` : ""}` },
  ];

  return (
    <>
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-7">
      <ProfileHeader
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
                disabled={followBusy}
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
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-full border border-border bg-card p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors sm:text-sm",
                  tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "posts" &&
            (posts.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Your story starts here."
                description={`When ${profileUser.firstName} shares event moments, they'll appear here.`}
              />
            ) : (
              <PostsGrid posts={posts} />
            ))}

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

          {tab === "media" &&
            (mediaImages.length === 0 ? (
              <EmptyState
                icon={ImageOff}
                title="No media yet"
                description="Photos shared in posts will show up here."
              />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {mediaImages.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${src}-${i}`}
                    src={cloudinaryUrl(src, { w: 300, h: 300 }) || src}
                    alt=""
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                ))}
              </div>
            ))}
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
