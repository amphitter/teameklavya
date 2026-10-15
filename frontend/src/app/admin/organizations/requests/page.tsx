"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, Clock, Filter, Search, Loader2, Check, X, MessageSquare, ExternalLink, AlertTriangle } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";

type Status = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFORMATION" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "";
type Category = "" | "COLLEGE" | "UNIVERSITY" | "SCHOOL" | "AFFILIATED_CLUB" | "INSTITUTE" | "NON_PROFIT" | "COMMUNITY_GROUP" | "OTHER";

interface Req {
  _id: string;
  category: string;
  proposedName: string;
  description: string;
  status: string;
  city?: string;
  country?: string;
  website?: string;
  applicant?: { _id: string; firstName?: string; lastName?: string; username?: string; email?: string };
  parentOrganizationId?: { name: string; slug: string } | null;
  resultingOrganizationId?: { name: string; slug: string } | null;
  createdAt: string;
  submittedAt?: string;
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  NEEDS_INFORMATION: "bg-blue-100 text-blue-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  WITHDRAWN: "bg-zinc-100 text-zinc-600",
};

export default function AdminOrgRequestsPage() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("PENDING_REVIEW");
  const [category, setCategory] = useState<Category>("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      params.set("page", String(page));
      params.set("limit", "20");
      const res = await api.get(`/organization-registration-requests/admin/list?${params.toString()}`);
      setRequests(res.data?.requests || []);
      setCounts(res.data?.counts || {});
      setTotal(res.data?.pagination?.total || res.data?.requests?.length || 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, category]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const quickAction = async (id: string, action: "approve" | "reject" | "request-info", extra?: any) => {
    const idempotencyKey = `admin-${action}-${id}-${Date.now()}`;
    setActionLoading(`${action}-${id}`);
    try {
      let res;
      if (action === "approve") {
        res = await api.post(`/organization-registration-requests/admin/${id}/approve`, {}, { headers: { "Idempotency-Key": idempotencyKey } });
      } else if (action === "reject") {
        const reason = extra?.reason || prompt("Rejection reason (min 5 chars):");
        if (!reason || reason.trim().length < 5) { toast.error("Reason required"); setActionLoading(null); return; }
        res = await api.post(`/organization-registration-requests/admin/${id}/reject`, { reason });
      } else if (action === "request-info") {
        const message = extra?.message || prompt("What information is needed? (min 5 chars):");
        if (!message || message.trim().length < 5) { toast.error("Message required"); setActionLoading(null); return; }
        res = await api.post(`/organization-registration-requests/admin/${id}/request-info`, { message });
      }
      if (res?.data?.success) {
        toast.success(`${action} successful`);
        load();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organization Requests</h1>
          <p className="text-sm text-muted-foreground">Review and approve official colleges, universities, and affiliated clubs. Approval creates exactly one organization and OWNER membership — no platform admin, no auto-verification.</p>
        </div>
        <Link href="/admin/organizations" className="text-sm font-medium text-primary hover:underline">← Communities</Link>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {["PENDING_REVIEW", "NEEDS_INFORMATION", "APPROVED", "REJECTED", "DRAFT", "WITHDRAWN"].map((s) => (
          <Card key={s} className={`p-3 cursor-pointer transition-colors ${status === s ? "ring-2 ring-primary border-primary" : ""}`} onClick={() => { setStatus(s as any); setPage(1); }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.replace(/_/g, " ")}</div>
            <div className="text-xl font-bold">{counts[s] || 0}</div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, city, description…" className="pl-8" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              <option value="NEEDS_INFORMATION">Needs Info</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="DRAFT">Draft</option>
              <option value="WITHDRAWN">Withdrawn</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All</option>
              <option value="COLLEGE">College</option>
              <option value="UNIVERSITY">University</option>
              <option value="SCHOOL">School</option>
              <option value="AFFILIATED_CLUB">Affiliated Club</option>
              <option value="INSTITUTE">Institute</option>
              <option value="NON_PROFIT">Non-Profit</option>
              <option value="COMMUNITY_GROUP">Community Group</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <Button type="submit" className="shrink-0"><Filter className="h-4 w-4 mr-1" /> Filter</Button>
        </form>
      </Card>

      {loading ? (
        <PageLoader label="Loading requests…" />
      ) : error ? (
        <ErrorState title="Couldn't load requests" onRetry={load} />
      ) : requests.length === 0 ? (
        <EmptyState icon={Building2} title="No requests found" description="No organization requests match your filters." />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r._id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/organizations/requests/${r._id}`} className="text-[15px] font-bold hover:text-primary hover:underline truncate">{r.proposedName}</Link>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[r.status] || "bg-gray-100"}`}>{r.status.replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-muted-foreground">{r.category}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{r.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(r.createdAt).toLocaleDateString()}</span>
                    {r.city && <span>• {r.city}{r.country ? `, ${r.country}` : ""}</span>}
                    {r.applicant && <span>• {r.applicant.firstName} {r.applicant.lastName} ({r.applicant.email})</span>}
                    {r.website && <a href={r.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3 w-3" /> site</a>}
                  </div>
                  {r.parentOrganizationId && typeof r.parentOrganizationId === "object" && (
                    <div className="mt-1 text-[11px] text-muted-foreground">Parent: {(r.parentOrganizationId as any).name}</div>
                  )}
                  {r.resultingOrganizationId && typeof r.resultingOrganizationId === "object" && (
                    <div className="mt-1 text-[11px] text-emerald-700">→ Approved as <Link href={`/organizations/${(r.resultingOrganizationId as any).slug}`} className="font-semibold underline">{(r.resultingOrganizationId as any).name}</Link></div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 sm:flex-col sm:w-40">
                  <Link href={`/admin/organizations/requests/${r._id}`} className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-medium hover:bg-accent">View detail</Link>
                  {(r.status === "PENDING_REVIEW" || r.status === "NEEDS_INFORMATION") && (
                    <>
                      <Button size="sm" disabled={!!actionLoading} onClick={() => quickAction(r._id, "approve")} className="gap-1">
                        {actionLoading === `approve-${r._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={!!actionLoading} onClick={() => quickAction(r._id, "request-info")} className="gap-1">
                        <MessageSquare className="h-3.5 w-3.5" /> Request info
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!!actionLoading} onClick={() => quickAction(r._id, "reject")} className="gap-1 text-destructive hover:text-destructive">
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-2 pt-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
        <span className="inline-flex items-center px-3 text-sm text-muted-foreground">Page {page}{total ? ` • ${total} total` : ""}</span>
        <Button variant="outline" size="sm" disabled={requests.length < 20} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>
    </div>
  );
}
