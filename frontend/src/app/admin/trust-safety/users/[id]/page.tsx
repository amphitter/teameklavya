"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/utils/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoader, ErrorState } from "@/components/states";
import { toast } from "sonner";

export default function UserDetailPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionType, setActionType] = useState("warning");
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState("3");
  const [enforcing, setEnforcing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get(`/admin/moderation/users/${id}`);
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const enforce = async () => {
    if (!reason.trim()) { toast.error("Reason required"); return; }
    setEnforcing(true);
    try {
      await api.post(`/admin/moderation/users/${id}/enforce`, { actionType, reason, policyCategory: "other", durationDays: Number(durationDays) });
      toast.success(`${actionType} enforced`);
      setReason("");
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Enforcement failed");
    } finally {
      setEnforcing(false);
    }
  };

  const reverse = async (enfId: string) => {
    const reversalReason = prompt("Reversal reason (min 5 chars):");
    if (!reversalReason || reversalReason.trim().length < 5) return;
    try {
      await api.post(`/admin/moderation/enforcement/${enfId}/reverse`, { reversalReason });
      toast.success("Enforcement reversed");
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Reverse failed");
    }
  };

  if (loading) return <PageLoader label="Loading user…" />;
  if (error) return <ErrorState title="Failed to load user" onRetry={load} />;
  if (!data) return <ErrorState title="User not found" />;

  const user = data.user;

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-bold">{user.firstName} {user.lastName} @{user.username} — Enforcement</h1>

      <Card className="p-4 text-sm space-y-1">
        <div>Email: {user.email}</div>
        <div>Created: {new Date(user.createdAt).toLocaleString()}</div>
        <div>Warnings: {user.warningCount} • Violations: {user.violationCount} {user.bannedAt ? "• BANNED" : ""} {user.suspendedAt ? "• SUSPENDED" : ""}</div>
        <div>BannedAt: {user.bannedAt ? new Date(user.bannedAt).toLocaleString() : "—"} Reason: {user.banReason || "—"}</div>
        <div>SuspendedAt: {user.suspendedAt ? new Date(user.suspendedAt).toLocaleString() : "—"} Expires: {user.suspensionExpiresAt ? new Date(user.suspensionExpiresAt).toLocaleString() : "—"}</div>
        <div>Restrictions: {JSON.stringify(user.restrictions || {})}</div>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Enforce</h3>
        <div className="flex flex-wrap gap-2 mb-2">
          <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="warning">warning</option>
            <option value="content_removal">content_removal</option>
            <option value="posting_restriction">posting_restriction</option>
            <option value="comment_restriction">comment_restriction</option>
            <option value="messaging_restriction">messaging_restriction</option>
            <option value="event_creation_restriction">event_creation_restriction</option>
            <option value="temporary_suspension">temporary_suspension</option>
            <option value="permanent_ban">permanent_ban</option>
          </select>
          <Input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="Days" className="w-20" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 5 chars)" className="flex-1 min-w-[200px]" />
          <Button onClick={enforce} disabled={enforcing}>{enforcing ? "Enforcing…" : "Enforce"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">Bans revoke sessions (tokenVersion++), disconnect sockets, record audit, notify via existing mechanism. Never permanent ban solely for many reports — review required.</p>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Enforcements ({data.enforcements?.length})</h3>
        <div className="space-y-1">
          {data.enforcements?.map((e: any) => (
            <div key={e._id} className="flex justify-between border-b py-1 text-xs">
              <span>{e.actionType} {e.status} — {e.reason?.slice(0,80)} {e.expiresAt ? `(expires ${new Date(e.expiresAt).toLocaleDateString()})` : "(permanent)"}</span>
              <span className="flex gap-2"><span>{new Date(e.createdAt).toLocaleDateString()}</span>{e.status === "active" && <button onClick={() => reverse(e._id)} className="text-primary hover:underline">Reverse</button>}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Reports ({data.reports?.length})</h3>
        <div className="space-y-1">
          {data.reports?.map((r: any) => (
            <div key={r._id} className="border-b py-1 text-xs">{r.contentType} {r.reason} {r.status} — {r.details?.slice(0,80)}</div>
          ))}
        </div>
      </Card>

      <Card className="p-4 text-sm">
        <h3 className="font-semibold mb-2">Cases ({data.cases?.length})</h3>
        <div className="space-y-1">
          {data.cases?.map((c: any) => (
            <div key={c._id} className="border-b py-1 text-xs">{c._id.slice(-6)} {c.status} {c.severity} {c.priority}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}
