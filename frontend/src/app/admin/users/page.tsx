"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BadgeCheck, Download, Mail, Search, Shield, Users } from "lucide-react";

interface AdminUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  profile?: { institution?: string; course?: string; year?: string };
}

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "participant">("all");
  const [exporting, setExporting] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get("/admin/users")
      .then((res) => setUsers(res.data?.users || []))
      .catch((err) => setError(err.response?.data?.message || "Failed to load users"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      const inst = (u.profile?.institution || "").toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q) || inst.includes(q);
    });
  }, [users, query, roleFilter]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get("/admin/users/export", { responseType: "blob" });
      const url = URL.createObjectURL(
        res.data instanceof Blob ? res.data : new Blob([res.data], { type: "text/csv" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `eventhub-users-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <PageLoader label="Loading users…" />;
  if (error) return <ErrorState title="Couldn't load users" description={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">
            {users.length} {users.length === 1 ? "person" : "people"} on EventHub
          </p>
        </div>
        <Button onClick={exportCsv} disabled={exporting || users.length === 0}>
          <Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or institution…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "participant", "admin"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={cn(
                "rounded-lg border px-3.5 py-2 text-xs font-semibold capitalize transition-colors",
                roleFilter === r
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {r === "all" ? "Everyone" : `${r}s`}
            </button>
          ))}
        </div>
      </div>

      {users.length === 0 ? (
        <EmptyState icon={Users} title="No users yet" description="User accounts will appear here as people sign up." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matches" description={`No users match your search.`} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1.4fr_1.4fr_0.9fr_0.8fr] gap-3 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Name</span>
            <span>Email</span>
            <span>Institution</span>
            <span>Role</span>
          </div>
          {filtered.map((u) => (
            <div
              key={u._id}
              className="grid grid-cols-1 items-center gap-2 border-b border-border px-4 py-3 last:border-0 transition-colors hover:bg-muted/40 sm:grid-cols-[1.4fr_1.4fr_0.9fr_0.8fr] sm:gap-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-primary">
                  {(u.firstName || "?")[0]}
                  {(u.lastName || "")[0] || ""}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {u.firstName} {u.lastName}
                    </span>
                    {u.emailVerified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-success" />}
                  </div>
                  <span className="text-[11px] text-muted-foreground sm:hidden">{u.email}</span>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{u.email}</span>
              </div>
              <div className="truncate text-sm text-muted-foreground">{u.profile?.institution || "—"}</div>
              <div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
                    u.role === "admin"
                      ? "border-purple/30 bg-purple-light text-purple"
                      : "border-border bg-muted text-muted-foreground"
                  )}
                >
                  {u.role === "admin" && <Shield className="h-3 w-3" />}
                  {u.role}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
