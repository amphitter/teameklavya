"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Users, UsersRound, Plus, Search, Lock, UserPlus, Globe, BadgeCheck } from "lucide-react";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CommunityCard {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  joinPolicy: "open" | "request" | "invite";
  memberCount: number;
  organization?: { name: string; slug: string; isVerified?: boolean } | null;
  status?: "unverified" | "pending" | "verified" | "suspended" | "revoked";
}

interface MyOrg {
  _id: string;
  name: string;
  slug: string;
}

const POLICY_META: Record<string, { label: string; icon: typeof Globe; hint: string }> = {
  open: { label: "Open", icon: Globe, hint: "Anyone can join" },
  request: { label: "Request to join", icon: UserPlus, hint: "Admins approve requests" },
  invite: { label: "Invite only", icon: Lock, hint: "Admins invite members" },
};

/**
 * Communities directory (Part 3, Phase 6) — real communities and real
 * member counts only. Creation is limited to admins / org managers.
 */
export default function CommunitiesPage() {
  const { user, role } = useSessionUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CommunityCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  // Create dialog (admins / org managers)
  const [showCreate, setShowCreate] = useState(false);
  const [myOrgs, setMyOrgs] = useState<MyOrg[]>([]);
  const [form, setForm] = useState({ name: "", description: "", joinPolicy: "open", organizationId: "" });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(
    (nextPage: number, query: string) => {
      setLoading(true);
      setError(false);
      api
        .get("/communities", { params: { page: nextPage, limit: 12, q: query || undefined } })
        .then((res) => {
          const list: CommunityCard[] = res.data?.communities || [];
          setItems((prev) => (nextPage === 1 ? list : [...prev, ...list]));
          setHasMore(Boolean(res.data?.hasMore));
          setPage(nextPage);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    load(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orgs I manage (for the create dialog)
  useEffect(() => {
    if (!user) return;
    api
      .get("/organizations/mine")
      .then((r) => setMyOrgs(r.data?.organizations || []))
      .catch(() => {});
  }, [user]);

  const isAdmin = role === "admin";
  // Any signed-in user may try — the backend requires an institutional email
  // (domain = affiliation signal only; verification is always manual review)
  const canCreate = Boolean(user);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(1, q.trim());
  };

  const createCommunity = () => {
    if (!form.name.trim()) return setFormError("Give your community a name");
    setCreating(true);
    setFormError("");
    api
      .post("/communities", {
        name: form.name.trim(),
        description: form.description.trim(),
        joinPolicy: form.joinPolicy,
        organizationId: form.organizationId || undefined,
      })
      .then((r) => {
        if (r.data?.success) {
          setShowCreate(false);
          setForm({ name: "", description: "", joinPolicy: "open", organizationId: "" });
          load(1, q.trim());
        } else {
          setFormError(r.data?.message || "Couldn't create community");
        }
      })
      .catch((e: any) => setFormError(e.response?.data?.message || "Couldn't create community"))
      .finally(() => setCreating(false));
  };

  if (loading && items.length === 0) return <PageLoader label="Loading communities…" />;
  if (error && items.length === 0)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ErrorState title="Couldn't load communities" description="Give it another try." onRetry={() => load(1, q.trim())} />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-3 py-5 sm:px-6 sm:py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            <UsersRound className="h-6 w-6 text-primary" /> Communities
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Member groups with their own posts, events and channels.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New community
          </Button>
        )}
      </div>

      <form onSubmit={submitSearch} className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search communities by name…"
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No communities yet"
          description={
            canCreate
              ? "Be the first — create a community for your campus, club or cohort."
              : "Communities will appear here as admins and organizations create them."
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => {
            const policy = POLICY_META[c.joinPolicy] || POLICY_META.open;
            return (
              <Link
                key={c._id}
                href={`/communities/${c.slug}`}
                className="group flex flex-col rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_10px_40px_rgba(24,39,75,0.08)]"
              >
                <div className="flex items-start gap-3">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2563FF]/15 to-[#D946EF]/15 text-primary">
                      <Users className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-1 line-clamp-1 font-bold text-foreground group-hover:text-primary">
                      <span className="truncate">{c.name}</span>
                      {c.status === "verified" && (
                        <BadgeCheck className="h-4 w-4 shrink-0 text-success" aria-label="Officially verified" />
                      )}
                    </h3>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{c.memberCount} {c.memberCount === 1 ? "member" : "members"}</span>
                      {c.status && c.status !== "verified" && c.status !== "unverified" && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize ${
                            c.status === "pending"
                              ? "bg-warning-light text-warning"
                              : c.status === "revoked"
                                ? "bg-destructive/10 text-[#ba1a1a]"
                                : ""
                          }`}
                        >
                          {c.status}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {c.description ? (
                  <p className="mt-2.5 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                ) : null}
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground">
                    <policy.icon className="h-3 w-3" /> {policy.label}
                  </span>
                  {c.organization?.name ? (
                    <span className="truncate text-muted-foreground">by {c.organization.name}</span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => load(page + 1, q.trim())} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a community</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Hackathon Squad"
                maxLength={60}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What is this community about?"
                maxLength={1000}
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Join policy</label>
              <div className="grid grid-cols-3 gap-2">
                {(["open", "request", "invite"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, joinPolicy: p }))}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      form.joinPolicy === p
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {POLICY_META[p].label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {POLICY_META[form.joinPolicy]?.hint}
              </p>
            </div>
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Communities start <span className="font-semibold text-foreground">Unverified</span>. Your
              institutional email domain is stored as an affiliation signal only — official verification
              always requires proof and manual EventHub review.
            </p>
            {(isAdmin || myOrgs.length > 0) && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Organization {isAdmin ? "(optional)" : ""}
                </label>
                <select
                  value={form.organizationId}
                  onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                >
                  <option value="">No organization{isAdmin ? "" : " — pick your organization"}</option>
                  {myOrgs.map((o) => (
                    <option key={o._id} value={o._id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {formError && <p className="text-xs font-medium text-[#ba1a1a]">{formError}</p>}
            <Button onClick={createCommunity} disabled={creating} className="w-full">
              {creating ? "Creating…" : "Create community"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
