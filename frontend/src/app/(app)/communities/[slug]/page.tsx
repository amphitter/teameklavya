"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Users,
  UsersRound,
  Lock,
  UserPlus,
  Globe,
  CalendarDays,
  Settings,
  Trash2,
  UserMinus,
  Check,
  X,
  BadgeCheck,
  ShieldCheck,
  ScrollText,
  Flag,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { isSuperAdminEmail } from "@/lib/superAdmin";
import { useSessionUser } from "@/components/shell/use-session-user";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { UserAvatar } from "@/components/user-avatar";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import { FeedPost } from "@/components/feed/feed-post";
import { EventCard, type EventCardData } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CommunityDetail {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  joinPolicy: "open" | "request" | "invite";
  memberCount: number;
  eventCount: number;
  organization?: { _id?: string; name: string; slug: string; logoUrl?: string; isVerified?: boolean } | null;
  officialOrganization?: { _id?: string; name: string; slug: string; logoUrl?: string; isVerified?: boolean } | null;
  status?: "unverified" | "pending" | "verified" | "suspended" | "revoked";
  affiliationDomain?: string;
  myMember: { status: "active" | "pending" | "invited"; role: "admin" | "member" } | null;
  isManager: boolean;
}

interface AuditEntry {
  _id: string;
  action: string;
  details: string;
  createdAt: string;
  actor?: { firstName?: string; lastName?: string; username?: string } | null;
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  unverified: { label: "Unverified", cls: "bg-muted text-muted-foreground" },
  pending: { label: "Claim pending review", cls: "bg-warning-light text-warning" },
  verified: { label: "Verified", cls: "bg-success-light text-success" },
  revoked: { label: "Verification revoked", cls: "bg-destructive/10 text-[#ba1a1a]" },
};

interface MemberRow {
  _id: string;
  role: "admin" | "member";
  status: "active" | "pending" | "invited";
  user: { _id: string; firstName?: string; lastName?: string; username?: string; profile?: any };
}

const POLICY_META: Record<string, { label: string; icon: typeof Globe }> = {
  open: { label: "Open — anyone can join", icon: Globe },
  request: { label: "Request to join — admins approve", icon: UserPlus },
  invite: { label: "Invite only", icon: Lock },
};

/**
 * Community page (Part 3, Phase 6) — membership, posts (members-only),
 * hosted events and the member list. Every count shown is real.
 */
export default function CommunityPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const { user } = useSessionUser();

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [posts, setPosts] = useState<any[]>([]);
  const [postsVisible, setPostsVisible] = useState(false); // active member?
  const [composerText, setComposerText] = useState("");
  const [posting, setPosting] = useState(false);

  const [events, setEvents] = useState<EventCardData[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [pending, setPending] = useState<MemberRow[]>([]);

  // Manager panel
  const [showManage, setShowManage] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);

  // Ownership claim (organization managers)
  const [showClaim, setShowClaim] = useState(false);
  const [myOrgs, setMyOrgs] = useState<{ _id: string; name: string; slug: string }[]>([]);
  const [claimForm, setClaimForm] = useState({ organizationId: "", description: "", documentUrl: "", contactEmail: "" });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");

  // Super Admin panel (Ownership Verification)
  const meSuperAdmin = isSuperAdminEmail(user?.email);
  const [showAudit, setShowAudit] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [adminForm, setAdminForm] = useState({ name: "", slug: "" });
  const [transferId, setTransferId] = useState("");

  const loadAll = useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .get(`/communities/${slug}`)
      .then((res) => {
        if (!res.data?.success) throw new Error();
        const c = res.data.community;
        setCommunity(c);
        const active = c.myMember?.status === "active";
        setPostsVisible(active);
        const jobs = [
          api.get(`/communities/${slug}/events`).then((r) => setEvents(r.data?.events || [])).catch(() => {}),
          api
            .get(`/communities/${slug}/members`)
            .then((r) => setMembers(r.data?.members || []))
            .catch(() => {}),
        ];
        if (active) {
          jobs.push(
            api.get(`/communities/${slug}/posts`).then((r) => setPosts(r.data?.posts || [])).catch(() => {})
          );
        }
        if (c.isManager) {
          jobs.push(
            api
              .get(`/communities/${slug}/members`, { params: { status: "pending" } })
              .then((r) => setPending(r.data?.members || []))
              .catch(() => {})
          );
        }
        return Promise.all(jobs);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    loadAll();
  }, [loadAll, user?._id]);

  const refreshHeader = () => {
    api
      .get(`/communities/${slug}`)
      .then((r) => {
        if (r.data?.success) {
          setCommunity(r.data.community);
          setAdminForm({ name: r.data.community.name || "", slug: r.data.community.slug || "" });
        }
      })
      .catch(() => {});
  };

  // Organizations I manage (claim dialog)
  useEffect(() => {
    if (!user) return;
    api
      .get("/organizations/mine")
      .then((r) => setMyOrgs(r.data?.organizations || []))
      .catch(() => {});
  }, [user]);

  const loadAudit = () => {
    api
      .get(`/communities/${slug}/audit`)
      .then((r) => setAuditEntries(r.data?.entries || []))
      .catch(() => {});
  };

  const submitClaim = () => {
    if (!claimForm.organizationId || !claimForm.description.trim()) {
      return setClaimError("Pick your organization and describe your proof");
    }
    setClaiming(true);
    setClaimError("");
    api
      .post(`/communities/${slug}/claim`, claimForm)
      .then((r) => {
        if (r.data?.success) {
          toast.success("Claim submitted for review");
          setShowClaim(false);
          refreshHeader();
        } else setClaimError(r.data?.message || "Claim failed");
      })
      .catch((e: any) => setClaimError(e.response?.data?.message || "Claim failed"))
      .finally(() => setClaiming(false));
  };

  const adminAction = (path: string, body: any, method: "post" | "put" = "post", msg?: string) =>
    api({ method, url: path, data: body })
      .then((r: any) => {
        if (r.data?.success) {
          toast.success(msg || "Done");
          refreshHeader();
          loadAll();
        } else toast.error(r.data?.message || "Action failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Action failed"));

  const removePost = (id: string) => setPosts((p) => p.filter((x) => x._id !== id));

  const act = (path: string, successMsg?: string) =>
    api
      .post(path)
      .then((r) => {
        if (r.data?.success) {
          toast.success(successMsg || r.data.message || "Done");
          loadAll();
        } else toast.error(r.data?.message || "Action failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Action failed"));

  const submitPost = () => {
    const content = composerText.trim();
    if (!content || !community) return;
    setPosting(true);
    api
      .post("/posts", { content, communityId: community._id, visibility: "community" })
      .then((r) => {
        if (r.data?.success) {
          setPosts((p) => [r.data.post, ...p]);
          setComposerText("");
          toast.success("Posted to the community");
        } else toast.error(r.data?.message || "Couldn't post");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Couldn't post"))
      .finally(() => setPosting(false));
  };

  const invite = () => {
    const username = inviteName.trim().replace(/^@/, "");
    if (!username) return;
    setInviting(true);
    api
      .post(`/communities/${slug}/invite`, { username })
      .then((r) => {
        if (r.data?.success) {
          toast.success(`Invited @${username}`);
          setInviteName("");
        } else toast.error(r.data?.message || "Invite failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Invite failed"))
      .finally(() => setInviting(false));
  };

  const deleteCommunity = () => {
    api
      .delete(`/communities/${slug}`)
      .then((r) => {
        if (r.data?.success) router.push("/communities");
        else toast.error(r.data?.message || "Delete failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Delete failed"));
  };

  const changePolicy = (joinPolicy: string) => {
    api
      .put(`/communities/${slug}`, { joinPolicy })
      .then((r) => {
        if (r.data?.success) {
          toast.success("Join policy updated");
          refreshHeader();
        } else toast.error(r.data?.message || "Update failed");
      })
      .catch(() => toast.error("Update failed"));
  };

  if (loading) return <PageLoader label="Loading community…" />;
  if (error || !community)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState title="Community not found" description="It may have been deleted." onRetry={loadAll} />
      </div>
    );

  const policy = POLICY_META[community.joinPolicy] || POLICY_META.open;
  const my = community.myMember;
  const isAdminMember = my?.status === "active" && my?.role === "admin";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-5 sm:px-6 sm:py-7">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-4">
          {community.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={community.avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#2563FF]/15 to-[#D946EF]/15 text-primary">
              <Users className="h-7 w-7" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
              {community.name}
              {community.status === "verified" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-[11px] font-bold text-success" title="Officially verified by EventHub">
                  <BadgeCheck className="h-3.5 w-3.5" /> Verified
                </span>
              )}
              {community.status && community.status !== "verified" && community.status !== "unverified" && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CHIP[community.status]?.cls || "bg-muted"}`}>
                  {STATUS_CHIP[community.status]?.label || community.status}
                </span>
              )}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{community.memberCount} members</span>
              <span className="inline-flex items-center gap-1">
                <policy.icon className="h-3.5 w-3.5" /> {policy.label}
              </span>
              {community.officialOrganization?.name ? (
                <Link href={`/organizations/${community.officialOrganization.slug}`} className="text-primary hover:underline">
                  Official: {community.officialOrganization.name}
                </Link>
              ) : community.organization?.name ? (
                <Link href={`/organizations/${community.organization.slug}`} className="text-primary hover:underline">
                  by {community.organization.name}
                </Link>
              ) : null}
            </div>
            {community.description ? (
              <p className="mt-2.5 text-sm text-muted-foreground">{community.description}</p>
            ) : null}
          </div>
        </div>

        {/* Membership actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!user && (
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              Log in to join
            </Link>
          )}

          {user && !my && community.joinPolicy !== "invite" && (
            <Button
              onClick={() =>
                act(
                  `/communities/${slug}/join`,
                  community.joinPolicy === "open" ? "Joined!" : "Request sent"
                )
              }
              className="gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              {community.joinPolicy === "open" ? "Join community" : "Request to join"}
            </Button>
          )}
          {user && !my && community.joinPolicy === "invite" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Invite only — ask an admin
            </span>
          )}

          {my?.status === "pending" && (
            <span className="rounded-full bg-warning-light px-3 py-1.5 text-xs font-semibold text-warning">
              Join request pending admin approval
            </span>
          )}

          {my?.status === "active" && (
            <Button
              variant="outline"
              onClick={() => act(`/communities/${slug}/leave`, "You left the community")}
              className="gap-1.5"
            >
              <UserMinus className="h-4 w-4" /> Leave
            </Button>
          )}

          {community.isManager && (
            <Button variant="outline" onClick={() => setShowManage((v) => !v)} className="gap-1.5">
              <Settings className="h-4 w-4" /> {showManage ? "Hide manage" : "Manage"}
            </Button>
          )}

          {user && myOrgs.length > 0 && ["unverified", "revoked"].includes(community.status || "unverified") && !community.officialOrganization?._id && (
            <Button variant="outline" onClick={() => setShowClaim(true)} className="gap-1.5">
              <Flag className="h-4 w-4" /> Claim for my organization
            </Button>
          )}
        </div>

        {/* Suspended notice (only managers/super admin can even reach this page) */}
        {community.status === "suspended" && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-sm font-semibold text-[#ba1a1a]">
              This community is suspended by the EventHub Super Admin.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              It is hidden platform-wide — listing, joins and posts are disabled.
            </p>
          </div>
        )}

        {/* Invitation banner */}
        {my?.status === "invited" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">You&apos;re invited to join this community</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => act(`/communities/${slug}/invitations/accept`, "Welcome!")}>
                <Check className="mr-1 h-3.5 w-3.5" /> Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act(`/communities/${slug}/invitations/decline`, "Invitation declined")}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Decline
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Manager panel */}
      {showManage && community.isManager && (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Settings className="h-4 w-4 text-primary" /> Manage community
          </h2>

          {/* Join policy */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Join policy</p>
            <div className="grid grid-cols-3 gap-2">
              {(["open", "request", "invite"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => changePolicy(p)}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold capitalize transition-colors ${
                    community.joinPolicy === p
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {POLICY_META[p].label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Invite by username */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Invite a member (by username)</p>
            <div className="flex gap-2">
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="username"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
              <Button size="sm" onClick={invite} disabled={inviting}>
                {inviting ? "…" : "Invite"}
              </Button>
            </div>
          </div>

          {/* Pending requests */}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Join requests {pending.length > 0 && <span className="text-primary">({pending.length})</span>}
            </p>
            {pending.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pending requests.</p>
            ) : (
              <ul className="space-y-2">
                {pending.map((m) => (
                  <li key={m._id} className="flex items-center gap-2.5">
                    <UserAvatar user={m.user} size={30} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {m.user.firstName}
                      {m.user.lastName ? ` ${m.user.lastName}` : ""}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => act(`/communities/${slug}/requests/${m._id}/approve`, "Request approved")}
                      className="h-7 px-2.5 text-[11px]"
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act(`/communities/${slug}/requests/${m._id}/reject`, "Request rejected")}
                      className="h-7 px-2.5 text-[11px]"
                    >
                      Reject
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Danger zone */}
          <div className="border-t border-border pt-3">
            <Button variant="outline" onClick={deleteCommunity} className="gap-1.5 text-[#ba1a1a]">
              <Trash2 className="h-4 w-4" /> Delete community
            </Button>
          </div>
        </div>
      )}

      {/* Super Admin panel — Ownership Verification controls (server enforces) */}
      {meSuperAdmin && (
        <div className="space-y-5 rounded-2xl border-2 border-primary/30 bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Super Admin · Ownership Verification
          </h2>

          {/* Verification */}
          <div className="flex flex-wrap gap-2">
            {community.status !== "verified" ? (
              <Button size="sm" onClick={() => adminAction(`/communities/${slug}/verification`, { action: "verify" }, "post", "Verified badge granted")}>
                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Grant verification
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => adminAction(`/communities/${slug}/verification`, { action: "revoke" }, "post", "Verification revoked")}>
                Revoke verification
              </Button>
            )}
            {community.status === "suspended" ? (
              <Button size="sm" variant="outline" onClick={() => adminAction(`/communities/${slug}/suspend`, { action: "unsuspend" }, "post", "Community restored")}>
                Unsuspend
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => adminAction(`/communities/${slug}/suspend`, { action: "suspend" }, "post", "Community suspended")}>
                Suspend
              </Button>
            )}
            <Link
              href="/admin/claims"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/5"
            >
              <Flag className="h-3.5 w-3.5" /> Claims queue
            </Link>
          </div>

          {/* Affiliation signal */}
          {community.affiliationDomain && (
            <p className="text-xs text-muted-foreground">
              Affiliation domain: <span className="font-semibold text-foreground">{community.affiliationDomain}</span>{" "}
              (signal only — students share it; verification requires proof review)
            </p>
          )}

          {/* Official handle / name */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Official name / handle</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={adminForm.name}
                onChange={(e) => setAdminForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Name"
                className="min-w-40 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
              <input
                value={adminForm.slug}
                onChange={(e) => setAdminForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="handle"
                className="min-w-40 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
              <Button size="sm" onClick={() => adminAction(`/communities/${slug}/admin`, adminForm, "put", "Official handle updated")}>
                Save
              </Button>
            </div>
          </div>

          {/* Transfer ownership */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Transfer ownership (user ID)</p>
            <div className="flex gap-2">
              <input
                value={transferId}
                onChange={(e) => setTransferId(e.target.value)}
                placeholder="5f… user id"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
              <Button size="sm" onClick={() => adminAction(`/communities/${slug}/transfer`, { userId: transferId }, "post", "Ownership transferred")}>
                Transfer
              </Button>
            </div>
          </div>

          {/* Audit log */}
          <div>
            <button
              onClick={() => {
                setShowAudit((v) => !v);
                if (!showAudit) loadAudit();
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground hover:text-primary"
            >
              <ScrollText className="h-4 w-4 text-primary" /> {showAudit ? "Hide" : "View"} ownership & verification history
            </button>
            {showAudit && (
              <ul className="mt-2 space-y-2">
                {auditEntries.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No history recorded.</li>
                ) : (
                  auditEntries.map((a) => (
                    <li key={a._id} className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                      <span className="font-bold text-foreground">{a.action.replace(/_/g, " ")}</span>{" "}
                      <span className="text-muted-foreground">
                        by {a.actor?.username ? `@${a.actor.username}` : "system"} ·{" "}
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                      {a.details ? <p className="mt-0.5 text-muted-foreground">{a.details}</p> : null}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Claim dialog */}
      <Dialog open={showClaim} onOpenChange={setShowClaim}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Claim this community for your organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Your claim goes to <span className="font-semibold text-foreground">manual review</span> by EventHub.
              A matching email domain is only an affiliation signal — official ownership requires valid proof.
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Organization</label>
              <select
                value={claimForm.organizationId}
                onChange={(e) => setClaimForm((f) => ({ ...f, organizationId: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                <option value="">Pick your organization</option>
                {myOrgs.map((o) => (
                  <option key={o._id} value={o._id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Proof of official ownership</label>
              <textarea
                value={claimForm.description}
                onChange={(e) => setClaimForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Who you are, why your organization is the official owner…"
                rows={3}
                maxLength={2000}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Proof document link (optional)</label>
              <input
                value={claimForm.documentUrl}
                onChange={(e) => setClaimForm((f) => ({ ...f, documentUrl: e.target.value }))}
                placeholder="https://… (letter, authorization, website page)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Official contact email</label>
              <input
                value={claimForm.contactEmail}
                onChange={(e) => setClaimForm((f) => ({ ...f, contactEmail: e.target.value }))}
                placeholder="admin@your-college.edu"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
            </div>
            {claimError && <p className="text-xs font-medium text-[#ba1a1a]">{claimError}</p>}
            <Button onClick={submitClaim} disabled={claiming} className="w-full">
              {claiming ? "Submitting…" : "Submit claim for review"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Posts */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <UsersRound className="h-4 w-4 text-primary" /> Community posts
        </h2>

        {postsVisible ? (
          <>
            <div className="rounded-2xl border border-border bg-card p-3.5">
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder={`Share something with ${community.name}…`}
                rows={2}
                maxLength={2000}
                className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={submitPost} disabled={posting || !composerText.trim()}>
                  {posting ? "Posting…" : "Post"}
                </Button>
              </div>
            </div>
            {posts.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                title="Your story starts here."
                description="Start the conversation — only members can see community posts."
              />
            ) : (
              posts.map((p) => <FeedPost key={p._id} post={p} onDeleted={removePost} />)
            )}
          </>
        ) : (
          <EmptyState
            icon={Lock}
            title="Members-only posts"
            description={
              my?.status === "pending"
                ? "Your join request is pending — posts unlock once an admin approves."
                : "Join this community to read and share posts."
            }
          />
        )}
      </section>

      {/* Events */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <CalendarDays className="h-4 w-4 text-primary" /> Events
        </h2>
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No upcoming events hosted by this community yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {events.map((e) => (
              <EventCard key={e._id} event={e} />
            ))}
          </div>
        )}
      </section>

      {/* Members */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Users className="h-4 w-4 text-primary" /> Members
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {members.map((m) => (
              <li key={m._id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar user={m.user} size={36} />
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/profile/${m.user.username || m.user._id}`}
                    className="line-clamp-1 block text-sm font-semibold text-foreground hover:underline"
                  >
                    {m.user.firstName}
                    {m.user.lastName ? ` ${m.user.lastName}` : ""}
                  </Link>
                  {m.role === "admin" ? (
                    <span className="text-[11px] font-semibold text-primary">Community admin</span>
                  ) : null}
                </span>
                {user && m.user._id !== user._id && <FollowAuthorButton userId={m.user._id} initialFollowing={false} size="sm" />}
                {community.isManager && m.role !== "admin" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(`/communities/${slug}/members/${m._id}/remove`, "Member removed")}
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-[#ba1a1a]"
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
