"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, ImagePlus, Loader2, Plus, Users } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { cloudinaryUrl } from "@/utils/image";

interface Org {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  website?: string;
  followerCount: number;
  upcomingEventCount: number;
}

const EMPTY = { name: "", description: "", website: "", logoUrl: "" };

/** Admin: manage organizations (communities) — create + edit. */
export default function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Org | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingLogoPublicId, setPendingLogoPublicId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(false);
    api
      .get("/organizations")
      .then((res) => setOrgs(res.data?.organizations || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setPendingLogoPublicId(null);
    setDialogOpen(true);
  };

  const openEdit = (org: Org) => {
    setEditing(org);
    setForm({ name: org.name, description: org.description || "", website: org.website || "", logoUrl: org.logoUrl || "" });
    setPendingLogoPublicId(null);
    setDialogOpen(true);
  };

  const onLogo = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be 5 MB or smaller");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/upload/image?folder=organizers", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success && res.data.url) {
        setForm((f) => ({ ...f, logoUrl: res.data.url }));
        setPendingLogoPublicId(res.data.publicId || null);
      } else {
        toast.error(res.data?.message || "Logo upload failed");
      }
    } catch {
      toast.error("Logo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const res = editing
        ? await api.put(`/organizations/${editing._id}`, form)
        : await api.post("/organizations", form);
      if (res.data?.success) {
        let logoAttached = true;
        const savedOrganizationId = res.data.organization?._id || editing?._id;
        if (pendingLogoPublicId) {
          if (!savedOrganizationId) logoAttached = false;
          else {
            try {
              await api.post("/upload/attach", {
                publicId: pendingLogoPublicId,
                attachedTo: `organization:${savedOrganizationId}:logo`,
              });
            } catch {
              logoAttached = false;
            }
          }
        }
        if (logoAttached) {
          toast.success(editing ? "Organization updated" : "Organization created");
          setPendingLogoPublicId(null);
          setDialogOpen(false);
          load();
        } else {
          toast.error("Organization saved, but logo tracking could not be confirmed. Save again to retry.");
        }
      } else {
        toast.error(res.data?.message || "Failed to save organization");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save organization");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Communities</h1>
          <p className="text-sm text-muted-foreground">
            Organizations hosting events on EventHub — attach them to events and post as them. Official colleges/universities are created via{" "}
            <a href="/admin/organizations/requests" className="font-semibold text-primary hover:underline">
              Organization Requests
            </a>{" "}
            review.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/admin/organizations/requests">View requests</a>
          </Button>
          <Button onClick={openCreate} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" /> New organization
          </Button>
        </div>
      </div>

      {loading ? (
        <PageLoader label="Loading organizations…" />
      ) : error ? (
        <ErrorState title="Couldn't load organizations" onRetry={load} />
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organizations yet"
          description="Create your college or club — its events and posts will live under one identity."
          actionLabel="Create organization"
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {orgs.map((org) => (
            <div key={org._id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-3.5">
                {org.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cloudinaryUrl(org.logoUrl, { w: 96, h: 96 })} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-light text-primary">
                    <Building2 className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-bold text-foreground">{org.name}</h2>
                  {org.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{org.description}</p>}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> {org.followerCount} followers · {org.upcomingEventCount} upcoming
                </span>
                <Button size="sm" variant="outline" onClick={() => openEdit(org)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit organization" : "New organization"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted">
                {form.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-xs font-semibold hover:bg-muted">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {form.logoUrl ? "Change logo" : "Upload logo"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => onLogo(e.target.files?.[0])}
                />
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. GITM Events" required />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="What does this community do?"
                className="flex w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://…" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.name.trim() || uploading}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
