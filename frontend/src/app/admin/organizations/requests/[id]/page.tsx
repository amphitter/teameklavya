"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, ExternalLink, Loader2, Check, X, MessageSquare, Shield, FileText, Building2, Clock, AlertTriangle, Info } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageLoader, ErrorState } from "@/components/states";

export default function AdminRequestDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`/organization-registration-requests/admin/${id}`);
      setData(res.data);
      const hRes = await api.get(`/organization-registration-requests/admin/${id}/history`).catch(() => null);
      if (hRes?.data?.history) setHistory(hRes.data.history);
      else setHistory(res.data?.request?.reviewHistory || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
  }, [id]);

  const handleApprove = async () => {
    if (!confirm(`Approve "${data?.request?.proposedName}"? This will create exactly one organization and make applicant OWNER. It will NOT verify the org.`)) return;
    setActionLoading("approve");
    try {
      const idempotencyKey = `approve-${id}-${Date.now()}`;
      const res = await api.post(`/organization-registration-requests/admin/${id}/approve`, {}, { headers: { "Idempotency-Key": idempotencyKey } });
      if (res.data?.success) {
        toast.success("Approved and organization created");
        load();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Approval failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim() || rejectReason.trim().length < 5) {
      toast.error("Reason must be at least 5 characters");
      return;
    }
    setActionLoading("reject");
    try {
      const res = await api.post(`/organization-registration-requests/admin/${id}/reject`, { reason: rejectReason });
      if (res.data?.success) {
        toast.success("Request rejected");
        setShowReject(false);
        setRejectReason("");
        load();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Rejection failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRequestInfo = async () => {
    if (!infoMessage.trim() || infoMessage.trim().length < 5) {
      toast.error("Message must be at least 5 characters");
      return;
    }
    setActionLoading("info");
    try {
      const res = await api.post(`/organization-registration-requests/admin/${id}/request-info`, { message: infoMessage });
      if (res.data?.success) {
        toast.success("Information requested");
        setShowInfo(false);
        setInfoMessage("");
        load();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to request info");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <PageLoader label="Loading request…" />;
  if (error || !data?.request) return <ErrorState title="Couldn't load request" onRetry={load} />;

  const req = data.request;
  const dups = data.potentialDuplicates || [];

  const canAct = req.status === "PENDING_REVIEW" || req.status === "NEEDS_INFORMATION";

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <Link href="/admin/organizations/requests" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary">
          <ChevronLeft className="h-4 w-4" /> All requests
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{req.status.replace(/_/g, " ")}</Badge>
          <span className="text-xs text-muted-foreground">{req.category}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{req.proposedName}</h1>
        <p className="text-sm text-muted-foreground max-w-[70ch]">{req.description}</p>
      </div>

      {/* Actions */}
      {canAct && (
        <Card className="p-4 flex flex-wrap gap-2">
          <Button onClick={handleApprove} disabled={!!actionLoading} className="gap-1.5">
            {actionLoading === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve & Create Org
          </Button>
          <Button variant="outline" onClick={() => setShowInfo(true)} disabled={!!actionLoading} className="gap-1.5">
            <MessageSquare className="h-4 w-4" /> Request info
          </Button>
          <Button variant="ghost" onClick={() => setShowReject(true)} disabled={!!actionLoading} className="gap-1.5 text-destructive hover:text-destructive">
            <X className="h-4 w-4" /> Reject
          </Button>
          <span className="text-[11px] text-muted-foreground self-center ml-2">Approval is idempotent — safe to retry. Creates exactly one org, OWNER membership, UNVERIFIED.</span>
        </Card>
      )}

      {/* Info / Reject dialogs inline */}
      {showInfo && (
        <Card className="p-4 space-y-3 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
          <Label>Request more information</Label>
          <textarea value={infoMessage} onChange={(e) => setInfoMessage(e.target.value)} rows={3} placeholder="Please provide authorization letter from HOD…" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10" />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRequestInfo} disabled={!!actionLoading}>{actionLoading === "info" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send request</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowInfo(false)}>Cancel</Button>
          </div>
        </Card>
      )}
      {showReject && (
        <Card className="p-4 space-y-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <Label>Rejection reason (min 5 chars)</Label>
          <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Not enough evidence of official affiliation…" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-red-500/50 focus:ring-4 focus:ring-red-500/10" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleReject} disabled={!!actionLoading}>{actionLoading === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Reject request</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 sm:p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Organization details</h3>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><span className="font-medium">Name:</span> {req.proposedName}</div>
              <div><span className="font-medium">Slug:</span> {req.proposedSlug}</div>
              <div><span className="font-medium">Category:</span> {req.category}</div>
              <div><span className="font-medium">Website:</span> {req.website ? <a href={req.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">{req.website} <ExternalLink className="h-3 w-3" /></a> : "—"}</div>
              <div><span className="font-medium">Email:</span> {req.email || "—"}</div>
              <div><span className="font-medium">Phone:</span> {req.phone || "—"}</div>
              <div className="sm:col-span-2"><span className="font-medium">Address:</span> {[req.addressLine, req.city, req.state, req.country, req.postalCode].filter(Boolean).join(", ") || "—"}</div>
              <div><span className="font-medium">Applicant role:</span> {req.applicantRole || "—"}</div>
              <div><span className="font-medium">Designation:</span> {req.designation || "—"}</div>
              <div><span className="font-medium">Logo:</span> {req.logoUrl ? <a href={req.logoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View</a> : "—"}</div>
              <div><span className="font-medium">Cover:</span> {req.coverUrl ? <a href={req.coverUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View</a> : "—"}</div>
            </div>

            {req.parentOrganizationId && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                <div className="font-semibold">Parent institution</div>
                {typeof req.parentOrganizationId === "object" ? (
                  <div>{req.parentOrganizationId.name} — {req.parentOrganizationId.slug} • {(req.parentOrganizationId as any).category} • {(req.parentOrganizationId as any).city}</div>
                ) : (
                  <div>{req.parentOrganizationId}</div>
                )}
              </div>
            )}

            {req.proposedParent?.name && (
              <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900/50">
                <div className="font-semibold">Proposed parent</div>
                <div>Name: {req.proposedParent.name}</div>
                <div>Website: {req.proposedParent.website || "—"}</div>
                <div>Email: {req.proposedParent.email || "—"}</div>
                <div>Location: {[req.proposedParent.city, req.proposedParent.country].filter(Boolean).join(", ") || "—"}</div>
                <div>Description: {req.proposedParent.description || "—"}</div>
              </div>
            )}

            {req.resultingOrganizationId && (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
                <div className="font-semibold text-emerald-800 dark:text-emerald-200">Approved organization</div>
                {typeof req.resultingOrganizationId === "object" ? (
                  <Link href={`/organizations/${(req.resultingOrganizationId as any).slug || (req.resultingOrganizationId as any).handle}`} className="font-semibold underline text-emerald-700 dark:text-emerald-300">
                    {(req.resultingOrganizationId as any).name} ({(req.resultingOrganizationId as any).slug})
                  </Link>
                ) : (
                  <span>{req.resultingOrganizationId}</span>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Evidence</h3>
            <div className="grid gap-2 text-sm">
              {req.evidence ? Object.entries(req.evidence).map(([k, v]) => {
                if (!v || (Array.isArray(v) && v.length === 0)) return null;
                if (k === "otherEvidencePublicIds") return null;
                if (k === "notes") return <div key={k} className="sm:col-span-2"><span className="font-medium">Notes:</span> <span className="text-muted-foreground whitespace-pre-wrap">{String(v)}</span></div>;
                if (k === "otherEvidenceUrls" && Array.isArray(v)) {
                  return <div key={k} className="sm:col-span-2"><span className="font-medium">Other evidence:</span> <div className="mt-1 flex flex-wrap gap-2">{v.map((url: string, i: number) => <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs border rounded px-2 py-1">Evidence {i+1}</a>)}</div></div>;
                }
                return <div key={k}><span className="font-medium">{k}:</span> {String(v).startsWith("http") ? <a href={String(v)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{String(v)}</a> : <span className="text-muted-foreground">{String(v)}</span>}</div>;
              }) : <span className="text-muted-foreground">No evidence provided</span>}
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4" /> Review history</h3>
            <div className="space-y-2">
              {history.length === 0 ? <span className="text-sm text-muted-foreground">No history</span> : history.map((h: any, i: number) => (
                <div key={i} className="rounded-lg border p-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{h.action}</span>
                    <span className="text-[11px] text-muted-foreground">{h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : `→ ${h.toStatus}`}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                    {h.actorRole && <Badge variant="outline" className="text-[10px]">{h.actorRole}</Badge>}
                  </div>
                  {h.message && <div className="mt-1 text-muted-foreground">{h.message}</div>}
                  {h.metadata && Object.keys(h.metadata).length > 0 && <div className="mt-1 text-[11px] text-muted-foreground">Meta: {JSON.stringify(h.metadata)}</div>}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Applicant</h3>
            {req.applicant ? (
              <div className="text-sm space-y-1">
                <div className="font-medium">{req.applicant.firstName} {req.applicant.lastName}</div>
                <div className="text-muted-foreground">@{req.applicant.username}</div>
                <div className="text-muted-foreground">{req.applicant.email}</div>
              </div>
            ) : <span className="text-sm text-muted-foreground">Unknown</span>}
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <div>Created: {new Date(req.createdAt).toLocaleString()}</div>
              <div>Submitted: {req.submittedAt ? new Date(req.submittedAt).toLocaleString() : "—"}</div>
              <div>Updated: {new Date(req.updatedAt).toLocaleString()}</div>
              <div>Version: {req.version}</div>
              <div>Resubmissions: {req.resubmissionCount || 0}</div>
              <div>Declaration: {req.declarationAccepted ? "Accepted" : "Not accepted"} {req.declarationAcceptedAt ? `at ${new Date(req.declarationAcceptedAt).toLocaleString()}` : ""}</div>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Potential duplicates</h3>
            {dups.length === 0 ? (
              <div className="text-xs text-muted-foreground">No exact name matches found in organizations.</div>
            ) : (
              <div className="space-y-2">
                {dups.map((d: any) => (
                  <div key={d._id} className="rounded-lg border p-2.5 text-xs">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-muted-foreground">{d.slug} • {d.city} • {d.category} • {d.status}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground pt-2 border-t">
              Duplicate check is case-insensitive exact name match. Use search to find similar names.
            </div>
          </Card>

          <Card className="p-4 space-y-2 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30">
            <h3 className="font-semibold text-sm flex items-center gap-2"><Info className="h-4 w-4" /> Review guidance</h3>
            <ul className="text-[12px] text-muted-foreground list-disc pl-4 space-y-1">
              <li>Verify official website lists the organization.</li>
              <li>Check authorization letter signature and domain email.</li>
              <li>For clubs, verify affiliation with parent institution.</li>
              <li>Approval creates OWNER membership, NOT verification.</li>
              <li>Verification requires separate authorized operation.</li>
              <li>Communities remain separate — do not convert community to org.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
