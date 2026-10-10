"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  GraduationCap,
  UsersRound,
  Upload,
  X,
  Check,
  Info,
  Search,
  Loader2,
  Image as ImageIcon,
  Link2,
  Mail,
  MapPin,
  ShieldCheck,
  FileText,
  ArrowRight,
  Eye,
  Clock,
  CalendarDays,
} from "lucide-react";
import { ImageCropEditor } from "@/components/media/image-crop-editor";

type Category = "COLLEGE" | "UNIVERSITY" | "AFFILIATED_CLUB";
type Step = 1 | 2 | 3;

interface ParentOrg {
  _id: string;
  name: string;
  slug: string;
  city?: string;
  category: string;
}

const STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Chandigarh",
];

export default function RegisterOrganizationPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [parentResults, setParentResults] = useState<ParentOrg[]>([]);
  const [parentLoading, setParentLoading] = useState(false);
  const [selectedParent, setSelectedParent] = useState<ParentOrg | null>(null);

  const [form, setForm] = useState({
    category: "COLLEGE" as Category,
    proposedName: "",
    description: "",
    city: "Gurugram",
    state: "Haryana",
    address: "",
    country: "India",
    postalCode: "",
    phone: "",
    mapUrl: "",
    socialLinks: {} as Record<string, string>,
    website: "",
    email: "",
    logoUrl: "",
    coverUrl: "",
    logoPreview: "",
    coverPreview: "",
    logoBlob: null as Blob | null,
    coverBlob: null as Blob | null,
    evidence: {
      officialWebsite: "",
      officialEmail: "",
      notes: "",
    },
    declarationAccepted: false,
  });

  const [logoCropSrc, setLogoCropSrc] = useState<string | null>(null);
  const [coverCropSrc, setCoverCropSrc] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Parent search
  useEffect(() => {
    if (form.category !== "AFFILIATED_CLUB") return;
    if (!parentSearch.trim()) {
      setParentResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setParentLoading(true);
      try {
        const res = await api.get(
          `/organization-registration-requests/parent-institutions?search=${encodeURIComponent(parentSearch)}&limit=8`
        );
        setParentResults(res.data?.organizations || []);
      } catch {
        setParentResults([]);
      } finally {
        setParentLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [parentSearch, form.category]);

  const handleLogoFile = (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be 8MB or smaller");
      return;
    }
    const url = URL.createObjectURL(file);
    setLogoCropSrc(url);
  };

  const handleCoverFile = (file: File) => {
    if (file.size > 12 * 1024 * 1024) {
      toast.error("Cover must be 12MB or smaller");
      return;
    }
    const url = URL.createObjectURL(file);
    setCoverCropSrc(url);
  };

  const uploadBlob = async (blob: Blob, folder = "org-requests") => {
    const fd = new FormData();
    fd.append("file", blob, "image.png");
    const res = await api.post(`/upload/image?folder=${folder}`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    if (res.data?.success && res.data.url) return res.data.url as string;
    throw new Error("Upload failed");
  };

  const validateStep1 = () => {
    if (!form.proposedName.trim() || form.proposedName.trim().length < 3) {
      toast.error("Official name required (min 3 chars)");
      return false;
    }
    if (!form.description.trim() || form.description.trim().length < 10) {
      toast.error("Short description required (min 10 chars)");
      return false;
    }
    if (!form.city.trim()) {
      toast.error("City required");
      return false;
    }
    if (!form.state.trim()) {
      toast.error("State required");
      return false;
    }
    if (form.category === "AFFILIATED_CLUB" && !selectedParent) {
      toast.error("Select parent institution for affiliated club");
      return false;
    }
    return true;
  };

  const handleContinue = () => {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      let logoUrl = form.logoUrl;
      let coverUrl = form.coverUrl;
      if (form.logoBlob) logoUrl = await uploadBlob(form.logoBlob, "org-requests");
      if (form.coverBlob) coverUrl = await uploadBlob(form.coverBlob, "org-requests");

      const payload = {
        category: form.category,
        proposedName: form.proposedName,
        description: form.description,
        city: form.city,
        state: form.state,
        addressLine: form.address,
        country: form.country,
        postalCode: form.postalCode,
        phone: form.phone,
        mapUrl: form.mapUrl,
        socialLinks: Object.fromEntries(Object.entries(form.socialLinks).filter(([, v]) => String(v || "").trim())),
        website: form.website,
        email: form.email,
        logoUrl,
        coverUrl,
        parentOrganizationId: selectedParent?._id || null,
        evidence: form.evidence,
        declarationAccepted: false,
        status: "DRAFT",
      };
      const idempotencyKey = `org-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const res = await api.post("/organization-registration-requests", payload, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      if (res.data?.success) {
        toast.success("Draft saved");
        setForm((f) => ({ ...f, logoUrl, coverUrl, logoBlob: null, coverBlob: null }));
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to save draft");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.declarationAccepted) {
      toast.error("Accept declaration to submit");
      return;
    }
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      let logoUrl = form.logoUrl;
      let coverUrl = form.coverUrl;
      if (form.logoBlob) logoUrl = await uploadBlob(form.logoBlob, "org-requests");
      if (form.coverBlob) coverUrl = await uploadBlob(form.coverBlob, "org-requests");

      const payload = {
        category: form.category,
        proposedName: form.proposedName,
        description: form.description,
        city: form.city,
        state: form.state,
        addressLine: form.address,
        country: form.country,
        postalCode: form.postalCode,
        phone: form.phone,
        mapUrl: form.mapUrl,
        socialLinks: Object.fromEntries(Object.entries(form.socialLinks).filter(([, v]) => String(v || "").trim())),
        website: form.website,
        email: form.email,
        logoUrl,
        coverUrl,
        parentOrganizationId: selectedParent?._id || null,
        evidence: form.evidence,
        declarationAccepted: true,
        status: "PENDING_REVIEW",
      };
      const idempotencyKey = `org-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const res = await api.post("/organization-registration-requests", payload, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      if (res.data?.success) {
        toast.success("Organization submitted – pending verification");
        router.push("/user/organizations");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Submission failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#f8fafc] dark:bg-[#0a0a0c] text-slate-900 dark:text-white">
      <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
        {/* Header + Progress */}
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-slate-900 dark:text-white">Register an organization</h1>
            <p className="mt-1.5 text-[13px] text-slate-600 dark:text-[#a1a1aa]">Bring your institution or club to EventHub.</p>
          </div>

          {/* Progress – per reference */}
          <div className="flex items-center gap-3">
            {[
              { n: 1, label: "Basic details" },
              { n: 2, label: "Branding" },
              { n: 3, label: "Review & submit" },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-medium transition-colors ${
                      step >= s.n
                        ? "bg-[#3b82f6] text-slate-900 dark:text-white"
                        : "bg-slate-100 dark:bg-[#1f1f23] text-slate-500 dark:text-[#71717a] border border-slate-200 dark:border-[#232326]"
                    }`}
                  >
                    {step > s.n ? <Check className="h-4 w-4" /> : s.n}
                  </div>
                  <span
                    className={`text-[11px] font-medium ${
                      step === s.n ? "text-[#3b82f6]" : "text-slate-500 dark:text-[#71717a]"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < 2 && (
                  <div className={`h-px w-12 sm:w-16 mb-5 ${step > s.n ? "bg-[#3b82f6]" : "bg-[#232326]"}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Left – Form */}
          <div className="rounded-[12px] border border-slate-200 dark:border-[#1f1f23] bg-white dark:bg-[#121214]">
            {/* Organization details header */}
            <div className="border-b border-slate-200 dark:border-[#1f1f23] p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-slate-100 dark:bg-[#1f1f23] text-[#3b82f6]">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">Organization details</h2>
                  <p className="mt-0.5 text-[12px] text-slate-500 dark:text-[#71717a]">
                    Let&apos;s start with the basic information about your organization.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5">
              {step === 1 && (
                <div className="space-y-6">
                  {/* Entity type – per reference */}
                  <div>
                    <Label className="text-[13px] font-medium text-slate-900 dark:text-white">What type of organization are you registering?</Label>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, category: "COLLEGE" }))}
                        className={`relative rounded-[12px] border p-4 text-left transition-all ${
                          form.category === "COLLEGE" || form.category === "UNIVERSITY"
                            ? "border-[#3b82f6] bg-[#3b82f6]/5"
                            : "border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] hover:border-[#2a2a30]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${
                              form.category === "COLLEGE" || form.category === "UNIVERSITY"
                                ? "bg-[#3b82f6]/10 text-[#3b82f6]"
                                : "bg-slate-100 dark:bg-[#1f1f23] text-slate-500 dark:text-[#71717a]"
                            }`}
                          >
                            <GraduationCap className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[13px] font-semibold text-slate-900 dark:text-white">College / University</div>
                            <div className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-[#71717a]">
                              A recognized educational institution such as a college or university.
                            </div>
                          </div>
                          <div
                            className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                              form.category === "COLLEGE" || form.category === "UNIVERSITY"
                                ? "border-[#3b82f6] bg-[#3b82f6] text-slate-900 dark:text-white"
                                : "border-[#3a3a42]"
                            }`}
                          >
                            {(form.category === "COLLEGE" || form.category === "UNIVERSITY") && (
                              <Check className="h-3 w-3" />
                            )}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, category: "AFFILIATED_CLUB" }))}
                        className={`relative rounded-[12px] border p-4 text-left transition-all ${
                          form.category === "AFFILIATED_CLUB"
                            ? "border-[#3b82f6] bg-[#3b82f6]/5"
                            : "border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] hover:border-[#2a2a30]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${
                              form.category === "AFFILIATED_CLUB"
                                ? "bg-[#3b82f6]/10 text-[#3b82f6]"
                                : "bg-slate-100 dark:bg-[#1f1f23] text-slate-500 dark:text-[#71717a]"
                            }`}
                          >
                            <UsersRound className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Affiliated Club</div>
                            <div className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-[#71717a]">
                              A club officially affiliated with a college or university.
                            </div>
                          </div>
                          <div
                            className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                              form.category === "AFFILIATED_CLUB"
                                ? "border-[#3b82f6] bg-[#3b82f6] text-slate-900 dark:text-white"
                                : "border-[#3a3a42]"
                            }`}
                          >
                            {form.category === "AFFILIATED_CLUB" && <Check className="h-3 w-3" />}
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Official name + Organization type */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Official name *</Label>
                      <Input
                        value={form.proposedName}
                        onChange={(e) => setForm((f) => ({ ...f, proposedName: e.target.value }))}
                        placeholder="e.g. Global Institute of Technology and Management"
                        className="mt-2 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326] text-slate-900 dark:text-white placeholder:text-slate-500 dark:text-[#71717a]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Organization type *</Label>
                      <select
                        value={form.category === "AFFILIATED_CLUB" ? "AFFILIATED_CLUB" : form.category}
                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
                        className="mt-2 flex h-10 w-full rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] px-3 text-[13px] text-slate-900 dark:text-white focus:border-[#3b82f6]/50 focus:outline-none"
                      >
                        <option value="COLLEGE">College</option>
                        <option value="UNIVERSITY">University</option>
                        <option value="AFFILIATED_CLUB">Affiliated Club</option>
                      </select>
                    </div>
                  </div>

                  {/* Short description */}
                  <div>
                    <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Short description *</Label>
                    <div className="relative mt-2">
                      <textarea
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 500) }))}
                        rows={4}
                        placeholder="What should people know about your organization?"
                        className="w-full rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] px-3 py-2.5 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-500 dark:text-[#71717a] focus:border-[#3b82f6]/50 focus:outline-none resize-none"
                      />
                      <div className="absolute bottom-2 right-2 text-[10px] text-slate-500 dark:text-[#71717a]">
                        {form.description.length}/500
                      </div>
                    </div>
                  </div>

                  {/* City + State */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">City *</Label>
                      <div className="relative mt-2">
                        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-[#71717a]" />
                        <Input
                          value={form.city}
                          onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                          placeholder="Gurugram"
                          className="pl-9 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">State *</Label>
                      <select
                        value={form.state}
                        onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                        className="mt-2 flex h-10 w-full rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] px-3 text-[13px] text-slate-900 dark:text-white focus:border-[#3b82f6]/50 focus:outline-none"
                      >
                        {STATES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Website + Email */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Official website</Label>
                      <div className="relative mt-2">
                        <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-[#71717a]" />
                        <Input
                          value={form.website}
                          onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                          placeholder="https://"
                          className="pl-9 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Official contact email *</Label>
                      <div className="relative mt-2">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-[#71717a]" />
                        <Input
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          placeholder="name@institution.edu"
                          className="pl-9 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Extended location – address, postal, country, phone */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Street address</Label>
                      <Input
                        value={form.address}
                        onChange={(e) => setForm((f) => ({ ...f, address: e.target.value.slice(0, 300) }))}
                        placeholder="Building, street, area"
                        className="mt-2 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Postal code</Label>
                      <Input
                        value={form.postalCode}
                        onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value.slice(0, 32) }))}
                        placeholder="122001"
                        className="mt-2 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Country</Label>
                      <Input
                        value={form.country}
                        onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.slice(0, 120) }))}
                        placeholder="India"
                        className="mt-2 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Phone</Label>
                      <Input
                        value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.slice(0, 40) }))}
                        placeholder="+91 ..."
                        className="mt-2 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Map link (Google Maps embed or share URL)</Label>
                      <div className="relative mt-2">
                        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-[#71717a]" />
                        <Input
                          value={form.mapUrl}
                          onChange={(e) => setForm((f) => ({ ...f, mapUrl: e.target.value.slice(0, 2048) }))}
                          placeholder="https://www.google.com/maps/embed?... or https://maps.google.com/?q=..."
                          className="pl-9 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326]"
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500 dark:text-[#71717a]">Only Google Maps, OpenStreetMap, Bing, Mapbox HTTPS links allowed. Invalid or non-https will be rejected. Embed shown only if valid embed URL.</p>
                    </div>
                  </div>

                  {/* Social links – up to 12 */}
                  <div className="space-y-3">
                    <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Social links (up to 12)</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {["instagram","linkedin","twitter","facebook","youtube","github"].map((platform) => (
                        <div key={platform}>
                          <Label className="text-[11px] capitalize text-slate-600 dark:text-[#a1a1aa]">{platform}</Label>
                          <Input
                            value={form.socialLinks[platform] || ""}
                            onChange={(e) => setForm((f) => ({ ...f, socialLinks: { ...f.socialLinks, [platform]: e.target.value } }))}
                            placeholder={`https://${platform}.com/...`}
                            className="mt-1 bg-slate-50 dark:bg-[#18181b] border-slate-200 dark:border-[#232326] text-[13px]"
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-[#71717a]">Only safe https URLs will be stored. Empty fields ignored.</p>
                  </div>

                  {/* Institution affiliation */}
                  <div className="rounded-[10px] border border-slate-200 dark:border-[#1f1f23] bg-slate-50 dark:bg-[#18181b]/50">
                    <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-[#1f1f23]">
                      <Link2 className="h-4 w-4 text-[#3b82f6]" />
                      <span className="text-[12px] font-medium text-slate-900 dark:text-white">Institution affiliation</span>
                    </div>
                    <div className="p-3">
                      {form.category !== "AFFILIATED_CLUB" ? (
                        <div className="flex gap-2 rounded-[8px] bg-slate-100 dark:bg-[#1f1f23] p-2.5">
                          <Info className="h-4 w-4 shrink-0 text-slate-500 dark:text-[#71717a]" />
                          <span className="text-[11px] leading-4 text-slate-500 dark:text-[#71717a]">
                            Not required for college/university accounts. This is only needed for affiliated clubs.
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex gap-2 rounded-[8px] bg-slate-100 dark:bg-[#1f1f23] p-2.5">
                            <Info className="h-4 w-4 shrink-0 text-[#3b82f6]" />
                            <span className="text-[11px] leading-4 text-slate-600 dark:text-[#a1a1aa]">
                              Select your parent institution. Your club will require institution approval after Super Admin review.
                            </span>
                          </div>

                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-[#71717a]" />
                            <Input
                              value={parentSearch}
                              onChange={(e) => setParentSearch(e.target.value)}
                              placeholder="Search institutions"
                              className="pl-9 bg-white dark:bg-[#121214] border-slate-200 dark:border-[#232326]"
                            />
                          </div>

                          {parentLoading && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-[#71717a]">
                              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                            </div>
                          )}

                          {selectedParent ? (
                            <div className="flex items-center justify-between rounded-[10px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#121214] p-3">
                              <div>
                                <div className="text-[13px] font-medium text-slate-900 dark:text-white">{selectedParent.name}</div>
                                <div className="text-[11px] text-slate-500 dark:text-[#71717a]">
                                  {selectedParent.city} · {selectedParent.category}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-slate-500 dark:text-[#71717a] hover:text-slate-900 dark:text-white"
                                onClick={() => setSelectedParent(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            parentResults.length > 0 && (
                              <div className="max-h-40 overflow-y-auto rounded-[10px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#121214] divide-y divide-[#1f1f23]">
                                {parentResults.map((org) => (
                                  <button
                                    key={org._id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedParent(org);
                                      setParentResults([]);
                                      setParentSearch("");
                                    }}
                                    className="w-full text-left p-3 hover:bg-slate-100 dark:bg-[#1f1f23] transition-colors"
                                  >
                                    <div className="text-[13px] font-medium text-slate-900 dark:text-white">{org.name}</div>
                                    <div className="text-[11px] text-slate-500 dark:text-[#71717a]">
                                      {org.city} · {org.category}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveDraft}
                      disabled={saving}
                      className="h-9 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] text-slate-700 dark:text-[#e4e4e7] hover:bg-slate-100 dark:bg-[#1f1f23]"
                    >
                      <FileText className="h-4 w-4 mr-1.5" /> Save draft
                    </Button>
                    <Button
                      onClick={handleContinue}
                      size="sm"
                      className="h-9 rounded-[8px] bg-[#3b82f6] px-4 text-slate-900 dark:text-white hover:bg-[#2563eb]"
                    >
                      Continue to branding <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">Branding</h3>
                    <p className="mt-1 text-[12px] text-slate-500 dark:text-[#71717a]">
                      Square logo and landscape cover. Cropping preserves final aspect – no stretch.
                    </p>
                  </div>

                  {/* Logo */}
                  <div className="space-y-3">
                    <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Logo – square (1:1)</Label>
                    <div className="flex items-start gap-4">
                      <div className="h-[88px] w-[88px] overflow-hidden rounded-[12px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b]">
                        {form.logoPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={form.logoPreview} alt="Logo preview" className="h-full w-full object-cover" />
                        ) : form.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={form.logoUrl} alt="Logo" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-slate-500 dark:text-[#71717a]">
                            <ImageIcon className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-100 dark:bg-[#1f1f23]"
                            onClick={() => logoInputRef.current?.click()}
                          >
                            <Upload className="h-4 w-4 mr-1" /> {form.logoPreview ? "Replace" : "Add Logo"}
                          </Button>
                          {(form.logoPreview || form.logoUrl) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-slate-500 dark:text-[#71717a] hover:text-slate-900 dark:text-white"
                              onClick={() => setForm((f) => ({ ...f, logoPreview: "", logoUrl: "", logoBlob: null }))}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-[#71717a] max-w-[280px]">
                          PNG with transparency supported. Square crop, live preview matches final. Drag, zoom, confirm.
                        </p>
                      </div>
                    </div>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])}
                    />
                  </div>

                  {/* Cover */}
                  <div className="space-y-3">
                    <Label className="text-[12px] font-medium text-slate-700 dark:text-[#e4e4e7]">Cover – landscape (16:9)</Label>
                    <div className="overflow-hidden rounded-[12px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b]">
                      <div className="aspect-[16/6] w-full">
                        {form.coverPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={form.coverPreview} alt="Cover preview" className="h-full w-full object-cover" />
                        ) : form.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={form.coverUrl} alt="Cover" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-[12px] text-slate-500 dark:text-[#71717a]">
                            No cover
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-100 dark:bg-[#1f1f23]"
                        onClick={() => coverInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 mr-1" /> {form.coverPreview ? "Replace cover" : "Add cover"}
                      </Button>
                      {(form.coverPreview || form.coverUrl) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-slate-500 dark:text-[#71717a] hover:text-slate-900 dark:text-white"
                          onClick={() => setForm((f) => ({ ...f, coverPreview: "", coverUrl: "", coverBlob: null }))}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleCoverFile(e.target.files[0])}
                    />
                  </div>

                  <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-[#1f1f23]">
                    <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="h-8 text-slate-600 dark:text-[#a1a1aa]">
                      Back
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSaveDraft}
                        disabled={saving}
                        className="h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b]"
                      >
                        Save draft
                      </Button>
                      <Button
                        onClick={handleContinue}
                        size="sm"
                        className="h-8 rounded-[8px] bg-[#3b82f6] text-slate-900 dark:text-white hover:bg-[#2563eb]"
                      >
                        Continue to review <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">Review & submit</h3>

                  <div className="rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] p-4 space-y-3 text-[13px]">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-slate-500 dark:text-[#71717a] text-[11px]">Name</span>
                        <div className="text-slate-900 dark:text-white font-medium">{form.proposedName}</div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-[#71717a] text-[11px]">Type</span>
                        <div className="text-slate-900 dark:text-white">{form.category}</div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-[#71717a] text-[11px]">Location</span>
                        <div className="text-slate-900 dark:text-white">
                          {form.city}, {form.state}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-[#71717a] text-[11px]">Website</span>
                        <div className="text-slate-600 dark:text-[#a1a1aa] truncate">{form.website || "—"}</div>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 dark:text-[#71717a] text-[11px]">Description</span>
                        <div className="text-slate-700 dark:text-[#e4e4e7] text-[12px] leading-5">{form.description}</div>
                      </div>
                      {form.category === "AFFILIATED_CLUB" && (
                        <div className="col-span-2">
                          <span className="text-slate-500 dark:text-[#71717a] text-[11px]">Parent</span>
                          <div className="text-slate-900 dark:text-white">{selectedParent?.name || "—"}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] p-4">
                    <h4 className="text-[13px] font-medium text-slate-900 dark:text-white">Evidence – private to reviewers</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-[11px] text-slate-600 dark:text-[#a1a1aa]">Official website</Label>
                        <Input
                          value={form.evidence.officialWebsite}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, evidence: { ...f.evidence, officialWebsite: e.target.value } }))
                          }
                          placeholder="https://college.edu"
                          className="mt-1.5 h-9 bg-white dark:bg-[#121214] border-slate-200 dark:border-[#232326]"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-slate-600 dark:text-[#a1a1aa]">Official email</Label>
                        <Input
                          value={form.evidence.officialEmail}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, evidence: { ...f.evidence, officialEmail: e.target.value } }))
                          }
                          placeholder="admin@college.edu"
                          className="mt-1.5 h-9 bg-white dark:bg-[#121214] border-slate-200 dark:border-[#232326]"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[11px] text-slate-600 dark:text-[#a1a1aa]">Notes for reviewer</Label>
                        <textarea
                          value={form.evidence.notes}
                          onChange={(e) => setForm((f) => ({ ...f, evidence: { ...f.evidence, notes: e.target.value } }))}
                          rows={2}
                          className="mt-1.5 w-full rounded-[10px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#121214] px-3 py-2 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-500 dark:text-[#71717a] focus:border-[#3b82f6]/50 focus:outline-none"
                          placeholder="Authorization letter, affiliation proof, etc."
                        />
                      </div>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] p-3 cursor-pointer hover:border-[#2a2a30] transition-colors">
                    <input
                      type="checkbox"
                      checked={form.declarationAccepted}
                      onChange={(e) => setForm((f) => ({ ...f, declarationAccepted: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-[#3a3a42] bg-white dark:bg-[#121214] text-[#3b82f6]"
                    />
                    <span className="text-[12px] leading-5 text-slate-600 dark:text-[#a1a1aa]">
                      I confirm information is accurate and I am authorized to represent this organization. Pending
                      verification status shown after submit.
                    </span>
                  </label>

                  <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-[#1f1f23]">
                    <Button variant="ghost" size="sm" onClick={() => setStep(2)} className="h-8 text-slate-600 dark:text-[#a1a1aa]">
                      Back to branding
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSaveDraft}
                        disabled={saving}
                        className="h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b]"
                      >
                        Save draft
                      </Button>
                      <Button
                        onClick={handleSubmit}
                        size="sm"
                        disabled={saving || !form.declarationAccepted}
                        className="h-8 rounded-[8px] bg-[#3b82f6] px-4 text-slate-900 dark:text-white hover:bg-[#2563eb] disabled:opacity-50"
                      >
                        {saving ? "Submitting…" : "Submit for verification"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right – Live preview + Checklist – per reference */}
          <div className="space-y-4">
            {/* Live preview */}
            <div className="rounded-[12px] border border-slate-200 dark:border-[#1f1f23] bg-white dark:bg-[#121214] p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-slate-100 dark:bg-[#1f1f23] text-[#3b82f6]">
                  <Eye className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">Live preview</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#71717a]">This is how your organization will appear on EventHub.</p>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-[12px] border border-slate-200 dark:border-[#232326] bg-[#f8fafc] dark:bg-[#f8fafc] dark:bg-[#0a0a0c]">
                {/* Cover */}
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-50 dark:bg-[#18181b]">
                  {form.coverPreview || form.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.coverPreview || form.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-[#1f1f23] to-[#121214] flex items-center justify-center">
                      <span className="text-[11px] text-slate-500 dark:text-[#71717a]">Cover preview</span>
                    </div>
                  )}
                  <div className="absolute right-2 top-2 rounded-[6px] bg-black/60 px-2 py-1 text-[10px] text-slate-900 dark:text-white backdrop-blur border border-white/10 flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" /> Edit preview
                  </div>

                  {/* Logo overlapping */}
                  <div className="absolute -bottom-8 left-4">
                    <div className="h-16 w-16 overflow-hidden rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white shadow-lg">
                      {form.logoPreview || form.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.logoPreview || form.logoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center bg-[#f4f4f5] text-slate-500 dark:text-[#71717a]">
                          <div className="text-center">
                            <ImageIcon className="h-5 w-5 mx-auto" />
                            <div className="mt-1 text-[9px]">Add Logo</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-4 pt-10">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white truncate">
                      {form.proposedName || "Your organization name"}
                    </h3>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#f59e0b]/10 border border-[#f59e0b]/20 px-2 py-0.5 text-[10px] text-[#fcd34d]">
                      <Clock className="h-3 w-3" /> Pending verification
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-[#71717a]">
                    <MapPin className="h-3 w-3" /> {form.city ? `${form.city}, ${form.state}` : "Location will appear here"}
                  </div>

                  <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-[#71717a] line-clamp-2">
                    {form.description || "A short description about your organization will appear here."}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 dark:border-[#1f1f23] pt-3">
                    <div className="flex items-center gap-2">
                      <UsersRound className="h-4 w-4 text-slate-500 dark:text-[#71717a]" />
                      <div>
                        <div className="text-[12px] font-medium text-slate-900 dark:text-white">–</div>
                        <div className="text-[10px] text-slate-500 dark:text-[#71717a]">Clubs</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-slate-500 dark:text-[#71717a]" />
                      <div>
                        <div className="text-[12px] font-medium text-slate-900 dark:text-white">–</div>
                        <div className="text-[10px] text-slate-500 dark:text-[#71717a]">Events</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Checklist – per reference */}
            <div className="rounded-[12px] border border-slate-200 dark:border-[#1f1f23] bg-white dark:bg-[#121214] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">Before you submit</h4>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-[#71717a]">Make sure you have everything ready.</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {[
                  { title: "Use your official name", desc: "Match the name on official documents.", done: form.proposedName.length >= 3 },
                  { title: "Add a square logo", desc: "Use a clear, high-quality logo (1:1 ratio).", done: !!(form.logoPreview || form.logoUrl) },
                  { title: "Submit verification evidence", desc: "Be ready to provide official documents if required.", done: !!(form.evidence.officialWebsite || form.evidence.officialEmail) },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-[10px] border border-slate-200 dark:border-[#1f1f23] bg-slate-50 dark:bg-[#18181b] p-3"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-slate-100 dark:bg-[#1f1f23] text-slate-500 dark:text-[#71717a]">
                      {item.title.includes("name") ? (
                        <FileText className="h-4 w-4" />
                      ) : item.title.includes("logo") ? (
                        <ImageIcon className="h-4 w-4" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-slate-900 dark:text-white">{item.title}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-[#71717a]">{item.desc}</div>
                    </div>
                    <div
                      className={`h-5 w-5 shrink-0 rounded-full border flex items-center justify-center ${
                        item.done ? "bg-[#3b82f6] border-[#3b82f6] text-slate-900 dark:text-white" : "border-[#3a3a42]"
                      }`}
                    >
                      {item.done && <Check className="h-3 w-3" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Crop modals */}
      {logoCropSrc && (
        <ImageCropEditor
          imageSrc={logoCropSrc}
          aspect={1}
          cropShape="rect"
          title="Crop logo – square"
          onCancel={() => setLogoCropSrc(null)}
          onComplete={(blob, preview) => {
            setForm((f) => ({ ...f, logoBlob: blob, logoPreview: preview }));
            setLogoCropSrc(null);
          }}
        />
      )}
      {coverCropSrc && (
        <ImageCropEditor
          imageSrc={coverCropSrc}
          aspect={16 / 9}
          cropShape="rect"
          title="Crop cover – landscape"
          onCancel={() => setCoverCropSrc(null)}
          onComplete={(blob, preview) => {
            setForm((f) => ({ ...f, coverBlob: blob, coverPreview: preview }));
            setCoverCropSrc(null);
          }}
        />
      )}
    </div>
  );
}
