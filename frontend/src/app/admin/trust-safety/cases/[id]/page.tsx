"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/utils/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoader, ErrorState } from "@/components/states";
import { toast } from "sonner";

export default function CaseDetailPage() {
  const { id } = useParams() as { id: string };
  const [mc, setMc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [note, setNote] = useState("");
  const [resolveReason, setResolveReason] = useState("");

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`/admin/moderation/cases/${id}`);
      setMc(res.data?.case || res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/admin/moderation/cases/${id}/note`, { note });
      toast.success("Note added");
      setNote("");
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to add note");
    }
  };

  const resolveCase = async (status: string) => {
    try {
      await api.post(`/admin/moderation/cases/${id}/resolve`, { status, reason: resolveReason || `Case ${status}`, policyCategory: mc?.decision?.policyCategory || "other" });
      toast.success(`Case ${status}`);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to resolve");
    }
  };

  if (loading) return <PageLoader label="Loading case…" />;
  if (error) return <ErrorState title="Failed to load case" onRetry={load} />;
  if (!mc) return <ErrorState title="Case not found" />;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-bold">Case {String(mc._id).slice(-8)} — {mc.severity} {mc.priority}</h1>
      <Card className="p-4 text-sm space-y-2">
        <div>Status: {mc.status} • Target: {mc.targetUser?.username || mc.targetUser || "—"}</div>
        <div>Reports: {mc.reports?.length || 0} • Assigned: {mc.assignedTo?.username || "unassigned"}</div>
        <div>Decision: {mc.decision?.action} — {mc.decision?.reason}</div>
        <div>Created: {new Date(mc.createdAt).toLocaleString()}</div>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Internal notes</h3>
        <div className="space-y-1 mb-3">
          {mc.internalNotes?.length === 0 ? <p className="text-muted-foreground">No notes</p> : mc.internalNotes?.map((n: any, i: number) => (
            <div key={i} className="border-b py-1"><span className="font-medium">{n.author?.username || n.author}:</span> {n.note} <span className="text-xs text-muted-foreground">{new Date(n.at).toLocaleString()}</span></div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add internal note…" />
          <Button onClick={addNote}>Add</Button>
        </div>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Resolve</h3>
        <Input value={resolveReason} onChange={(e) => setResolveReason(e.target.value)} placeholder="Resolution reason…" className="mb-2" />
        <div className="flex gap-2">
          <Button onClick={() => resolveCase("resolved")}>Resolved</Button>
          <Button variant="outline" onClick={() => resolveCase("dismissed")}>Dismissed</Button>
          <Button variant="outline" onClick={() => resolveCase("escalated")}>Escalate</Button>
        </div>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Decision history</h3>
        <div className="space-y-1">
          {mc.decisionHistory?.map((d: any, i: number) => (
            <div key={i} className="border-b py-1 text-xs">{d.action} {d.fromStatus} → {d.toStatus} by {d.actor} — {d.reason} <span className="text-muted-foreground">{new Date(d.at || d.createdAt).toLocaleString()}</span></div>
          ))}
        </div>
      </Card>
    </div>
  );
}
