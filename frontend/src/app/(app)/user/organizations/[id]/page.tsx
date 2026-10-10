"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Clock, Building2, FileText, Shield, AlertTriangle } from "lucide-react";
import { api } from "@/utils/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageLoader, ErrorState } from "@/components/states";

export default function RequestDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [req, setReq] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/organization-registration-requests/mine/${id}`)
      .then((r) => setReq(r.data?.request))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLoader label="Loading request…" />;
  if (error || !req) return <ErrorState title="Couldn't load request" />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-5 sm:px-6 sm:py-7">
      <Link href="/user/organizations" className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> Organization requests
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold tracking-tight">{req.proposedName}</h1>
        <Badge variant="outline">{req.status.replace(/_/g, " ")}</Badge>
        <span className="text-xs text-muted-foreground">{req.category}</span>
      </div>

      <Card className="p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Description</h3>
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{req.description}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><span className="font-medium">Website:</span> {req.website ? <a href={req.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">{req.website} <ExternalLink className="h-3 w-3" /></a> : "—"}</div>
          <div><span className="font-medium">Email:</span> {req.email || "—"}</div>
          <div><span className="font-medium">City:</span> {req.city || "—"} {req.state ? `, ${req.state}` : ""} {req.country ? `, ${req.country}` : ""}</div>
          <div><span className="font-medium">Slug:</span> {req.proposedSlug}</div>
          <div><span className="font-medium">Parent:</span> {req.parentOrganizationId ? (typeof req.parentOrganizationId === "object" ? `${req.parentOrganizationId.name} (${req.parentOrganizationId.slug})` : req.parentOrganizationId) : req.proposedParent?.name ? `${req.proposedParent.name} (proposed)` : "—"}</div>
          <div><span className="font-medium">Submitted:</span> {req.submittedAt ? new Date(req.submittedAt).toLocaleString() : "Not submitted"}</div>
        </div>

        {req.evidence && (
          <div className="rounded-xl border p-3 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Evidence</h4>
            <div className="grid gap-2 text-[13px]">
              {Object.entries(req.evidence).map(([k, v]) => {
                if (!v || (Array.isArray(v) && v.length === 0)) return null;
                if (k === "notes") return <div key={k}><span className="font-medium">Notes:</span> <span className="text-muted-foreground">{String(v)}</span></div>;
                if (k === "otherEvidenceUrls" || k === "otherEvidencePublicIds") return null;
                return <div key={k}><span className="font-medium">{k}:</span> {String(v).startsWith("http") ? <a href={String(v)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{String(v)}</a> : <span className="text-muted-foreground">{String(v)}</span>}</div>;
              })}
            </div>
          </div>
        )}

        {req.rejectionReason && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-semibold flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Rejection reason</div>
            <p className="mt-1">{req.rejectionReason}</p>
          </div>
        )}
        {req.infoRequestMessage && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
            <div className="font-semibold">Information requested</div>
            <p className="mt-1">{req.infoRequestMessage}</p>
          </div>
        )}

        <div className="rounded-lg bg-zinc-50 p-3 text-[12px] text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-400">
          <div className="flex items-center gap-1 font-semibold"><Clock className="h-3.5 w-3.5" /> Timeline</div>
          <div className="mt-2 space-y-1.5">
            {req.reviewHistory?.map((h: any, i: number) => (
              <div key={i} className="flex gap-2">
                <span className="text-[11px] text-muted-foreground shrink-0">{new Date(h.at).toLocaleString()}</span>
                <span><span className="font-medium">{h.action}</span> {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : `→ ${h.toStatus}`} {h.message ? `— ${h.message}` : ""}</span>
              </div>
            ))}
          </div>
        </div>

        {req.resultingOrganizationId && typeof req.resultingOrganizationId === "object" && (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
            Approved organization:{" "}
            <Link href={`/organizations/${req.resultingOrganizationId.slug || req.resultingOrganizationId.handle}`} className="font-semibold text-emerald-700 underline dark:text-emerald-300">
              {req.resultingOrganizationId.name}
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
