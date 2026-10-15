"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  Check,
  ChevronRight,
  Loader2,
  User,
  Shield,
  Image as ImageIcon,
  FileText,
  GraduationCap,
  Heart,
  Search,
  X,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/states";
import { updateSessionUser } from "@/components/shell/use-session-user";

const INTEREST_LABELS: Record<string, string> = {
  technology: "Technology",
  ai: "Artificial Intelligence",
  programming: "Programming",
  gaming: "Gaming",
  music: "Music",
  sports: "Sports",
  design: "Design",
  startups: "Startups",
  entrepreneurship: "Entrepreneurship",
  education: "Education",
  hackathons: "Hackathons",
  events: "Events",
  science: "Science",
  photography: "Photography",
  business: "Business",
  art: "Art",
  fitness: "Fitness",
  travel: "Travel",
  food: "Food",
  health: "Health",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1: username
  const [username, setUsername] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameMessage, setUsernameMessage] = useState("");

  // Step 2: age
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  // Step 3: privacy
  const [privacy, setPrivacy] = useState<"public" | "private">("public");

  // Step 4: avatar/banner
  const [avatar, setAvatar] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  // Step 5: bio
  const [bio, setBio] = useState("");

  // Step 6: institution
  const [institutionSearch, setInstitutionSearch] = useState("");
  const [institutionResults, setInstitutionResults] = useState<any[]>([]);
  const [selectedInstitution, setSelectedInstitution] = useState<any>(null);
  const [institutionLoading, setInstitutionLoading] = useState(false);

  // Step 7: interests
  const [interests, setInterests] = useState<string[]>([]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get("/onboarding/status");
      setStatus(res.data);
      // Pre-fill from existing data
      if (res.data?.user) {
        setUsername(res.data.user.username || "");
        setAgeConfirmed(res.data.user.ageConfirmed || false);
        setPrivacy(res.data.user.socialSettings?.profileVisibility === "private" ? "private" : "public");
        setAvatar(res.data.user.profile?.avatar || "");
        setCoverImage(res.data.user.profile?.coverImage || "");
        setBio(res.data.user.profile?.bio || "");
        if (res.data.user.institutionOrgId) {
          setSelectedInstitution(res.data.user.institutionOrgId);
        }
        setInterests(res.data.user.interestsV2 || res.data.user.profile?.interests || []);
      }
      // Determine starting step based on incomplete required
      const incomplete = res.data?.incompleteRequired || [];
      if (incomplete.length === 0) {
        // All required done, but show optional if any incomplete? For progressive onboarding, guide only incomplete
        // If all required done, go to feed unless user explicitly wants to complete optional
        // For new users, we still want to show optional steps? Spec says after required, go to feed, optional skippable
        // So if required complete, we can redirect to feed directly
        // But for existing users with incomplete optional, we should still allow access - we show optional but skippable
        // For simplicity, if required complete, redirect to feed
        // However, if user came here explicitly, show from start
        // We'll start at 0 but allow skip
      }
    } catch (e) {
      toast.error("Failed to load onboarding status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // Username availability check
  useEffect(() => {
    if (!username.trim() || username.trim().length < 3) {
      setUsernameAvailable(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/onboarding/check-username?username=${encodeURIComponent(username)}`);
        setUsernameAvailable(res.data?.available || false);
        setUsernameMessage(res.data?.message || "");
      } catch {
        setUsernameAvailable(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  // Institution search
  useEffect(() => {
    if (!institutionSearch.trim()) {
      setInstitutionResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setInstitutionLoading(true);
      try {
        const res = await api.get(`/onboarding/institutions?search=${encodeURIComponent(institutionSearch)}&limit=10`);
        setInstitutionResults(res.data?.organizations || []);
      } catch {
        setInstitutionResults([]);
      } finally {
        setInstitutionLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [institutionSearch]);

  const handleUpload = async (file: File | undefined, type: "avatar" | "cover") => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be 5MB or smaller");
      return;
    }
    setUploading(type);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post(`/upload/image?folder=${type === "avatar" ? "avatars" : "organizers"}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success && res.data.url) {
        if (type === "avatar") setAvatar(res.data.url);
        else setCoverImage(res.data.url);
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

  const steps = [
    {
      id: "username",
      title: "Choose your username",
      desc: "This is how people find you. 3-30 chars, letters, numbers, underscore. 14-day cooldown after change.",
      icon: User,
      required: true,
      completed: status?.steps?.username,
    },
    {
      id: "age",
      title: "Age confirmation",
      desc: "Confirm you meet our minimum age policy (13+). We don't store your full birth date, just confirmation.",
      icon: Shield,
      required: true,
      completed: status?.steps?.age,
    },
    {
      id: "privacy",
      title: "Public or private account?",
      desc: "Public: discoverable, content visible per platform rules. Private: follow requests need approval, private posts only for followers, not leaked via search/feeds/APIs.",
      icon: Shield,
      required: true,
      completed: status?.steps?.privacy,
    },
    {
      id: "media",
      title: "Profile picture & banner",
      desc: "Upload both, one, or skip. Uses existing Cloudinary infrastructure, preserves existing when skipped.",
      icon: ImageIcon,
      required: false,
      completed: status?.steps?.avatarBanner,
    },
    {
      id: "bio",
      title: "Add a bio (optional)",
      desc: "Tell people about yourself. Max 280 chars, moderated, editable later.",
      icon: FileText,
      required: false,
      completed: status?.steps?.bio,
    },
    {
      id: "institution",
      title: "College or university (optional)",
      desc: "Select from approved organizations. Not proof of enrollment, not exposed if private.",
      icon: GraduationCap,
      required: false,
      completed: status?.steps?.institution,
    },
    {
      id: "interests",
      title: "Your interests (optional)",
      desc: "Pick topics for recommendations. Stable IDs, editable later, respects visibility settings.",
      icon: Heart,
      required: false,
      completed: status?.steps?.interests,
    },
  ];

  const currentStep = steps[step];

  const saveStep = async (skip = false) => {
    if (skip) {
      // For optional steps, mark as completed in backend by calling with empty or skip flag
      // For required, cannot skip
      if (currentStep.required) {
        toast.error("This step is required");
        return;
      }
      // For optional, we still want to mark onboardingSteps as done to avoid repeated prompts
      // We call the appropriate API with skip or empty
      try {
        setSaving(true);
        if (currentStep.id === "media") {
          // Skip: don't update media, but mark step done via bio? Actually media step doesn't have skip API, we just move next
          // We will call onboarding service to mark institution/interests as skipped
        } else if (currentStep.id === "bio") {
          await api.put("/onboarding/bio", { bio: "" });
        } else if (currentStep.id === "institution") {
          await api.put("/onboarding/institution", { organizationId: null });
        } else if (currentStep.id === "interests") {
          await api.put("/onboarding/interests", { interests: [] });
        }
        setStep((s) => Math.min(s + 1, steps.length - 1));
        await loadStatus();
      } catch (e: any) {
        toast.error(e?.response?.data?.message || "Failed to skip");
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      if (currentStep.id === "username") {
        if (!username.trim()) {
          toast.error("Username required");
          setSaving(false);
          return;
        }
        const res = await api.post("/onboarding/username", { username });
        if (res.data?.success) {
          toast.success("Username set");
          updateSessionUser({ username: res.data.user.username });
          setStep((s) => s + 1);
          await loadStatus();
        }
      } else if (currentStep.id === "age") {
        if (!ageConfirmed) {
          toast.error("Please confirm your age");
          setSaving(false);
          return;
        }
        const res = await api.post("/onboarding/age-confirm", { confirmed: true });
        if (res.data?.success) {
          toast.success("Age confirmed");
          setStep((s) => s + 1);
          await loadStatus();
        }
      } else if (currentStep.id === "privacy") {
        const res = await api.put("/onboarding/privacy", { visibility: privacy });
        if (res.data?.success) {
          toast.success("Privacy set");
          setStep((s) => s + 1);
          await loadStatus();
        }
      } else if (currentStep.id === "media") {
        // If both empty and user wants to skip, allow
        if (!avatar && !coverImage) {
          // Skip
          setStep((s) => s + 1);
        } else {
          const res = await api.post("/onboarding/media", { avatar, coverImage });
          if (res.data?.success) {
            toast.success("Media updated");
            updateSessionUser({ profile: { avatar, coverImage } as any });
            setStep((s) => s + 1);
            await loadStatus();
          }
        }
      } else if (currentStep.id === "bio") {
        const res = await api.put("/onboarding/bio", { bio });
        if (res.data?.success) {
          toast.success("Bio updated");
          setStep((s) => s + 1);
          await loadStatus();
        }
      } else if (currentStep.id === "institution") {
        const res = await api.put("/onboarding/institution", { organizationId: selectedInstitution?._id || null });
        if (res.data?.success) {
          toast.success("Institution updated");
          setStep((s) => s + 1);
          await loadStatus();
        }
      } else if (currentStep.id === "interests") {
        const res = await api.put("/onboarding/interests", { interests });
        if (res.data?.success) {
          toast.success("Interests updated");
          setStep((s) => s + 1);
          await loadStatus();
          // After last step, complete onboarding and go to feed
          try {
            await api.post("/onboarding/complete");
            toast.success("Onboarding complete! Welcome to EventHub");
            router.push("/");
          } catch {}
        }
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await api.post("/onboarding/complete");
      toast.success("Onboarding complete!");
      router.push("/");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Complete failed, check required steps");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading onboarding…" />;

  const requiredDone = status?.requiredCompleted;
  const allStepsDone = steps.every((s) => status?.steps?.[s.id === "media" ? "avatarBanner" : s.id]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight">Welcome to EventHub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {requiredDone ? "Complete your profile — optional steps can be skipped and finished later in Settings." : "Let's set up your account — required steps first, then optional."}
          </p>
          <div className="mt-4 flex gap-1.5">
            {steps.map((s, i) => (
              <div key={s.id} className={`h-2 flex-1 rounded-full transition-colors ${i < step ? "bg-primary" : i === step ? "bg-primary/60" : "bg-muted"} ${s.completed ? "bg-emerald-500" : ""}`} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>Step {step + 1} of {steps.length}: {currentStep.title}</span>
            <span>{requiredDone ? "Required done ✓" : `${status?.incompleteRequired?.length || 0} required left`}</span>
          </div>
        </div>

        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <currentStep.icon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold">{currentStep.title}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{currentStep.desc}</p>
              {currentStep.required ? <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Required</span> : <span className="mt-1 inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">Optional — can skip</span>}
            </div>
          </div>

          <div className="space-y-4">
            {currentStep.id === "username" && (
              <>
                <div className="space-y-1.5">
                  <Label>Username *</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ananya_dev" maxLength={30} />
                  {usernameAvailable === true && <p className="text-xs text-emerald-600 flex items-center gap-1"><Check className="h-3 w-3" /> Available</p>}
                  {usernameAvailable === false && <p className="text-xs text-red-600">{usernameMessage || "Not available"}</p>}
                  <p className="text-[11px] text-muted-foreground">3-30 chars, letters, numbers, underscore. 14-day cooldown after change. Case-only changes not allowed to bypass.</p>
                </div>
              </>
            )}

            {currentStep.id === "age" && (
              <>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <p className="text-sm font-medium">Age confirmation</p>
                  <p className="mt-1 text-xs text-muted-foreground">Our platform requires users to be at least 13 years old. This confirmation is recorded with timestamp, not as verified proof of identity. We don't store full date of birth unless legally required.</p>
                  <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input" />
                    <span className="text-sm font-medium">I confirm I am at least 13 years old and meet the platform's minimum-age policy *</span>
                  </label>
                </div>
              </>
            )}

            {currentStep.id === "privacy" && (
              <>
                <div className="grid gap-3">
                  <button type="button" onClick={() => setPrivacy("public")} className={`rounded-xl border p-4 text-left ${privacy === "public" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"}`}>
                    <div className="font-semibold text-sm">Public account</div>
                    <div className="text-xs text-muted-foreground mt-1">Profile discoverable via search, posts visible per platform rules, anyone can follow. Your username, avatar, limited info visible to non-followers per product conventions.</div>
                  </button>
                  <button type="button" onClick={() => setPrivacy("private")} className={`rounded-xl border p-4 text-left ${privacy === "private" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"}`}>
                    <div className="font-semibold text-sm">Private account</div>
                    <div className="text-xs text-muted-foreground mt-1">Follow requests need approval, pending requests don't grant access, private posts only for followers, not leaked via search/feeds/APIs/realtime, blocked users stay blocked. Subject to safety enforcement and moderation.</div>
                  </button>
                </div>
              </>
            )}

            {currentStep.id === "media" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Profile picture</Label>
                    <div className="flex items-center gap-3">
                      <div className="h-16 w-16 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                        {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <User className="h-6 w-6 text-muted-foreground" />}
                      </div>
                      <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                        {uploading === "avatar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Upload
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "avatar")} />
                      </label>
                      {avatar && <Button variant="ghost" size="sm" onClick={() => setAvatar("")}><X className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Banner</Label>
                    <div className="space-y-2">
                      <div className="h-20 w-full rounded-xl bg-muted overflow-hidden flex items-center justify-center">
                        {coverImage ? <img src={coverImage} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
                      </div>
                      <div className="flex gap-2">
                        <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                          {uploading === "cover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Upload banner
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files?.[0], "cover")} />
                        </label>
                        {coverImage && <Button variant="ghost" size="sm" onClick={() => setCoverImage("")}><X className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Moderation applies to images per media publication policy. Pending/flagged content not visible to unauthorized viewers. Existing images preserved when skipped.</p>
              </>
            )}

            {currentStep.id === "bio" && (
              <>
                <div className="space-y-1.5">
                  <Label>Bio (optional, max 280)</Label>
                  <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={280} placeholder="Tell us about yourself…" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10" />
                  <div className="text-[11px] text-muted-foreground">{bio.length}/280 — moderated, respects visibility</div>
                </div>
              </>
            )}

            {currentStep.id === "institution" && (
              <>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Search college/university (from approved organizations)</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input value={institutionSearch} onChange={(e) => setInstitutionSearch(e.target.value)} placeholder="Search institutions…" className="pl-8" />
                    </div>
                    {institutionLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Searching…</p>}
                    {selectedInstitution && (
                      <div className="rounded-lg border bg-card p-3 text-sm flex justify-between items-center">
                        <div><div className="font-semibold">{selectedInstitution.name}</div><div className="text-xs text-muted-foreground">{selectedInstitution.slug} • {selectedInstitution.city}</div></div>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedInstitution(null)}><X className="h-4 w-4" /></Button>
                      </div>
                    )}
                    {!selectedInstitution && institutionResults.length > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
                        {institutionResults.map((org: any) => (
                          <button key={org._id} type="button" onClick={() => { setSelectedInstitution(org); setInstitutionResults([]); setInstitutionSearch(""); }} className="w-full text-left p-2.5 hover:bg-muted text-sm">
                            <div className="font-medium">{org.name}</div>
                            <div className="text-xs text-muted-foreground">{org.city} • {org.category}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">We don't create new institution if not found — use separate Organization registration workflow. Not proof of enrollment, private education info not public.</p>
                  </div>
                </div>
              </>
            )}

            {currentStep.id === "interests" && (
              <>
                <div className="space-y-2">
                  <Label>Select interests (optional, up to 10)</Label>
                  <div className="flex flex-wrap gap-2">
                    {status?.taxonomy?.map((item: any) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setInterests((prev) => (prev.includes(item.id) ? prev.filter((id) => id !== item.id) : prev.length < 10 ? [...prev, item.id] : prev));
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${interests.includes(item.id) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Stored as stable IDs, used for recommendations only where visibility/personalization allows. Skip allowed.</p>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
              {!currentStep.required && (
                <Button variant="outline" disabled={saving} onClick={() => saveStep(true)}>Skip</Button>
              )}
            </div>
            <div className="flex gap-2">
              {step === steps.length - 1 ? (
                <>
                  <Button variant="outline" disabled={saving} onClick={handleComplete}>Complete & go to feed</Button>
                  <Button disabled={saving} onClick={() => saveStep(false)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save</Button>
                </>
              ) : (
                <Button disabled={saving} onClick={() => saveStep(false)} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {currentStep.required ? "Save & continue" : "Save"} <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {requiredDone && (
            <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
              Required steps done ✓ You can go to feed anytime. Optional steps can be completed later in Settings.
              <Button size="sm" className="ml-2" onClick={() => router.push("/")}>Go to feed</Button>
            </div>
          )}
        </Card>

        <div className="mt-4 text-center text-[11px] text-muted-foreground">
          Onboarding version {status?.currentVersion || 1} • Server-authoritative completion • Skipped fields completable later in Settings • No repeated prompts every login
        </div>
      </div>
    </div>
  );
}
