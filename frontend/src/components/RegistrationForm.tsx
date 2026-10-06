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

  // Prefill from the logged-in user's profile
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    api
      .get("/auth/me")
      .then((r) => setProfile(r.data?.user ?? null))
      .catch(() => {});
  }, []);

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

  // Apply prefill values once profile is loaded
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
    setError(null);

    // Client-side required validation
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
      // Upload files first
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
        onSuccess?.();
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

  // ── Success state ─────────────────────────────────────
  if (successMsg) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-light">
          <CheckCircle2 className="h-9 w-9 text-success" />
        </div>
        <h3 className="mt-4 text-lg font-bold text-foreground">You&apos;re in!</h3>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{successMsg}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          You can view your ticket anytime from{" "}
          <span className="font-semibold text-foreground">My Registrations</span>.
        </p>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
        {allFields.map((field) => (
          <div key={field.label} className="space-y-1.5">
            <Label htmlFor={`field-${field.label}`} className="text-sm font-medium">
              {field.label}
              {field.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>

            {field.type === "text" && (
              <Input
                id={`field-${field.label}`}
                value={formData[field.label] ?? ""}
                onChange={(e) => setValue(field.label, e.target.value)}
                placeholder={field.label}
                required={field.required}
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
              />
            )}

            {field.type === "number" && (
              <Input
                id={`field-${field.label}`}
                type="number"
                value={formData[field.label] ?? ""}
                onChange={(e) => setValue(field.label, e.target.value)}
                required={field.required}
              />
            )}

            {field.type === "dropdown" && (
              <select
                id={`field-${field.label}`}
                value={formData[field.label] ?? ""}
                onChange={(e) => setValue(field.label, e.target.value)}
                required={field.required}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-all focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
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
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(formData[field.label])}
                  onChange={(e) => setValue(field.label, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-[#0070f0]"
                />
                <span className="text-muted-foreground">I agree to the above</span>
              </label>
            )}

            {field.type === "checkbox" && field.options && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {field.options.map((opt) => {
                  const arr: string[] = formData[field.label] ?? [];
                  const checked = arr.includes(opt);
                  return (
                    <label
                      key={opt}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors",
                        checked ? "border-primary/50 bg-brand-light" : "border-border bg-background"
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
                        className="h-4 w-4 rounded border-input accent-[#0070f0]"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            )}

            {field.type === "file" && (
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input bg-muted/40 px-4 py-3.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
                <FileUp className="h-4 w-4 shrink-0" />
                <span className="truncate">
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
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" className="flex-1 font-semibold" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…
            </>
          ) : (
            `Register for ${eventTitle.length > 28 ? "this event" : eventTitle}`
          )}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
