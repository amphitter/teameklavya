"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface RegistrationField {
  label: string;
  type: "text" | "email" | "number" | "dropdown" | "checkbox" | "file";
  required: boolean;
  options?: string[];
  autoFillFromProfile?: "institution" | "course" | "year";
}

interface RegistrationFormProps {
  eventId: string;
  eventTitle: string;
  requiredProfileFields?: { institution: boolean; course: boolean; year: boolean };
  customFields?: RegistrationField[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function RegistrationForm({
  eventId,
  eventTitle,
  requiredProfileFields,
  customFields = [],
  onSuccess,
  onCancel,
}: RegistrationFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});
  const [profile, setProfile] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
    profile?: { institution?: string; course?: string; year?: string };
  } | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    // Use shared deduped session query (Priority 2) — avoids duplicate /auth/me
    (async () => {
      try {
        const { dedupedFetch, keyToString, queryCache } = await import("@/lib/query");
        const cacheKey = keyToString(["session"]);
        let meData: any = queryCache.get(cacheKey)?.data;
        if (!meData) {
          try {
            meData = await dedupedFetch(cacheKey, "/auth/me");
            queryCache.setData(cacheKey, meData);
          } catch {
            meData = null;
          }
        }
        setProfile((meData as any)?.user || meData || null);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const isSimpleFreeEvent = useMemo(() => {
    const hasRequiredProfile = requiredProfileFields?.institution || requiredProfileFields?.course || requiredProfileFields?.year;
    return !hasRequiredProfile && customFields.length === 0;
  }, [requiredProfileFields, customFields]);

  const allFields: RegistrationField[] = useMemo(() => {
    const base: RegistrationField[] = [
      { label: "Full Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
    ];
    if (requiredProfileFields?.institution)
      base.push({ label: "Institution/Organization", type: "text", required: true, autoFillFromProfile: "institution" });
    if (requiredProfileFields?.course)
      base.push({ label: "Course/Program", type: "text", required: true, autoFillFromProfile: "course" });
    if (requiredProfileFields?.year)
      base.push({ label: "Academic Year", type: "text", required: true, autoFillFromProfile: "year" });
    return [...base, ...customFields];
  }, [requiredProfileFields, customFields]);

  useEffect(() => {
    if (!profile) return;
    setFormData((prev) => {
      const next = { ...prev };
      if (!next["Full Name"] && profile.firstName) {
        next["Full Name"] = `${profile.firstName} ${profile.lastName || ""}`.trim();
      }
      if (!next["Email"] && profile.email) next["Email"] = profile.email;
      allFields.forEach((f) => {
        if (f.autoFillFromProfile && !next[f.label]) {
          const v = (profile.profile as any)?.[f.autoFillFromProfile];
          if (v) next[f.label] = v;
        }
      });
      return next;
    });
  }, [profile, allFields]);

  const setValue = (label: string, value: any) =>
    setFormData((prev) => ({ ...prev, [label]: value }));

  const uploadFile = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file);
    const response = await api.post("/upload/image?folder=registration-files", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    if (response.data?.success && response.data.url) return response.data.url;
    throw new Error("File upload failed");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // Prevent duplicate submissions
    setError(null);

    for (const field of allFields) {
      if (field.required) {
        const v = formData[field.label];
        const empty = field.type === "checkbox" && !field.options ? !v : v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
        if (empty) {
          setError(`Please fill in: ${field.label}`);
          return;
        }
      }
    }

    setLoading(true);
    try {
      const processed = { ...formData };
      for (const [label, file] of Object.entries(fileUploads)) {
        try {
          processed[label] = await uploadFile(file);
        } catch {
          setError(`Failed to upload file for "${label}". Please try again.`);
          setLoading(false);
          return;
        }
      }

      const answers = Object.entries(processed).map(([fieldLabel, value]) => ({
        fieldLabel,
        fieldType: allFields.find((f) => f.label === fieldLabel)?.type || "text",
        value,
      }));

      const response = await api.post("/registration/responses", { eventId, answers });

      if (response.data.success) {
        setSuccessMsg(
          response.data.message ||
            "Registration successful! Your ticket has been emailed to you."
        );
        toast.success("You're registered!");
        // Delay onSuccess to allow parent to show animation
        setTimeout(() => onSuccess?.(), 100);
      } else {
        setError(response.data.message || "Registration failed");
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || "Failed to register for event";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (successMsg) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#052e16] border border-[#14532d]/30">
          <CheckCircle2 className="h-9 w-9 text-[#22c55e] animate-[scaleIn_0.5s_cubic-bezier(0.22,1,0.36,1)]" />
        </div>
        <style>{`
          @keyframes scaleIn {
            0% { transform: scale(0); opacity: 0; }
            60% { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .animate-[scaleIn_0.5s_cubic-bezier(0.22,1,0.36,1)] { animation: none !important; }
          }
        `}</style>
        <h3 className="mt-4 break-words text-lg font-bold text-foreground">You&apos;re in!</h3>
        <p className="mt-1.5 max-w-sm break-words text-sm text-muted-foreground">{successMsg}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          You can view your ticket anytime from <span className="font-semibold text-foreground">My Registrations</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-full space-y-5 overflow-x-hidden">
      {isSimpleFreeEvent && profile ? (
        <div className="w-full max-w-full rounded-xl border border-border bg-muted/30 p-4">
          <p className="break-words text-sm font-medium text-foreground">Quick registration</p>
          <p className="mt-1 break-words text-xs text-muted-foreground" style={{ overflowWrap: "anywhere" }}>
            This is a free event with no extra questions. We&apos;ll register you as{" "}
            <span className="font-semibold text-foreground">{profile.firstName} {profile.lastName}</span> ({profile.email}).
          </p>
          <p className="mt-2 break-words text-xs text-muted-foreground">
            Your ticket will be emailed and available in My Registrations.
          </p>
        </div>
      ) : null}

      <div className="w-full max-w-full space-y-5">
        {allFields.map((field) => {
          if (isSimpleFreeEvent && (field.label === "Full Name" || field.label === "Email") && formData[field.label]) {
            return (
              <div key={field.label} className="w-full max-w-full space-y-1">
                <Label className="break-words text-xs text-muted-foreground" style={{ overflowWrap: "anywhere" }}>{field.label}</Label>
                <p className="break-words text-sm font-medium text-foreground" style={{ overflowWrap: "anywhere" }}>{formData[field.label]}</p>
              </div>
            );
          }
          return (
            <div key={field.label} className="w-full max-w-full space-y-1.5">
              <Label htmlFor={`field-${field.label}`} className="flex min-w-0 break-words text-sm font-medium" style={{ overflowWrap: "anywhere" }}>
                <span className="min-w-0 flex-1 break-words" style={{ overflowWrap: "anywhere" }}>
                  {field.label}
                  {field.required && <span className="ml-0.5 text-destructive">*</span>}
                </span>
              </Label>

              {field.type === "text" && (
                <Input
                  id={`field-${field.label}`}
                  value={formData[field.label] ?? ""}
                  onChange={(e) => setValue(field.label, e.target.value)}
                  placeholder={field.label}
                  required={field.required}
                  className="w-full max-w-full"
                />
              )}

              {field.type === "email" && (
                <Input
                  id={`field-${field.label}`}
                  type="email"
                  value={formData[field.label] ?? ""}
                  onChange={(e) => setValue(field.label, e.target.value)}
                  placeholder="you@example.com"
                  required={field.required}
                  className="w-full max-w-full"
                />
              )}

              {field.type === "number" && (
                <Input
                  id={`field-${field.label}`}
                  type="number"
                  value={formData[field.label] ?? ""}
                  onChange={(e) => setValue(field.label, e.target.value)}
                  required={field.required}
                  className="w-full max-w-full"
                />
              )}

              {field.type === "dropdown" && (
                <select
                  id={`field-${field.label}`}
                  value={formData[field.label] ?? ""}
                  onChange={(e) => setValue(field.label, e.target.value)}
                  required={field.required}
                  className="flex h-12 w-full max-w-full rounded-[12px] border border-[#E4E9F4] bg-white px-4 text-[15px] text-[#0B1235] outline-none focus:border-[#2563FF] focus:ring-[3px] focus:ring-[rgba(37,99,255,0.12)] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed]"
                >
                  <option value="">Select…</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {field.type === "checkbox" && !field.options && (
                <label className="flex w-full max-w-full cursor-pointer items-start gap-2.5 rounded-[12px] border border-[#E4E9F4] bg-[#F8FAFF] px-4 py-3 text-sm dark:border-[#262626] dark:bg-black">
                  <input
                    type="checkbox"
                    checked={Boolean(formData[field.label])}
                    onChange={(e) => setValue(field.label, e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                  />
                  <span className="min-w-0 flex-1 break-words text-[#64709A] dark:text-[#a1a1aa]" style={{ overflowWrap: "anywhere" }}>I agree to the above</span>
                </label>
              )}

              {field.type === "checkbox" && field.options && (
                <div className="grid w-full max-w-full grid-cols-1 gap-2">
                  {field.options.map((opt) => {
                    const arr: string[] = formData[field.label] ?? [];
                    const checked = arr.includes(opt);
                    return (
                      <label
                        key={opt}
                        className={cn(
                          "flex w-full max-w-full cursor-pointer items-start gap-2.5 rounded-[12px] border px-4 py-3 text-sm transition-colors",
                          checked ? "border-[#2563FF]/50 bg-[#EFF6FF] dark:bg-[#0f172a] dark:border-[#3b82f6]/30" : "border-[#E4E9F4] bg-white dark:border-[#262626] dark:bg-black"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setValue(
                              field.label,
                              checked ? arr.filter((v) => v !== opt) : [...arr, opt]
                            )
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                        />
                        <span className="min-w-0 flex-1 break-words" style={{ overflowWrap: "anywhere" }}>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {field.type === "file" && (
                <label className="flex w-full max-w-full cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-[#E4E9F4] bg-[#F8FAFF] px-4 py-3.5 text-sm text-[#64709A] transition-colors hover:border-[#2563FF]/50 hover:text-[#2563FF] dark:border-[#262626] dark:bg-black dark:text-[#a1a1aa]">
                  <FileUp className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {fileUploads[field.label]
                      ? fileUploads[field.label].name
                      : "Choose a file (JPEG/PNG/WebP, max 5 MB)"}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFileUploads((prev) => ({ ...prev, [field.label]: f }));
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="w-full max-w-full rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 dark:border-[#7f1d1d]/30 dark:bg-[#7f1d1d]/10">
          <p className="break-words text-sm font-medium text-[#DC2626] dark:text-[#f87171]" style={{ overflowWrap: "anywhere" }}>{error}</p>
          <p className="mt-1 break-words text-xs text-[#64709A] dark:text-[#a1a1aa]">Please check your input and try again.</p>
        </div>
      )}

      <div className="flex w-full max-w-full flex-col gap-3 pb-[env(safe-area-inset-bottom)] sm:flex-row">
        <Button type="submit" className="w-full flex-1 font-semibold min-h-[48px] rounded-[12px] sm:w-auto" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…
            </>
          ) : isSimpleFreeEvent ? (
            "Confirm registration — Free"
          ) : (
            <span className="break-words" style={{ overflowWrap: "anywhere" }}>
              {`Register for ${eventTitle.length > 28 ? "this event" : eventTitle}`}
            </span>
          )}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading} className="w-full min-h-[48px] rounded-[12px] sm:w-auto">
            Cancel
          </Button>
        )}
      </div>
      <p className="break-words text-center text-[11px] text-[#64709A] dark:text-[#71717a]" style={{ overflowWrap: "anywhere" }}>
        Secure registration · QR ticket emailed · No duplicate registration · Capacity enforced server-side
      </p>
    </form>
  );
}
