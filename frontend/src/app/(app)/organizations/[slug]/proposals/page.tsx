"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { PageLoader, EmptyState } from "@/components/states";
import { BadgeCheck, Building2, CalendarDays, Check, X, MessageSquare, Clock } from "lucide-react";

interface Proposal {
  _id: string;
  title: string;
  slug: string;
  description: string;
  startDate: string;
  endDate: string;
  venue?: string;
  eventType: string;
  approvalStatus: string;
  submittedAt?: string;
  createdAt: string;
  proposingOrganizationId?: { _id: string; name: string; slug: string; logoUrl?: string; category?: string } | string;
  parentInstitutionId?: string;
  bannerUrl?: string;
  logoUrl?: string;
  createdBy?: { firstName?: string; lastName?: string; username?: string };
  rejectionReason?: string;
  changeRequestMessage?: string;
  approvalHistory?: any[];
}

interface OrgProfile {
  _id: string;
  name: string;
  slug: string;
  category?: string;
  canManageEvents?: boolean;
}

export default function ProposalsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("PENDING_REVIEW");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [reason, setReason] = useState("");

  const loadOrg = async () => {
    try {
      const res = await api.get(`/organizations/${slug}`);
      if (res.data?.organization) setOrg(res.data.organization);
    } catch {}
  };

  const loadProposals = async () => {
    if (!org) return;
    setLoading(true);
    try {
      // Determine if institution or club by category or by trying institution queue first
      const isInst = ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"].includes(String(org.category || "").toUpperCase());
      if (isInst) {
        const res = await api.get(`/events/approvals/institution/${org._id}/queue`, { params: { status: filter } });
        setProposals(res.data?.events || []);
      } else {
        const res = await api.get(`/events/approvals/club/${org._id}/proposals`);
        let evs = res.data?.events || [];
        if (filter !== "ALL") evs = evs.filter((e: Proposal) => e.approvalStatus === filter);
        setProposals(evs);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrg();
  }, [slug]);

  useEffect(() => {
    if (org) loadProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, filter]);

  const handleApprove = async (p: Proposal) => {
    setActionBusy(p._id);
    try {
      await api.post(`/events/${p._id}/approve`, { reason });
      toast.success("Event approved");
      setSelected(null);
      setReason("");
      loadProposals();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Approve failed");
    } finally {
      setActionBusy(null);
    }
  };

  const handleReject = async (p: Proposal) => {
    if (!reason.trim()) {
      toast.error("Rejection reason required");
      return;
    }
    setActionBusy(p._id);
    try {
      await api.post(`/events/${p._id}/reject`, { reason });
      toast.success("Event rejected");
      setSelected(null);
      setReason("");
      loadProposals();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Reject failed");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRequestChanges = async (p: Proposal) => {
    if (!reason.trim()) {
      toast.error("Message required");
      return;
    }
    setActionBusy(p._id);
    try {
      await api.post(`/events/${p._id}/request-changes`, { message: reason });
      toast.success("Changes requested");
      setSelected(null);
      setReason("");
      loadProposals();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Request failed");
    } finally {
      setActionBusy(null);
    }
  };

  const handleResubmit = async (p: Proposal) => {
    setActionBusy(p._id);
    try {
      await api.post(`/events/${p._id}/resubmit`, {});
      toast.success("Resubmitted for approval");
      setSelected(null);
      loadProposals();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Resubmit failed");
    } finally {
      setActionBusy(null);
    }
  };

  if (!org) return <PageLoader label="Loading organization…" />;
  if (loading) return <PageLoader label="Loading proposals…" />;

  const isInst = ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"].includes(String(org.category || "").toUpperCase());

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 border-b border-border pb-4">
        <h1 className="text-xl font-semibold">{isInst ? "Event proposals" : "My proposals"} · {org.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isInst ? "Review and approve events proposed by affiliated clubs." : "Track your club's event proposals and reviewer feedback."}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { id: "PENDING_REVIEW", label: "Pending" },
          { id: "CHANGES_REQUESTED", label: "Changes requested" },
          { id: "APPROVED", label: "Approved" },
          { id: "REJECTED", label: "Rejected" },
          { id: "ALL", label: "All" },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setFilter(s.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${filter === s.id ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:bg-muted"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {proposals.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No proposals" description={filter === "PENDING_REVIEW" ? "No pending proposals." : `No ${filter.toLowerCase()} proposals.`} />
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => {
            const club = typeof p.proposingOrganizationId === "object" ? p.proposingOrganizationId : null;
            return (
              <div key={p._id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium">{p.title}</h3>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium border ${p.approvalStatus === "APPROVED" ? "bg-green-50 text-green-700 border-green-200" : p.approvalStatus === "PENDING_REVIEW" ? "bg-amber-50 text-amber-700 border-amber-200" : p.approvalStatus === "REJECTED" ? "bg-red-50 text-red-700 border-red-200" : "bg-muted"}`}>
                        {p.approvalStatus.replace(/_/g, " ")}
                      </span>
                      {club && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" /> {club.name}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" /> {new Date(p.startDate).toLocaleDateString()} → {new Date(p.endDate).toLocaleDateString()}
                      </span>
                      {p.venue && <span>{p.venue}</span>}
                      <span>{p.eventType}</span>
                      {p.submittedAt && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Submitted {new Date(p.submittedAt).toLocaleDateString()}</span>}
                    </div>
                    {p.rejectionReason && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 border border-red-200">Reason: {p.rejectionReason}</div>}
                    {p.changeRequestMessage && <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800 border border-amber-200">Reviewer: {p.changeRequestMessage}</div>}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelected(p)}>
                      View
                    </Button>
                    {isInst ? (
                      <>
                        {["PENDING_REVIEW", "CHANGES_REQUESTED"].includes(p.approvalStatus) && (
                          <>
                            <Button size="sm" className="h-8 gap-1 text-xs" disabled={actionBusy === p._id} onClick={() => handleApprove(p)}>
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={actionBusy === p._id} onClick={() => setSelected(p)}>
                              <X className="h-3.5 w-3.5" /> Reject
                            </Button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {["REJECTED", "CHANGES_REQUESTED"].includes(p.approvalStatus) && (
                          <Button size="sm" className="h-8 text-xs" disabled={actionBusy === p._id} onClick={() => handleResubmit(p)}>
                            Resubmit
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">{selected.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{selected.approvalStatus} · {new Date(selected.startDate).toLocaleString()} – {new Date(selected.endDate).toLocaleString()}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm">{selected.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Venue</h4>
                  <p className="mt-1 text-sm">{selected.venue || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</h4>
                  <p className="mt-1 text-sm">{selected.eventType}</p>
                </div>
              </div>

              {selected.approvalHistory && selected.approvalHistory.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revision history</h4>
                  <div className="mt-2 space-y-2">
                    {selected.approvalHistory.slice(-10).reverse().map((h: any, i: number) => (
                      <div key={i} className="rounded border border-border p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{h.action}</span>
                          <span className="text-muted-foreground">{h.fromStatus} → {h.toStatus}</span>
                          <span className="ml-auto text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</span>
                        </div>
                        {h.reason && <div className="mt-1 text-muted-foreground">Reason: {h.reason}</div>}
                        {h.message && <div className="mt-1">{h.message}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-border pt-4">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer message / Reason</h4>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for approval/rejection or requested changes" className="mt-2 min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm" />
              </div>

              <div className="flex flex-wrap gap-2">
                {isInst ? (
                  <>
                    <Button size="sm" onClick={() => handleApprove(selected)} disabled={actionBusy === selected._id}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => handleReject(selected)} disabled={actionBusy === selected._id}>Reject</Button>
                    <Button size="sm" variant="outline" onClick={() => handleRequestChanges(selected)} disabled={actionBusy === selected._id}>Request changes</Button>
                  </>
                ) : (
                  <>
                    {(selected.approvalStatus === "REJECTED" || selected.approvalStatus === "CHANGES_REQUESTED") && (
                      <Button size="sm" onClick={() => handleResubmit(selected)} disabled={actionBusy === selected._id}>Resubmit</Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
