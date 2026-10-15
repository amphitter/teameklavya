"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/utils/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageLoader, ErrorState } from "@/components/states";
import { toast } from "sonner";

export default function ReportDetailPage() {
  const { id } = useParams() as { id: string };
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resolving, setResolving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`/admin/moderation/reports/${id}`);
      setReport(res.data?.report || res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const resolve = async (status: string) => {
    setResolving(true);
    try {
      await api.post(`/admin/moderation/reports/${id}/resolve`, { status, resolution: `Resolved as ${status} by Super Admin` });
      toast.success(`Report ${status}`);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to resolve");
    } finally {
      setResolving(false);
    }
  };

  if (loading) return <PageLoader label="Loading report…" />;
  if (error) return <ErrorState title="Failed to load report" onRetry={load} />;
  if (!report) return <ErrorState title="Report not found" />;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-bold">Report {String(report._id).slice(-8)} — {report.contentType} {report.reason}</h1>
      <Card className="p-4 text-sm space-y-2">
        <div>Status: <span className="font-medium">{report.status}</span> Priority: <span className="font-medium">{report.priority}</span></div>
        <div>Reporter: {report.reporter?.username || report.reporter} • Target user: {report.targetUser?.username || report.targetUser || "—"}</div>
        <div>Content ID: {report.contentId}</div>
        <div>Details: {report.details}</div>
        <div>Created: {new Date(report.createdAt).toLocaleString()}</div>
        {report.resolvedAt && <div>Resolved: {new Date(report.resolvedAt).toLocaleString()} by {report.resolvedBy?.username}</div>}
      </Card>
      <div className="flex gap-2">
        <Button disabled={resolving} onClick={() => resolve("actioned")}>Actioned</Button>
        <Button variant="outline" disabled={resolving} onClick={() => resolve("dismissed")}>Dismiss</Button>
        <Button variant="outline" disabled={resolving} onClick={() => resolve("reviewed")}>Mark reviewed</Button>
      </div>
    </div>
  );
}
