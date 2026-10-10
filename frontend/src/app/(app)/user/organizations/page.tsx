"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2,
  Check,
  ChevronLeft,
  Clock,
  FileText,
  Loader2,
  Plus,
  Search,
  Shield,
  X,
  Upload,
  ExternalLink,
  AlertTriangle,
  Info,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";

type Category =
  | "COLLEGE"
  | "UNIVERSITY"
  | "SCHOOL"
  | "AFFILIATED_CLUB"
  | "INSTITUTE"
  | "NON_PROFIT"
  | "COMMUNITY_GROUP"
  | "OTHER";

const CATEGORIES: { value: Category; label: string; desc: string }[] = [
  { value: "COLLEGE", label: "College", desc: "Degree-granting college" },
  { value: "UNIVERSITY", label: "University", desc: "University" },
  { value: "SCHOOL", label: "School", desc: "K-12 school" },
  { value: "INSTITUTE", label: "Institute", desc: "Training / research institute" },
  { value: "AFFILIATED_CLUB", label: "Affiliated Club", desc: "Club under a college/university" },
  { value: "NON_PROFIT", label: "Non-Profit", desc: "Registered non-profit" },
  { value: "COMMUNITY_GROUP", label: "Community Group", desc: "Community organization" },
  { value: "OTHER", label: "Other", desc: "Other organization type" },
];

type RequestStatus = "DRAFT" | "PENDING_REVIEW" | "NEEDS_INFORMATION" | "APPROVED" | "REJECTED" | "WITHDRAWN";

interface OrgRequest {
  _id: string;
  category: Category;
  proposedName: string;
  proposedSlug: string;
  description: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  status: RequestStatus;
  parentOrganizationId?: { _id: string; name: string; slug: string } | string | null;
  resultingOrganizationId?: { _id: string; name: string; slug: string; handle: string } | string | null;
  evidence?: any;
  rejectionReason?: string;
  infoRequestMessage?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

interface ParentOrg {
  _id: string;
  name: string;
  slug: string;
  city?: string;
  category: string;
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  NEEDS_INFORMATION: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  WITHDRAWN: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function statusLabel(s: string) {
  return s.replace(/_/g, " ");
}

export default function UserOrganizationsPage() {
  const [requests, setRequests] = useState<OrgRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OrgRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [parentSearch, setParentSearch] = useState("");
  const [parentResults, setParentResults] = useState<ParentOrg[]>([]);
  const [parentLoading, setParentLoading] = useState(false);
  const [selectedParent, setSelectedParent] = useState<ParentOrg | null>(null);

  // Form state
  const [form, setForm] = useState<any>({
    category: "COLLEGE",
    proposedName: "",
    proposedSlug: "",
    description: "",
    website: "",
    email: "",
    phone: "",
    addressLine: "",
    city: "",
    state: "",
    country: "",
    postalCode: "",
    logoUrl: "",
    coverUrl: "",
    evidence: {
      officialWebsite: "",
      officialEmail: "",
      authorizationLetterUrl: "",
      registrationCertificateUrl: "",
      affiliationLetterUrl: "",
      collegeWebsiteListingUrl: "",
      notes: "",
    },
    proposedParent: {
      name: "",
      website: "",
      email: "",
      city: "",
      country: "",
      description: "",
    },
    applicantRole: "",
    designation: "",
    declarationAccepted: false,
    status: "PENDING_REVIEW",
  });

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get("/organization-registration-requests/mine?limit=50");
      setRequests(res.data?.requests || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const searchParents = async (q: string) => {
    if (!q.trim()) {
      setParentResults([]);
      return;
    }
    setParentLoading(true);
    try {
      const res = await api.get(`/organization-registration-requests/parent-institutions?search=${encodeURIComponent(q)}&limit=10`);
      setParentResults(res.data?.organizations || []);
    } catch {
      setParentResults([]);
    } finally {
      setParentLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (parentSearch) searchParents(parentSearch);
    }, 300);
    return () => clearTimeout(t);
  }, [parentSearch]);

  const resetForm = () => {
    setForm({
      category: "COLLEGE",
      proposedName: "",
      proposedSlug: "",
      description: "",
      website: "",
      email: "",
      phone: "",
      addressLine: "",
      city: "",
      state: "",
      country: "",
      postalCode: "",
      logoUrl: "",
      coverUrl: "",
      evidence: {
        officialWebsite: "",
        officialEmail: "",
        authorizationLetterUrl: "",
        registrationCertificateUrl: "",
        affiliationLetterUrl: "",
        collegeWebsiteListingUrl: "",
        notes: "",
      },
      proposedParent: {
        name: "",
        website: "",
        email: "",
        city: "",
        country: "",
        description: "",
      },
      applicantRole: "",
      designation: "",
      declarationAccepted: false,
      status: "PENDING_REVIEW",
    });
    setSelectedParent(null);
    setParentSearch("");
    setParentResults([]);
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (req: OrgRequest) => {
    setEditing(req);
    setForm({
      category: req.category,
      proposedName: req.proposedName,
      proposedSlug: req.proposedSlug,
      description: req.description,
      website: req.website || "",
      email: (req as any).email || "",
      phone: (req as any).phone || "",
      addressLine: (req as any).addressLine || "",
      city: req.city || "",
      state: (req as any).state || "",
      country: req.country || "",
      postalCode: (req as any).postalCode || "",
      logoUrl: (req as any).logoUrl || "",
      coverUrl: (req as any).coverUrl || "",
      evidence: {
        officialWebsite: req.evidence?.officialWebsite || "",
        officialEmail: req.evidence?.officialEmail || "",
        authorizationLetterUrl: req.evidence?.authorizationLetterUrl || "",
        registrationCertificateUrl: req.evidence?.registrationCertificateUrl || "",
        affiliationLetterUrl: req.evidence?.affiliationLetterUrl || "",
        collegeWebsiteListingUrl: req.evidence?.collegeWebsiteListingUrl || "",
        notes: req.evidence?.notes || "",
      },
      proposedParent: {
        name: (req as any).proposedParent?.name || "",
        website: (req as any).proposedParent?.website || "",
        email: (req as any).proposedParent?.email || "",
        city: (req as any).proposedParent?.city || "",
        country: (req as any).proposedParent?.country || "",
        description: (req as any).proposedParent?.description || "",
      },
      applicantRole: (req as any).applicantRole || "",
      designation: (req as any).designation || "",
      declarationAccepted: (req as any).declarationAccepted || false,
      status: req.status,
    });
    if (req.parentOrganizationId && typeof req.parentOrganizationId === "object") {
      setSelectedParent(req.parentOrganizationId as any);
    }
    setShowForm(true);
  };

  const handleUpload = async (file: File | undefined, field: string) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be 5MB or smaller");
      return;
    }
    setUploading(field);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/upload/image?folder=org-requests", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success && res.data.url) {
        if (field.startsWith("evidence.")) {
          const evField = field.split(".")[1];
          setForm((f: any) => ({ ...f, evidence: { ...f.evidence, [evField]: res.data.url } }));
        } else if (field.startsWith("proposedParent.")) {
          // not uploading for proposed parent
        } else {
          setForm((f: any) => ({ ...f, [field]: res.data.url }));
        }
        toast.success("Uploaded");
      } else {
        toast.error("Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const submitForm = async (asDraft: boolean) => {
    if (!asDraft) {
      if (!form.proposedName.trim() || form.proposedName.trim().length < 3) {
        toast.error("Organization name must be at least 3 characters");
        return;
      }
      if (!form.description.trim() || form.description.trim().length < 20) {
        toast.error("Description must be at least 20 characters");
        return;
      }
      if (form.category === "AFFILIATED_CLUB" && !selectedParent && !form.proposedParent?.name?.trim()) {
        toast.error("Affiliated clubs require a parent institution - select existing or propose new");
        return;
      }
      if (!form.declarationAccepted) {
        toast.error("You must accept the declaration");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: any = {
        ...form,
        parentOrganizationId: selectedParent?._id || null,
        status: asDraft ? "DRAFT" : "PENDING_REVIEW",
        declarationAccepted: asDraft ? form.declarationAccepted : true,
      };

      // Generate idempotency key for create
      const idempotencyKey = `org-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      let res;
      if (editing) {
        res = await api.patch(`/organization-registration-requests/${editing._id}`, payload);
      } else {
        res = await api.post("/organization-registration-requests", payload, {
          headers: { "Idempotency-Key": idempotencyKey },
        });
      }

      if (res.data?.success) {
        toast.success(editing ? "Request updated" : asDraft ? "Draft saved" : "Request submitted for review");
        setShowForm(false);
        resetForm();
        load();
      } else {
        toast.error(res.data?.message || "Failed to save");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to save request");
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, action: "submit" | "withdraw" | "resubmit") => {
    try {
      let res;
      if (action === "submit") {
        res = await api.post(`/organization-registration-requests/${id}/submit`);
      } else if (action === "withdraw") {
        if (!confirm("Withdraw this request? You can resubmit later if needed.")) return;
        res = await api.post(`/organization-registration-requests/${id}/withdraw`);
      } else if (action === "resubmit") {
        res = await api.post(`/organization-registration-requests/${id}/resubmit`, {});
      }
      if (res?.data?.success) {
        toast.success(`Request ${action} successful`);
        load();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || `Failed to ${action}`);
    }
  };

  if (loading) return <PageLoader label="Loading your organization requests…" />;
  if (error) return <ErrorState title="Couldn't load requests" onRetry={load} />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <Link
          href="/user/settings"
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
              <Building2 className="h-5 w-5 text-primary" /> Organization Requests
            </h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-[60ch]">
              Request an official college, university, or affiliated club. Super Admins review your evidence. Approved organizations get an OWNER membership for you — no platform admin privileges.
            </p>
          </div>
          <Button onClick={openCreate} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" /> New request
          </Button>
        </div>
      </div>

      {/* Info card */}
      <Card className="border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
        <div className="flex gap-3">
          <Info className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="space-y-1 text-[13px] text-blue-900 dark:text-blue-100">
            <p className="font-semibold">How it works</p>
            <ul className="list-disc pl-4 space-y-0.5 text-blue-800/80 dark:text-blue-200/80">
              <li>Submit with official website, authorization letter, and declaration.</li>
              <li>For affiliated clubs, select your parent college/university or propose a new parent.</li>
              <li>Requests are reviewed — you’ll be notified if more info is needed.</li>
              <li>Approval creates exactly one organization and makes you OWNER via membership. It does NOT verify the org — verification is separate.</li>
            </ul>
          </div>
        </div>
      </Card>

      {requests.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organization requests yet"
          description="Create your first request to get your college or club on EventHub as an official organization."
          actionLabel="Create request"
          onAction={openCreate}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Card key={req._id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[15px] font-bold">{req.proposedName}</h3>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[req.status]}`}>
                      {statusLabel(req.status)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{req.category.replace(/_/g, " ")}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{req.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(req.createdAt).toLocaleDateString()}</span>
                    {req.city && <span>• {req.city}{req.country ? `, ${req.country}` : ""}</span>}
                    {req.website && (
                      <a href={req.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> Website
                      </a>
                    )}
                  </div>
                  {req.status === "REJECTED" && req.rejectionReason && (
                    <div className="mt-2 rounded-lg bg-red-50 p-2.5 text-[12px] text-red-800 dark:bg-red-950/30 dark:text-red-200">
                      <span className="font-semibold">Rejected:</span> {req.rejectionReason}
                    </div>
                  )}
                  {req.status === "NEEDS_INFORMATION" && req.infoRequestMessage && (
                    <div className="mt-2 rounded-lg bg-blue-50 p-2.5 text-[12px] text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                      <span className="font-semibold">Info requested:</span> {req.infoRequestMessage}
                    </div>
                  )}
                  {req.status === "APPROVED" && req.resultingOrganizationId && typeof req.resultingOrganizationId === "object" && (
                    <div className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-[12px] text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
                      Approved →{" "}
                      <Link href={`/organizations/${(req.resultingOrganizationId as any).slug || (req.resultingOrganizationId as any).handle}`} className="font-semibold underline">
                        {(req.resultingOrganizationId as any).name}
                      </Link>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                  {req.status === "DRAFT" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(req)}>Edit</Button>
                      <Button size="sm" onClick={() => handleAction(req._id, "submit")}>Submit</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleAction(req._id, "withdraw")}>Withdraw</Button>
                    </>
                  )}
                  {req.status === "PENDING_REVIEW" && (
                    <Button size="sm" variant="outline" onClick={() => handleAction(req._id, "withdraw")}>Withdraw</Button>
                  )}
                  {req.status === "NEEDS_INFORMATION" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(req)}>Update & Resubmit</Button>
                      <Button size="sm" onClick={() => handleAction(req._id, "resubmit")}>Resubmit</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleAction(req._id, "withdraw")}>Withdraw</Button>
                    </>
                  )}
                  {req.status === "REJECTED" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(req)}>Edit</Button>
                      <Button size="sm" onClick={() => handleAction(req._id, "resubmit")}>Resubmit</Button>
                    </>
                  )}
                  {req.status === "WITHDRAWN" && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(req)}>Edit draft</Button>
                  )}
                  <Link href={`/user/organizations/${req._id}`} className="inline-flex min-h-9 items-center justify-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent">
                    View detail
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit organization request" : "New organization request"}</DialogTitle>
            <p className="text-xs text-muted-foreground">Fields marked * are required. Evidence helps Super Admins approve faster.</p>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Category */}
            <div className="space-y-2">
              <Label>Category *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f: any) => ({ ...f, category: c.value }))}
                    className={`rounded-xl border p-3 text-left transition-colors ${form.category === c.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"}`}
                  >
                    <div className="text-[13px] font-semibold">{c.label}</div>
                    <div className="text-[11px] text-muted-foreground">{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Basic */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Organization name * (3-120 chars)</Label>
                <Input value={form.proposedName} onChange={(e) => setForm((f: any) => ({ ...f, proposedName: e.target.value }))} placeholder="e.g. Delhi Technological University Coding Club" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label>Desired slug (optional, auto-generated)</Label>
                <Input value={form.proposedSlug} onChange={(e) => setForm((f: any) => ({ ...f, proposedSlug: e.target.value }))} placeholder="dtu-coding-club" />
              </div>
              <div className="space-y-1.5">
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => setForm((f: any) => ({ ...f, website: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Description * (min 20 chars)</Label>
                <textarea value={form.description} onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))} rows={4} maxLength={1000} placeholder="What does this organization do? Official affiliation, activities, etc." className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10" />
                <div className="text-[11px] text-muted-foreground">{form.description.length}/1000</div>
              </div>
            </div>

            {/* Contact */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Contact email</Label>
                <Input value={form.email} onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} placeholder="official@college.edu" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm((f: any) => ({ ...f, phone: e.target.value }))} placeholder="+91..." />
              </div>
              <div className="space-y-1.5">
                <Label>Address line</Label>
                <Input value={form.addressLine} onChange={(e) => setForm((f: any) => ({ ...f, addressLine: e.target.value }))} placeholder="Street, building" />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm((f: any) => ({ ...f, city: e.target.value }))} placeholder="Delhi" />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => setForm((f: any) => ({ ...f, state: e.target.value }))} placeholder="Delhi" />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input value={form.country} onChange={(e) => setForm((f: any) => ({ ...f, country: e.target.value }))} placeholder="India" />
              </div>
              <div className="space-y-1.5">
                <Label>Postal code</Label>
                <Input value={form.postalCode} onChange={(e) => setForm((f: any) => ({ ...f, postalCode: e.target.value }))} placeholder="110042" />
              </div>
            </div>

            {/* Logos */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Logo URL</Label>
                <div className="flex gap-2">
                  <Input value={form.logoUrl} onChange={(e) => setForm((f: any) => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." className="flex-1" />
                  <label className="cursor-pointer inline-flex items-center justify-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
                    {uploading === "logoUrl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "logoUrl")} />
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Cover URL</Label>
                <div className="flex gap-2">
                  <Input value={form.coverUrl} onChange={(e) => setForm((f: any) => ({ ...f, coverUrl: e.target.value }))} placeholder="https://..." className="flex-1" />
                  <label className="cursor-pointer inline-flex items-center justify-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
                    {uploading === "coverUrl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "coverUrl")} />
                  </label>
                </div>
              </div>
            </div>

            {/* Parent for affiliated club */}
            {form.category === "AFFILIATED_CLUB" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                  <Building2 className="h-4 w-4" /> Parent institution required for affiliated clubs
                </div>
                <div className="space-y-2">
                  <Label>Search existing parent (college/university)</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input value={parentSearch} onChange={(e) => setParentSearch(e.target.value)} placeholder="Search colleges, universities…" className="pl-8" />
                    </div>
                    {selectedParent && (
                      <Button variant="outline" size="sm" onClick={() => setSelectedParent(null)} className="shrink-0">
                        <X className="h-3.5 w-3.5" /> Clear
                      </Button>
                    )}
                  </div>
                  {selectedParent && (
                    <div className="rounded-lg bg-white border p-2.5 text-sm dark:bg-zinc-900">
                      <div className="font-semibold">{selectedParent.name}</div>
                      <div className="text-xs text-muted-foreground">{selectedParent.city} • {selectedParent.category} • {selectedParent.slug}</div>
                    </div>
                  )}
                  {parentLoading && <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Searching…</div>}
                  {!selectedParent && parentResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border bg-card divide-y">
                      {parentResults.map((org) => (
                        <button key={org._id} type="button" onClick={() => { setSelectedParent(org); setParentResults([]); setParentSearch(""); }} className="w-full text-left p-2.5 hover:bg-muted text-sm">
                          <div className="font-medium">{org.name}</div>
                          <div className="text-xs text-muted-foreground">{org.city} • {org.category}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pt-2 border-t border-amber-200/50 dark:border-amber-900/30 space-y-2">
                  <Label>Or propose new parent institution</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={form.proposedParent.name} onChange={(e) => setForm((f: any) => ({ ...f, proposedParent: { ...f.proposedParent, name: e.target.value } }))} placeholder="Parent name" />
                    <Input value={form.proposedParent.website} onChange={(e) => setForm((f: any) => ({ ...f, proposedParent: { ...f.proposedParent, website: e.target.value } }))} placeholder="Parent website https://..." />
                    <Input value={form.proposedParent.email} onChange={(e) => setForm((f: any) => ({ ...f, proposedParent: { ...f.proposedParent, email: e.target.value } }))} placeholder="Parent email" />
                    <Input value={form.proposedParent.city} onChange={(e) => setForm((f: any) => ({ ...f, proposedParent: { ...f.proposedParent, city: e.target.value } }))} placeholder="City" />
                    <Input value={form.proposedParent.country} onChange={(e) => setForm((f: any) => ({ ...f, proposedParent: { ...f.proposedParent, country: e.target.value } }))} placeholder="Country" />
                  </div>
                  <Input value={form.proposedParent.description} onChange={(e) => setForm((f: any) => ({ ...f, proposedParent: { ...f.proposedParent, description: e.target.value } }))} placeholder="Parent description" />
                </div>
              </div>
            )}

            {/* Evidence */}
            <div className="space-y-3 rounded-xl border p-4">
              <h4 className="text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Evidence (helps approval)</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Official website</Label>
                  <Input value={form.evidence.officialWebsite} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, officialWebsite: e.target.value } }))} placeholder="https://college.edu" />
                </div>
                <div className="space-y-1.5">
                  <Label>Official email</Label>
                  <Input value={form.evidence.officialEmail} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, officialEmail: e.target.value } }))} placeholder="admin@college.edu" />
                </div>
                <div className="space-y-1.5">
                  <Label>Authorization letter URL</Label>
                  <div className="flex gap-2">
                    <Input value={form.evidence.authorizationLetterUrl} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, authorizationLetterUrl: e.target.value } }))} placeholder="https://..." className="flex-1" />
                    <label className="cursor-pointer inline-flex items-center justify-center rounded-md border px-3 text-xs hover:bg-accent">
                      {uploading === "evidence.authorizationLetterUrl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "evidence.authorizationLetterUrl")} />
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Registration certificate URL</Label>
                  <div className="flex gap-2">
                    <Input value={form.evidence.registrationCertificateUrl} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, registrationCertificateUrl: e.target.value } }))} placeholder="https://..." className="flex-1" />
                    <label className="cursor-pointer inline-flex items-center justify-center rounded-md border px-3 text-xs hover:bg-accent">
                      {uploading === "evidence.registrationCertificateUrl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "evidence.registrationCertificateUrl")} />
                    </label>
                  </div>
                </div>
                {form.category === "AFFILIATED_CLUB" && (
                  <div className="space-y-1.5">
                    <Label>Affiliation letter URL</Label>
                    <div className="flex gap-2">
                      <Input value={form.evidence.affiliationLetterUrl} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, affiliationLetterUrl: e.target.value } }))} placeholder="https://..." className="flex-1" />
                      <label className="cursor-pointer inline-flex items-center justify-center rounded-md border px-3 text-xs hover:bg-accent">
                        {uploading === "evidence.affiliationLetterUrl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "evidence.affiliationLetterUrl")} />
                      </label>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>College website listing URL</Label>
                  <Input value={form.evidence.collegeWebsiteListingUrl} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, collegeWebsiteListingUrl: e.target.value } }))} placeholder="https://college.edu/clubs/your-club" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Additional notes</Label>
                  <textarea value={form.evidence.notes} onChange={(e) => setForm((f: any) => ({ ...f, evidence: { ...f.evidence, notes: e.target.value } }))} rows={3} placeholder="Any additional context for reviewers…" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10" />
                </div>
              </div>
            </div>

            {/* Role */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Your role in organization</Label>
                <Input value={form.applicantRole} onChange={(e) => setForm((f: any) => ({ ...f, applicantRole: e.target.value }))} placeholder="e.g. President, Faculty Coordinator" />
              </div>
              <div className="space-y-1.5">
                <Label>Designation</Label>
                <Input value={form.designation} onChange={(e) => setForm((f: any) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Student, Professor" />
              </div>
            </div>

            {/* Declaration */}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 space-y-3">
              <div className="flex gap-2">
                <Shield className="h-5 w-5 text-zinc-700 dark:text-zinc-300 shrink-0" />
                <div className="text-[13px] leading-snug">
                  <div className="font-semibold">Declaration</div>
                  <p className="text-muted-foreground mt-1">
                    I confirm that the information provided is accurate, I am authorized to represent this organization, and I understand that submitting false information may result in rejection and potential account action. Approved organizations are initially UNVERIFIED — verification requires separate authorized review.
                  </p>
                </div>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={form.declarationAccepted} onChange={(e) => setForm((f: any) => ({ ...f, declarationAccepted: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-input" />
                <span className="text-[13px] font-medium">I accept the declaration above *</span>
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
              <Button variant="ghost" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              <Button variant="outline" disabled={saving} onClick={() => submitForm(true)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save as draft
              </Button>
              <Button disabled={saving} onClick={() => submitForm(false)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {editing ? "Update & Submit" : "Submit for review"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
