"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarDays, LogOut, Pencil, Ticket } from "lucide-react";
import { api } from "@/utils/api";
import { compressFor } from "@/utils/compress-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { ErrorState, PageLoader, EmptyState } from "@/components/states";
import { ProfileHeader, type ProfileStats } from "@/components/profile/profile-header";
import { PostsGrid } from "@/components/profile/posts-grid";
import { AchievementsGrid, type AchievementBadge } from "@/components/profile/achievements";
import { eventStatus } from "@/lib/events";
import { cn } from "@/lib/utils";
import type { FeedPostData } from "@/components/feed/types";

type Tab = "posts" | "events" | "achievements";

interface MyEvent {
  _id: string;
  slug?: string;
  title: string;
  startDate?: string;
  endDate?: string;
  venue?: string;
  eventType?: string;
}

/**
 * Own profile — reference layout: header with real stats,
 * tabs for Posts / Events / Achievements, edit dialog.
 */
export default function ProfileView() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [achievements, setAchievements] = useState<AchievementBadge[]>([]);
  const [posts, setPosts] = useState<FeedPostData[]>([]);
  const [events, setEvents] = useState<MyEvent[]>([]);

  const [tab, setTab] = useState<Tab>("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ institution: "", course: "", year: "" });
  const [socialForm, setSocialForm] = useState({
    username: "",
    bio: "",
    location: "",
    interests: "",
    avatar: "",
    coverImage: "",
    profileVisibility: "public",
    allowMessagesFrom: "everyone",
    showAttendance: true,
    showAchievements: true,
  });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await api.get("/auth/me").catch(() => null);
        if (!meRes?.data?.user) {
          localStorage.removeItem("token");
          localStorage.removeItem("role");
          localStorage.removeItem("user");
          router.replace("/login?returnUrl=%2Fuser%2Fprofile");
          return;
        }
        const u = meRes.data.user;
        setUser(u);
        setEditForm({
          institution: u.profile?.institution || "",
          course: u.profile?.course || "",
          year: u.profile?.year || "",
        });

        // Social identity (username/bio/avatar/cover/interests/privacy)
        api.get("/users/me/social").then((r) => {
          const su = r.data?.user;
          if (!su) return;
          setSocialForm({
            username: su.username || "",
            bio: su.profile?.bio || "",
            location: su.profile?.location || "",
            interests: (su.profile?.interests || []).join(", "),
            avatar: su.profile?.avatar || "",
            coverImage: su.profile?.coverImage || "",
            profileVisibility: su.socialSettings?.profileVisibility || "public",
            allowMessagesFrom: su.socialSettings?.allowMessagesFrom || "everyone",
            showAttendance: su.socialSettings?.showAttendance !== false,
            showAchievements: su.socialSettings?.showAchievements !== false,
          });
        }).catch(() => {});

        const [eventsRes, profileRes, postsRes, achRes] = await Promise.all([
          api.get("/registration/user/events").catch(() => ({ data: { events: [] } })),
          api.get(`/users/${u._id}/profile`).catch(() => null),
          api.get(`/users/${u._id}/posts?limit=24`).catch(() => null),
          api.get(`/users/${u._id}/achievements`).catch(() => null),
        ]);
        setEvents(eventsRes.data?.events ?? []);
        if (profileRes?.data?.stats) setStats(profileRes.data.stats as ProfileStats);
        if (postsRes?.data?.posts) setPosts(postsRes.data.posts as FeedPostData[]);
        if (achRes?.data?.achievements) setAchievements(achRes.data.achievements);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const uploadImage = async (file: File, kind: "avatar" | "cover") => {
    const setBusy = kind === "avatar" ? setAvatarBusy : setCoverBusy;
    setBusy(true);
    try {
      // §20 — an avatar is rendered at ≤400px; a cover at ≤1920px.
      const { file: toUpload } = await compressFor(file, kind === "avatar" ? "avatar" : "poster");
      const fd = new FormData();
      fd.append("file", toUpload);
      const res = await api.post(`/upload/image?folder=${kind === "avatar" ? "avatars" : "covers"}`, fd);
      if (res.data?.success && res.data.url) {
        setSocialForm((f) => ({ ...f, [kind === "avatar" ? "avatar" : "coverImage"]: res.data.url }));
      } else {
        toast.error("Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Social identity first (username conflicts surface a clear error)
      await api.put("/users/me/social", {
        username: socialForm.username.trim(),
        bio: socialForm.bio.trim(),
        location: socialForm.location.trim(),
        avatar: socialForm.avatar,
        coverImage: socialForm.coverImage,
        interests: socialForm.interests.split(",").map((t) => t.trim()).filter(Boolean),
        socialSettings: {
          profileVisibility: socialForm.profileVisibility,
          allowMessagesFrom: socialForm.allowMessagesFrom,
          showAttendance: socialForm.showAttendance,
          showAchievements: socialForm.showAchievements,
        },
      });

      const res = await api.put("/auth/me/profile", editForm);
      setUser((u: any) => ({
        ...u,
        username: socialForm.username.trim(),
        profile: { ...(res.data?.profile ?? editForm), avatar: socialForm.avatar, coverImage: socialForm.coverImage, bio: socialForm.bio.trim(), location: socialForm.location.trim() },
      }));
      setEditOpen(false);
      toast.success("Profile updated");
      router.refresh();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    toast.success("Logged out");
    router.push("/");
    router.refresh();
  };

  const upcoming = events.filter((e) => eventStatus(e.startDate, e.endDate) !== "past");
  const past = events.filter((e) => eventStatus(e.startDate, e.endDate) === "past");

  if (loading) return <PageLoader label="Loading your profile…" />;
  if (error || !user)
    return (
      <ErrorState
        title="Couldn't load your profile"
        description="Please try again in a moment."
        onRetry={() => router.refresh()}
      />
    );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-7">
      <ProfileHeader
        user={user}
        stats={stats}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={handleLogout} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" /> Log out
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit profile
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1.5 rounded-full border border-border bg-card p-1">
        {(
          [
            { id: "posts", label: `Posts${posts.length ? ` · ${posts.length}` : ""}` },
            { id: "events", label: `Events${events.length ? ` · ${events.length}` : ""}` },
            { id: "achievements", label: "Achievements" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "flex-1 rounded-full px-3 py-2 text-xs font-semibold transition-colors sm:text-sm",
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      {tab === "posts" &&
        (posts.length === 0 ? (
          <EmptyState
            icon={Pencil}
            title="Your event story starts here"
            description="Share photos, updates and event moments — they'll appear on your profile."
          />
        ) : (
          <PostsGrid posts={posts} />
        ))}

      {tab === "events" && (
        <div className="space-y-6">
          {events.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No events yet"
              description="Register for your first event and it'll show up here."
              actionLabel="Explore events"
              onAction={() => router.push("/explore")}
            />
          ) : (
            <>
              <EventListSection title="Upcoming" list={upcoming} />
              {past.length > 0 && <EventListSection title="Past" list={past} />}
            </>
          )}
        </div>
      )}

      {tab === "achievements" && <AchievementsGrid achievements={achievements} memberSince={user.createdAt} />}

      {/* Edit profile sheet (§21-24, §59) — the inline dialog it replaces
          could not change the avatar or cover, and had no username
          availability check. */}
      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={user}
        onSaved={(updated) => {
          // §56 — propagate the new identity immediately, no reload or
          // logout needed: header, nav avatar, post author labels.
          setUser((u: any) => ({ ...u, ...updated }));
          try {
            const raw = localStorage.getItem("user");
            if (raw) {
              localStorage.setItem("user", JSON.stringify({ ...JSON.parse(raw), ...updated }));
            }
          } catch {
            /* storage unavailable — the next /auth/me refetch will re-sync */
          }
        }}
      />
    </div>
  );
}

function EventListSection({ title, list }: { title: string; list: MyEvent[] }) {
  if (list.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {list.map((e) => (
          <Link
            key={e._id}
            href={e.slug ? `/events/${e.slug}` : "#"}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{e.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {e.startDate
                  ? new Date(e.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                  : "Date TBA"}
                {e.venue ? ` · ${e.venue}` : e.eventType === "online" ? " · Online" : ""}
              </p>
            </div>
            <Ticket className="h-4 w-4 shrink-0 text-primary" />
          </Link>
        ))}
      </div>
    </section>
  );
}
