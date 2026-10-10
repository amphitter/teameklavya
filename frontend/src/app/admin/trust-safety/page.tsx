"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ShieldAlert, Flag, Users, Ban, Eye, Clock, AlertTriangle, Search, Loader2, Check, X, MessageSquare, Globe, FileText } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";

export default function TrustSafetyDashboard() {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "reports" | "cases" | "enforcements" | "ip" | "audit">("overview");
  const [reports, setReports] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [enforcements, setEnforcements] = useState<any[]>([]);
  const [ipRestrictions, setIpRestrictions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [searchUser, setSearchUser] = useState("");
  const [userResults, setUserResults] = useState<any[]>([]);
  const [userLoading, setUserLoading] = useState(false);

  const loadOverview = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get("/admin/moderation/overview");
      setOverview(res.data?.overview);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    try {
      const res = await api.get("/admin/moderation/reports/list?limit=20");
      setReports(res.data?.reports || []);
    } catch {
      toast.error("Failed to load reports");
    }
  };

  const loadCases = async () => {
    try {
      const res = await api.get("/admin/moderation/cases?limit=20");
      setCases(res.data?.cases || []);
    } catch {
      toast.error("Failed to load cases");
    }
  };

  const loadEnforcements = async () => {
    try {
      const res = await api.get("/admin/moderation/enforcements?limit=20");
      setEnforcements(res.data?.enforcements || []);
    } catch {
      toast.error("Failed to load enforcements");
    }
  };

  const loadIp = async () => {
    try {
      const res = await api.get("/admin/moderation/ip?limit=20");
      setIpRestrictions(res.data?.restrictions || []);
    } catch {
      toast.error("Failed to load IP restrictions");
    }
  };

  const loadAudit = async () => {
    try {
      const res = await api.get("/admin/moderation/audit?limit=20");
      setAuditLogs(res.data?.logs || []);
    } catch {
      toast.error("Failed to load audit logs");
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    if (activeTab === "reports") loadReports();
    if (activeTab === "cases") loadCases();
    if (activeTab === "enforcements") loadEnforcements();
    if (activeTab === "ip") loadIp();
    if (activeTab === "audit") loadAudit();
  }, [activeTab]);

  const searchUsers = async () => {
    if (!searchUser.trim()) return;
    setUserLoading(true);
    try {
      const res = await api.get(`/admin/moderation/users/search?q=${encodeURIComponent(searchUser)}&limit=10`);
      setUserResults(res.data?.users || []);
    } catch {
      toast.error("User search failed");
    } finally {
      setUserLoading(false);
    }
  };

  if (loading) return <PageLoader label="Loading Trust & Safety…" />;
  if (error) return <ErrorState title="Couldn't load dashboard" onRetry={loadOverview} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ShieldAlert className="h-6 w-6 text-destructive" /> Trust & Safety</h1>
        <p className="text-sm text-muted-foreground">Reports, moderation cases, enforcement, IP restrictions, audit logs. All privileged endpoints validate Super Admin server-side.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {[
          { id: "overview", label: "Overview", icon: Eye },
          { id: "reports", label: "Reports", icon: Flag },
          { id: "cases", label: "Cases", icon: FileText },
          { id: "enforcements", label: "Enforcements", icon: Ban },
          { id: "ip", label: "Network", icon: Globe },
          { id: "audit", label: "Audit", icon: Clock },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold ${activeTab === tab.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
            <tab.icon className="h-3.5 w-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && overview && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending reports</div><div className="text-2xl font-bold">{overview.pendingReports}</div></Card>
            <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">High priority cases</div><div className="text-2xl font-bold text-amber-600">{overview.highPriorityCases}</div></Card>
            <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Active suspensions</div><div className="text-2xl font-bold">{overview.activeSuspensions}</div></Card>
            <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Permanent bans</div><div className="text-2xl font-bold text-destructive">{overview.permanentBans}</div></Card>
            <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Content awaiting review</div><div className="text-2xl font-bold">{overview.pendingContent}</div></Card>
            <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">IP restrictions</div><div className="text-2xl font-bold">{overview.ipRestrictions}</div></Card>
          </div>

          <Card className="p-4">
            <h3 className="font-semibold text-sm mb-3">Recent enforcement actions</h3>
            <div className="space-y-2">
              {overview.recentActions?.length === 0 ? <p className="text-xs text-muted-foreground">No recent actions</p> : overview.recentActions?.map((a: any) => (
                <div key={a._id} className="flex justify-between items-center text-xs border-b pb-1">
                  <span><span className="font-medium">{a.actionType}</span> on {a.targetUser?.username || a.targetUser?.email} — {a.reason?.slice(0, 60)}</span>
                  <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-sm mb-3">Repeat violation trends (7 days)</h3>
            <div className="flex flex-wrap gap-2">
              {overview.repeatTrends?.map((t: any) => (
                <Badge key={t._id} variant="outline">{t._id}: {t.count}</Badge>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-sm mb-3">User enforcement search</h3>
            <div className="flex gap-2">
              <Input value={searchUser} onChange={(e) => setSearchUser(e.target.value)} placeholder="Username, email, name…" className="flex-1" />
              <Button onClick={searchUsers} disabled={userLoading}>{userLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</Button>
            </div>
            <div className="mt-3 space-y-2">
              {userResults.map((u: any) => (
                <div key={u._id} className="flex justify-between items-center rounded-lg border p-2.5 text-sm">
                  <div><div className="font-medium">{u.firstName} {u.lastName} @{u.username}</div><div className="text-xs text-muted-foreground">{u.email} • violations: {u.violationCount} warnings: {u.warningCount} {u.bannedAt ? "• BANNED" : u.suspendedAt ? "• SUSPENDED" : ""}</div></div>
                  <Link href={`/admin/trust-safety/users/${u._id}`} className="text-xs font-medium text-primary hover:underline">Inspect</Link>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {activeTab === "reports" && (
        <div className="space-y-3">
          {reports.length === 0 ? <EmptyState icon={Flag} title="No reports" description="No open reports" /> : reports.map((r: any) => (
            <Card key={r._id} className="p-4 text-sm">
              <div className="flex justify-between"><span className="font-semibold">{r.contentType} {r.reason} <Badge variant="outline">{r.priority}</Badge> <Badge variant="outline">{r.status}</Badge></span><span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span></div>
              <div className="mt-1 text-xs text-muted-foreground">Reporter: {r.reporter?.username} • Target: {r.targetUser?.username || r.contentId} • {r.details?.slice(0, 100)}</div>
              <div className="mt-2 flex gap-2"><Link href={`/admin/trust-safety/reports/${r._id}`} className="text-xs text-primary hover:underline">View</Link></div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "cases" && (
        <div className="space-y-3">
          {cases.length === 0 ? <EmptyState icon={FileText} title="No cases" /> : cases.map((c: any) => (
            <Card key={c._id} className="p-4 text-sm">
              <div className="flex justify-between"><span className="font-semibold">Case {c._id.slice(-6)} — {c.severity} {c.priority} <Badge variant="outline">{c.status}</Badge></span><span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span></div>
              <div className="text-xs text-muted-foreground">Target: {c.targetUser?.username || "—"} • Reports: {c.reports?.length} • Assigned: {c.assignedTo?.username || "unassigned"}</div>
              <Link href={`/admin/trust-safety/cases/${c._id}`} className="mt-2 inline-block text-xs text-primary hover:underline">View case</Link>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "enforcements" && (
        <div className="space-y-3">
          {enforcements.map((e: any) => (
            <Card key={e._id} className="p-4 text-sm">
              <div className="flex justify-between"><span className="font-semibold">{e.actionType} — {e.policyCategory} <Badge variant="outline">{e.status}</Badge></span><span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span></div>
              <div className="text-xs text-muted-foreground">User: {e.targetUser?.username} • Reason: {e.reason?.slice(0, 100)} {e.expiresAt ? `• Expires: ${new Date(e.expiresAt).toLocaleDateString()}` : "• Permanent"}</div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "ip" && (
        <div className="space-y-3">
          {ipRestrictions.map((ip: any) => (
            <Card key={ip._id} className="p-4 text-sm">
              <div className="flex justify-between"><span className="font-mono font-semibold">{ip.ip}</span><Badge variant={ip.active ? "destructive" : "outline"}>{ip.active ? "active" : "expired"}</Badge></div>
              <div className="text-xs text-muted-foreground">{ip.reason} • {ip.category} • Expires: {new Date(ip.expiresAt).toLocaleString()} • Source: {ip.source}</div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "audit" && (
        <div className="space-y-3">
          {auditLogs.map((log: any) => (
            <Card key={log._id} className="p-3 text-xs">
              <div className="flex justify-between"><span className="font-semibold">{log.action} on {log.targetType} {String(log.targetId).slice(-6)}</span><span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span></div>
              <div className="text-muted-foreground">Actor: {log.actor?.username} • Reason: {log.reason?.slice(0, 100)} • {log.policyCategory}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
