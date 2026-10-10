"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/states";
import { ImageCropEditor } from "@/components/media/image-crop-editor";
import { Building2, Upload, MapPin, Globe, Plus, X } from "lucide-react";

export default function EditOrganizationPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<any>(null);
  const [form, setForm] = useState({
    description: "",
    website: "",
    city: "",
    state: "",
    country: "",
    address: "",
    postalCode: "",
    email: "",
    phone: "",
    mapUrl: "",
    socialLinks: {} as Record<string, string>,
    logoUrl: "",
    coverUrl: "",
    logoPreview: "",
    coverPreview: "",
    logoBlob: null as Blob | null,
    coverBlob: null as Blob | null,
  });
  const [logoCropSrc, setLogoCropSrc] = useState<string | null>(null);
  const [coverCropSrc, setCoverCropSrc] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [newSocialPlatform, setNewSocialPlatform] = useState("");
  const [newSocialUrl, setNewSocialUrl] = useState("");

  useEffect(() => {
    api.get(`/organizations/${slug}`).then((res) => {
      if (res.data?.organization) {
        const o = res.data.organization;
        setOrg(o);
        setForm({
          description: o.description || "",
          website: o.website || "",
          city: o.city || "",
          state: o.state || "",
          country: o.country || "",
          address: o.address || "",
          postalCode: o.postalCode || "",
          email: o.email || "",
          phone: o.phone || "",
          mapUrl: o.mapUrl || "",
          socialLinks: o.socialLinks && typeof o.socialLinks === "object" ? o.socialLinks : {},
          logoUrl: o.logo || o.logoUrl || "",
          coverUrl: o.cover || o.coverUrl || "",
          logoPreview: "",
          coverPreview: "",
          logoBlob: null,
          coverBlob: null,
        });
      }
    }).finally(() => setLoading(false));
  }, [slug]);

  const uploadBlob = async (blob: Blob) => {
    const fd = new FormData();
    fd.append("file", blob, "image.png");
    const res = await api.post(`/upload/image?folder=organizations`, fd, { headers: { "Content-Type": "multipart/form-data" } });
    if (res.data?.success && res.data.url) return res.data.url;
    throw new Error("Upload failed");
  };

  const handleSave = async () => {
    if (!org) return;
    setSaving(true);
    try {
      let logoUrl = form.logoUrl;
      let coverUrl = form.coverUrl;
      if (form.logoBlob) logoUrl = await uploadBlob(form.logoBlob);
      if (form.coverBlob) coverUrl = await uploadBlob(form.coverBlob);
      // Filter empty social links and validate basic https
      const filteredSocial: Record<string, string> = {};
      for (const [k, v] of Object.entries(form.socialLinks)) {
        const trimmed = String(v || "").trim();
        if (!trimmed) continue;
        filteredSocial[k.toLowerCase()] = trimmed;
      }
      const payload = {
        description: form.description,
        website: form.website,
        city: form.city,
        state: form.state,
        country: form.country,
        address: form.address,
        postalCode: form.postalCode,
        email: form.email,
        phone: form.phone,
        mapUrl: form.mapUrl,
        socialLinks: filteredSocial,
        logoUrl,
        coverUrl,
      };
      const res = await api.put(`/organizations/${org._id}`, payload);
      if (res.data?.success) {
        toast.success("Organization updated");
        router.push(`/organizations/${encodeURIComponent(org.handle || org.slug)}`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading…" />;
  if (!org) return <div className="p-6">Organization not found</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Edit {org.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Admin controls separated from public profile. Responsive, theme-aware.</p>

      <div className="mt-6 space-y-6 rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#121214] p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 1000) }))} rows={4} className="mt-1.5 w-full rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] px-3 py-2 text-sm" />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} className="mt-1.5" placeholder="https://" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="mt-1.5" />
          </div>
          <div className="sm:col-span-2">
            <Label>Street Address</Label>
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value.slice(0, 300) }))} className="mt-1.5" placeholder="Building, street" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value.slice(0, 120) }))} className="mt-1.5" />
          </div>
          <div>
            <Label>State</Label>
            <Input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.slice(0, 120) }))} className="mt-1.5" />
          </div>
          <div>
            <Label>Country</Label>
            <Input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.slice(0, 120) }))} className="mt-1.5" />
          </div>
          <div>
            <Label>Postal Code</Label>
            <Input value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value.slice(0, 32) }))} className="mt-1.5" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.slice(0, 40) }))} className="mt-1.5" />
          </div>
          <div>
            <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Map URL</Label>
            <Input value={form.mapUrl} onChange={(e) => setForm((f) => ({ ...f, mapUrl: e.target.value.slice(0, 2048) }))} className="mt-1.5" placeholder="https://www.google.com/maps/embed?..." />
            <p className="mt-1 text-[10px] text-muted-foreground">Only Google Maps, OpenStreetMap, Bing, Mapbox HTTPS links. Invalid will be rejected. Embed hidden if not embeddable.</p>
          </div>
        </div>

        {/* Social Links */}
        <div className="space-y-3 rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] p-4">
          <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Social Links (up to 12)</Label>
          <div className="space-y-2">
            {Object.entries(form.socialLinks).map(([platform, url]) => (
              <div key={platform} className="flex gap-2">
                <div className="w-28 shrink-0">
                  <Input value={platform} disabled className="bg-slate-100 dark:bg-[#1f1f23] text-[12px]" />
                </div>
                <Input value={url} onChange={(e) => setForm((f) => ({ ...f, socialLinks: { ...f.socialLinks, [platform]: e.target.value } }))} placeholder="https://..." className="flex-1 text-[12px]" />
                <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => setForm((f) => { const copy = { ...f.socialLinks }; delete copy[platform]; return { ...f, socialLinks: copy }; })}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {Object.keys(form.socialLinks).length < 12 && (
              <div className="flex gap-2 pt-2">
                <Input value={newSocialPlatform} onChange={(e) => setNewSocialPlatform(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32))} placeholder="platform e.g. instagram" className="w-28 text-[12px]" />
                <Input value={newSocialUrl} onChange={(e) => setNewSocialUrl(e.target.value)} placeholder="https://..." className="flex-1 text-[12px]" />
                <Button size="sm" variant="outline" className="h-9" onClick={() => {
                  const p = newSocialPlatform.trim().toLowerCase();
                  const u = newSocialUrl.trim();
                  if (!p || !u) { toast.error("Enter platform and URL"); return; }
                  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(p)) { toast.error("Invalid platform name"); return; }
                  setForm((f) => ({ ...f, socialLinks: { ...f.socialLinks, [p]: u } }));
                  setNewSocialPlatform("");
                  setNewSocialUrl("");
                }}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">Safe https URLs only. Backend validates via url-safety. Empty ignored.</p>
        </div>

        <div className="space-y-3">
          <Label>Logo – square crop (touch-friendly)</Label>
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-[10px] border bg-muted">
              {form.logoPreview || form.logoUrl ? <img src={form.logoPreview || form.logoUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center"><Building2 className="h-5 w-5 text-muted-foreground" /></div>}
            </div>
            <Button size="sm" variant="outline" onClick={() => logoRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> {form.logoPreview ? "Replace" : "Upload"}</Button>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const url = URL.createObjectURL(f); setLogoCropSrc(url); } }} />
        </div>

        <div className="space-y-3">
          <Label>Cover – landscape (touch-friendly)</Label>
          <div className="overflow-hidden rounded-[10px] border bg-muted aspect-[16/6]">
            {form.coverPreview || form.coverUrl ? <img src={form.coverPreview || form.coverUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No cover</div>}
          </div>
          <Button size="sm" variant="outline" onClick={() => coverRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> {form.coverPreview ? "Replace" : "Upload cover"}</Button>
          <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const url = URL.createObjectURL(f); setCoverCropSrc(url); } }} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      {logoCropSrc && (
        <ImageCropEditor imageSrc={logoCropSrc} aspect={1} title="Crop logo – square" onCancel={() => setLogoCropSrc(null)} onComplete={(blob, preview) => { setForm((f) => ({ ...f, logoBlob: blob, logoPreview: preview })); setLogoCropSrc(null); }} />
      )}
      {coverCropSrc && (
        <ImageCropEditor imageSrc={coverCropSrc} aspect={16/9} title="Crop cover – landscape" onCancel={() => setCoverCropSrc(null)} onComplete={(blob, preview) => { setForm((f) => ({ ...f, coverBlob: blob, coverPreview: preview })); setCoverCropSrc(null); }} />
      )}
    </div>
  );
}
