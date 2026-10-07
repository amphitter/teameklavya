"use client";

import { safeExternalUrl } from '@/utils/safe-url';
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Globe,
  ImagePlus,
  Link2,
  Loader2,
  Megaphone,
  Pencil,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, PageLoader, EmptyState } from "@/components/states";
import { EventCard, type EventCardData } from "@/components/event-card";
import { UserAvatar } from "@/components/user-avatar";
import { FeedPost } from "@/components/feed/feed-post";
import type { FeedPostData } from "@/components/feed/types";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cloudinaryUrl } from "@/utils/image";
import { compactCount } from "@/lib/social";
import { cn } from "@/lib/utils";

interface OrgPerson {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string };
}

interface OrgCommunity {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  joinPolicy: "open" | "request" | "invite";
  status?: string;
  memberCount: number;
}

interface OrgProfile {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  website?: string;
  followerCount: number;
  upcomingEventCount: number;
  pastEventCount: number;
  following: boolean;
  isVerified?: boolean;
  managers?: OrgPerson[];
  followersPreview?: OrgPerson[];
  canManage?: boolean;
}

type Tab = "upcoming" | "past" | "posts" | "communities";

/** Organization profile v2 — cover, follow, team, posts, events, communities. */
export default function OrganizationPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user: me } = useSessionUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [upcoming, setUpcoming] = useState<EventCardData[]>([]);
  const [past, setPast] = useState<EventCardData[]>([]);
  const [posts, setPosts] = useState<FeedPostData[]>([]);
  const [communities, setCommunities] = useState<OrgCommunity[]>([]);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [followBusy, setFollowBusy] = useState(false);

  // Edit dialog (creator / managers / super admin — backend enforced)
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ description: "", website: "", logoUrl: "", coverUrl: "" });
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const [saving, setSaving] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/organizations/${slug}`).catch(() => null),
      api.get(`/organizations/${slug}/events`).catch(() => null),
      api.get(`/organizations/${slug}/posts`).catch(() => null),
      api.get(`/organizations/${slug}/communities`).catch(() => null),
    ]).then(([orgRes, evRes, postsRes, commRes]) => {
      if (orgRes?.data?.organization) {
        const o = orgRes.data.organization;
        setOrg(o);
        setEditForm({ description: o.description || "", website: o.website || "", logoUrl: o.logoUrl || "", coverUrl: o.coverUrl || "" });
        setUpcoming(evRes?.data?.upcoming || []);
        setPast(evRes?.data?.past || []);
        setPosts(postsRes?.data?.posts || []);
        setCommunities(commRes?.data?.communities || []);
      } else {
        setError("This organization doesn't exist.");
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const toggleFollow = async () => {
    if (!org) return;
    if (!me) {
      router.push(`/login?returnUrl=${encodeURIComponent(`/organizations/${slug}`)}`);
      return;
    }
    setFollowBusy(true);
    try {
      const res = await api.post(`/organizations/${org._id}/follow`);
      if (res.data?.success) {
        setOrg((o) =>
          o ? { ...o, following: res.data.following, followerCount: o.followerCount + (res.data.following ? 1 : -1) } : o
        );
        toast.success(res.data.following ? `Following ${org.name}` : "Unfollowed");
      }
    } catch {
      toast.error("Couldn't update follow");
    } finally {
      setFollowBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.info(window.location.href);
    }
  };

  const uploadImage = async (file: File, kind: "logo" | "cover") => {
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post(`/upload/image?folder=organizations`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success && res.data.url) {
        setEditForm((f) => ({ ...f, [kind === "logo" ? "logoUrl" : "coverUrl"]: res.data.url }));
        toast.success(`${kind === "logo" ? "Logo" : "Cover"} uploaded`);
      } else throw new Error();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(null);
      if (kind === "logo" && logoRef.current) logoRef.current.value = "";
      if (kind === "cover" && coverRef.current) coverRef.current.value = "";
    }
  };

  const saveEdit = () => {
    if (!org) return;
    setSaving(true);
    api
      .put(`/organizations/${org._id}`, {
        description: editForm.description,
        website: editForm.website,
        logoUrl: editForm.logoUrl,
        coverUrl: editForm.coverUrl,
      })
      .then((r) => {
        if (r.data?.success) {
          toast.success("Organization updated");
          setShowEdit(false);
          setOrg((o) => (o ? { ...o, ...r.data.organization } : o));
        } else toast.error(r.data?.message || "Update failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Update failed"))
      .finally(() => setSaving(false));
  };

  if (loading) return <PageLoader label="Loading organization…" />;
  if (error || !org)
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorState title="Couldn't load organization" description={error || "Unknown error"} onRetry={load} />
      </div>
    );

  const meSuperAdmin = me?.email?.toLowerCase() === "devanshsinghr00@gmail.com";
  const tabs = [
    { id: "upcoming" as Tab, label: `Upcoming · ${upcoming.length}`, icon: CalendarDays },
    { id: "past" as Tab, label: `Past · ${past.length}`, icon: CalendarDays },
    { id: "posts" as Tab, label: `Posts · ${posts.length}`, icon: Megaphone },
    { id: "communities" as Tab, label: `Communities · ${communities.length}`, icon: UsersRound },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl pb-4">
      {/* Cover */}
      <div className="relative h-36 w-full overflow-hidden bg-gradient-to-br from-brand-light via-purple-light to-cyan/20 sm:h-48">
        {org.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cloudinaryUrl(org.coverUrl, { w: 1200, h: 300 })} alt="" className="h-full w-full object-cover" />
        )}
      </div>

      <div className="mx-auto -mt-10 w-full max-w-5xl px-3 sm:px-6">
        {/* Header card */}
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cloudinaryUrl(org.logoUrl, { w: 160, h: 160 })}
                alt={org.name}
                className="h-20 w-20 shrink-0 rounded-2xl border-4 border-card object-cover shadow-sm"
              />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-card bg-brand-light text-primary shadow-sm">
                <Building2 className="h-9 w-9" />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {org.name}
                {org.isVerified && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-[11px] font-bold text-success"
                    title="Officially verified by EventHub"
                  >
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified
                  </span>
                )}
              </h1>
              {org.description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{org.description}</p>}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> {compactCount(org.followerCount)} followers
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" /> {org.upcomingEventCount} upcoming · {org.pastEventCount} past
                </span>
                {org.website && (
                  <a
                    href={safeExternalUrl(org.website) ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5" /> Website
                  </a>
                )}
              </div>

              {/* Real followers preview */}
              {org.followersPreview && org.followersPreview.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {org.followersPreview.map((u) => (
                      <span key={u._id} className="rounded-full ring-2 ring-card">
                        <UserAvatar user={u} size={24} />
                      </span>
                    ))}
                  </div>
                  <span className="text-[11px] text-muted-foreground">recently followed</span>
                </div>
              )}

              {/* Org team (creator + assigned managers — real people only) */}
              {org.managers && org.managers.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Settings className="h-3 w-3" /> Team
                  </span>
                  {org.managers.map((m) => (
                    <span key={m._id} className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 py-0.5 pl-0.5 pr-2.5">
                      <UserAvatar user={m} size={20} />
                      <Link
                        href={`/profile/${m.username || m._id}`}
                        className="text-[11px] font-semibold text-foreground hover:text-primary"
                      >
                        {m.firstName}
                        {m.lastName ? ` ${m.lastName}` : ""}
                      </Link>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                variant={org.following ? "outline" : "default"}
                onClick={toggleFollow}
                disabled={followBusy}
                className="gap-1.5"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {org.following ? "Following" : me ? "Follow" : "Sign in"}
              </Button>

              {(org.canManage || meSuperAdmin) && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowEdit(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}

              {meSuperAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  title="Super Admin control (server-enforced)"
                  onClick={() => {
                    api
                      .post(`/organizations/${org._id}/${org.isVerified ? "unverify" : "verify"}`)
                      .then((r) => {
                        if (r.data?.success) {
                          toast.success(org.isVerified ? "Verification revoked" : "Verified badge granted");
                          setOrg((o) => (o ? { ...o, isVerified: !org.isVerified } : o));
                        } else toast.error(r.data?.message || "Action failed");
                      })
                      .catch((e: any) => toast.error(e.response?.data?.message || "Action failed"));
                  }}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {org.isVerified ? "Unverify" : "Verify"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyLink} aria-label="Share organization">
                <Link2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6">
          <div className="flex gap-1.5 overflow-x-auto rounded-full border border-border bg-card p-1 sm:w-fit">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:text-sm",
                  tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {tab === "upcoming" &&
              (upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="No upcoming events"
                  description={`${org.name} hasn't announced anything yet. Follow to stay in the loop.`}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcoming.map((e) => (
                    <EventCard key={e._id} event={e} />
                  ))}
                </div>
              ))}

            {tab === "past" &&
              (past.length === 0 ? (
                <EmptyState icon={CalendarDays} title="No past events" description={`${org.name}'s event history will appear here.`} />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {past.map((e) => (
                    <EventCard key={e._id} event={e} />
                  ))}
                </div>
              ))}

            {tab === "posts" &&
              (posts.length === 0 ? (
                <EmptyState
                  icon={Megaphone}
                  title="Your story starts here."
                  description={`Announcements and event shares from ${org.name} will appear here.`}
                />
              ) : (
                <div className="mx-auto max-w-2xl space-y-4">
                  {posts.map((p) => (
                    <FeedPost key={p._id} post={p} onDeleted={(id) => setPosts((prev) => prev.filter((x) => x._id !== id))} />
                  ))}
                </div>
              ))}

            {tab === "communities" &&
              (communities.length === 0 ? (
                <EmptyState
                  icon={UsersRound}
                  title="No communities yet"
                  description={`Communities hosted by ${org.name} will appear here.`}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {communities.map((c) => (
                    <Link
                      key={c._id}
                      href={`/communities/${c.slug}`}
                      className="group rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_10px_40px_rgba(24,39,75,0.08)]"
                    >
                      <div className="flex items-start gap-3">
                        {c.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                        ) : (
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2563FF]/15 to-[#D946EF]/15 text-primary">
                            <Users className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="flex items-center gap-1 truncate text-sm font-bold text-foreground group-hover:text-primary">
                            <span className="truncate">{c.name}</span>
                            {c.status === "verified" && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-success" />}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {c.memberCount} {c.memberCount === 1 ? "member" : "members"} · {c.joinPolicy}
                          </p>
                        </div>
                      </div>
                      {c.description ? <p className="mt-2.5 line-clamp-2 text-xs text-muted-foreground">{c.description}</p> : null}
                    </Link>
                  ))}
                </div>
              ))}
          </div>
        </div>

        {/* Edit dialog (backend re-checks creator/manager/super-admin) */}
        <Dialog open={showEdit} onOpenChange={setShowEdit}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit {org.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Logo</label>
                <div className="flex items-center gap-3">
                  {editForm.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cloudinaryUrl(editForm.logoUrl, { w: 96, h: 96 })} alt="" className="h-11 w-11 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground">
                      <Building2 className="h-5 w-5" />
                    </span>
                  )}
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">
                      {uploading === "logo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      {uploading === "logo" ? "Uploading…" : "Upload logo"}
                    </span>
                    <input
                      ref={logoRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], "logo")}
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Cover image</label>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">
                    {uploading === "cover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {uploading === "cover" ? "Uploading…" : editForm.coverUrl ? "Replace cover" : "Upload cover"}
                  </span>
                  <input
                    ref={coverRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], "cover")}
                  />
                </label>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  maxLength={1000}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Website</label>
                <input
                  value={editForm.website}
                  onChange={(e) => setEditForm((f) => ({ ...f, website: e.target.value }))}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
              </div>

              <Button onClick={saveEdit} disabled={saving || uploading !== null} className="w-full">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
