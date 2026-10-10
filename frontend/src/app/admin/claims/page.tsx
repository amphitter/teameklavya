"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Flag, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { isSuperAdminHint } from "@/lib/superAdmin";

interface Claim {
  _id: string;
  status: "pending" | "approved" | "rejected";
  resolution: string;
  claimantDomain: string;
  proof: { description: string; documentUrl: string; contactEmail: string };
  createdAt: string;
  community?: { _id: string; name: string; slug: string; status: string; affiliationDomain?: string } | null;
  organization?: { _id: string; name: string; slug: string; isVerified?: boolean } | null;
  claimant?: { _id: string; firstName?: string; lastName?: string; username?: string; email?: string } | null;
  reviewedBy?: { firstName?: string; lastName?: string; username?: string } | null;
  reviewNote?: string;
}

/**
 * Ownership claims queue (Super Admin only — server-enforced).
 * Every claim is reviewed manually; email domains are signals, never proof.
 */
export default function AdminClaimsPage() {
  const { user, ready } = useSessionUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [busyId, setBusyId] = useState("");

  const superAdminUiHint = isSuperAdminHint(user);

  const load = useCallback((status: string) => {
    setLoading(true);
    setError(false);
    api
      .get("/communities/claims", { params: { status } })
      .then((r) => setClaims(r.data?.claims || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (ready && user && superAdminUiHint) load(tab);
    else if (ready && (!user || !superAdminUiHint)) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?._id, superAdminUiHint, tab]);

  const review = (claimId: string, decision: "approve" | "reject", resolution?: "grant" | "transfer") => {
    setBusyId(claimId);
    api
      .post(`/communities/claims/${claimId}/review`, { decision, resolution })
      .then((r) => {
        if (r.data?.success) {
          toast.success(
            decision === "reject"
              ? "Claim rejected"
              : resolution === "grant"
                ? "Claim approved — community verified in place"
                : "Claim approved — official community created, student community renamed"
          );
          load(tab);
        } else toast.error(r.data?.message || "Review failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Review failed"))
      .finally(() => setBusyId(""));
  };

  if (!ready || (superAdminUiHint && loading && claims.length === 0 && !error)) {
    return <PageLoader label="Checking access…" />;
  }
  if (!user || !superAdminUiHint)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <EmptyState
          icon={ShieldCheck}
          title="Super Admin only"
          description="This queue is restricted to the permanent EventHub Super Admin."
        />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          <Flag className="h-6 w-6 text-primary" /> Ownership claims
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manual review queue — matching email domains are affiliation signals, never proof.
        </p>
      </div>

      <div className="flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold capitalize transition-colors ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title="Couldn't load claims" description="Give it another try." onRetry={() => load(tab)} />
      ) : claims.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={`No ${tab} claims`}
          description={tab === "pending" ? "New ownership claims will appear here for review." : undefined}
        />
      ) : (
        <ul className="space-y-4">
          {claims.map((c) => (
            <li key={c._id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/communities/${c.community?.slug}`} className="font-bold text-foreground hover:text-primary">
                  {c.community?.name || "Community"}
                </Link>
                {c.organization?.isVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-[10px] font-bold text-success">
                    <BadgeCheck className="h-3 w-3" /> Verified org
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  claimed by {c.claimant?.firstName ? `${c.claimant.firstName} ${c.claimant.lastName || ""}` : `@${c.claimant?.username || "user"}`} ·{" "}
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Organization: <span className="font-semibold text-foreground">{c.organization?.name || "—"}</span>
                {c.claimantDomain ? ` · domain signal: ${c.claimantDomain}` : ""}
              </p>
              {c.proof?.description ? (
                <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground">
                  {c.proof.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {c.proof?.contactEmail ? <span>Contact: {c.proof.contactEmail}</span> : null}
                {c.proof?.documentUrl ? (
                  <a href={c.proof.documentUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Proof document ↗
                  </a>
                ) : null}
                {c.reviewNote ? <span>Note: {c.reviewNote}</span> : null}
              </div>

              {c.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    size="sm"
                    disabled={busyId === c._id}
                    onClick={() => review(c._id, "approve", "transfer")}
                    title="Rename the student community safely (-students) and create the official verified community"
                  >
                    Approve · transfer + rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === c._id}
                    onClick={() => review(c._id, "approve", "grant")}
                    title="Verify this community in place"
                  >
                    Approve · verify in place
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === c._id}
                    onClick={() => review(c._id, "reject")}
                    className="text-[#ba1a1a]"
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
