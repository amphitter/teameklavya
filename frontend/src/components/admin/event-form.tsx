"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

/* §18 — the cropper is only ever mounted inside the crop dialog, but a static
 * import pulled it into the bundle of every page that renders this form,
 * including organizers who never touch an image. Loaded on demand instead.
 * `ssr: false` because it measures the DOM on mount. */
const Cropper = dynamic(() => import("react-easy-crop"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
}) as React.ComponentType<any>; // react-easy-crop's own props are all required in its .d.ts, though the
                                // component defaults them at runtime; dynamic() cannot infer that.
import { toast } from "sonner";
import { api } from "@/utils/api";
import { compressFor } from "@/utils/compress-image";
import { getImageUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Gamepad2,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  Mic2,
  Music4,
  MoreHorizontal,
  Plus,
  Presentation,
  Ticket,
  Trash2,
  Trophy,
  Users,
  Video,
  Wrench,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────
export interface Speaker {
  name: string;
  designation: string;
  company: string;
  linkedin: string;
  imageUrl: string;
}
export interface ScheduleItem {
  day: string;
  time: string;
  title: string;
  description: string;
  speakers: string[];
}
export interface Partner {
  name: string;
  role: string;
  website: string;
  logoUrl: string;
}
export interface CustomField {
  label: string;
  type: "text" | "email" | "number" | "dropdown" | "checkbox" | "file";
  required: boolean;
  options: string[];
  autoFillFromProfile?: "institution" | "course" | "year" | null;
}

export interface EventFormValues {
  title: string;
  description: string;
  category: string;
  eventType: "online" | "offline" | "hybrid";
  venue: string;
  venueIframeLink: string;
  onlineEventLink: string;
  platform: string;
  meetingId: string;
  passcode: string;
  organizer: string;
  maxAttendees: number;
  price: number;
  theme: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  registrationLink: string;
  whatsappGroup: string;
  isFeatured: boolean;
  visibility: "public" | "unlisted" | "private";
}

interface EventFormProps {
  mode: "create" | "edit";
  eventId?: string;
  ownerOrganization?: { _id: string; name: string; slug: string };
  returnTo?: string;
  initial?: Partial<EventFormValues> & {
    ticketSettings?: { autoGenerate: boolean; sendEmail: boolean; manualApproval: boolean };
    speakers?: Speaker[];
    schedule?: ScheduleItem[];
    benefits?: string[];
    partners?: Partner[];
    registrationForm?: CustomField[];
    requiredProfileFields?: { institution: boolean; course: boolean; year: boolean };
    bannerUrl?: string;
    logoUrl?: string | null;
    organization?: { _id: string; name: string; slug: string } | string | null;
    community?: { _id: string; name: string; slug: string } | string | null;
  };
}

const EMPTY_FORM: EventFormValues = {
  title: "",
  description: "",
  category: "",
  eventType: "offline",
  venue: "",
  venueIframeLink: "",
  onlineEventLink: "",
  platform: "",
  meetingId: "",
  passcode: "",
  organizer: "",
  maxAttendees: 100,
  price: 0,
  theme: "Fire",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  registrationLink: "",
  whatsappGroup: "",
  isFeatured: false,
  visibility: "public",
};

const THEMES = ["Fire", "Forest", "Ocean", "Cosmic", "Sunset", "Electric", "Golden", "Rose", "Dark", "Arctic"];
const PLATFORMS = ["", "zoom", "google-meet", "teams", "youtube", "other"];

/** Visual event-type cards (drives the available activities). */
const EVENT_TYPES = [
  { value: "Hackathon", icon: Code2, tint: "text-primary" },
  { value: "Workshop", icon: Wrench, tint: "text-cyan" },
  { value: "Tech Talk", icon: Mic2, tint: "text-purple" },
  { value: "Competition", icon: Trophy, tint: "text-warning" },
  { value: "Cultural", icon: Music4, tint: "text-destructive" },
  { value: "Gaming", icon: Gamepad2, tint: "text-success" },
  { value: "Career", icon: Presentation, tint: "text-primary" },
  { value: "Meetup", icon: Users, tint: "text-cyan" },
  { value: "Other", icon: MoreHorizontal, tint: "text-muted-foreground" },
];

/** Activity foundation per event type — only real ones enabled. */
function activitiesFor(category: string): { name: string; desc: string; soon: boolean }[] {
  const base = [
    { name: "Registration questions", desc: "Custom form participants fill while registering", soon: false },
    { name: "QR tickets", desc: "Auto-generated tickets with QR check-in scanning", soon: false },
  ];
  const byType: Record<string, { name: string; desc: string; soon: boolean }[]> = {
    Hackathon: [
      { name: "Teams", desc: "Team formation & management", soon: true },
      { name: "Problem statements", desc: "Publish tracks and problem statements", soon: true },
      { name: "Submissions", desc: "Collect and review project submissions", soon: true },
      { name: "Judging", desc: "Judge scores and final results", soon: true },
    ],
    Competition: [
      { name: "Leaderboard", desc: "Live rankings for quiz players", soon: false },
      { name: "Submissions", desc: "Collect and review entries", soon: true },
    ],
    "Tech Talk": [],
    Career: [],
  };
  const extras = byType[category] || [];
  const quiz = [{ name: "Live quiz", desc: "Real-time Q&A with instant scoring and a live leaderboard", soon: false }];
  return [...base, ...quiz, ...extras];
}

const STEPS = [
  { id: 0, label: "Basics" },
  { id: 1, label: "Details" },
  { id: 2, label: "Activities" },
  { id: 3, label: "Settings" },
  { id: 4, label: "Review" },
];

// Crop helper
async function getCroppedBlob(imageSrc: string, crop: any): Promise<Blob> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((r) => (image.onload = r));
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92));
}

const inputCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10";

// ─── Component ─────────────────────────────────────────────
export default function EventForm({ mode, eventId, ownerOrganization, returnTo, initial }: EventFormProps) {
  const router = useRouter();

  const [form, setForm] = useState<EventFormValues>({ ...EMPTY_FORM, ...initial });
  const [ticketSettings, setTicketSettings] = useState(
    initial?.ticketSettings ?? { autoGenerate: false, sendEmail: true, manualApproval: false }
  );
  const [schedule, setSchedule] = useState<ScheduleItem[]>(initial?.schedule ?? []);
  const [speakers, setSpeakers] = useState<Speaker[]>(initial?.speakers ?? []);
  const [benefits, setBenefits] = useState<string[]>(initial?.benefits?.length ? initial.benefits : [""]);
  const [partners, setPartners] = useState<Partner[]>(initial?.partners ?? []);
  const [customFields, setCustomFields] = useState<CustomField[]>(initial?.registrationForm ?? []);
  const [requiredProfileFields, setRequiredProfileFields] = useState(
    initial?.requiredProfileFields ?? { institution: false, course: false, year: false }
  );

  const [existingBanner, setExistingBanner] = useState(initial?.bannerUrl || "");
  const [existingLogo, setExistingLogo] = useState(initial?.logoUrl || "");
  const [clearLogo, setClearLogo] = useState(false);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<"banner" | "logo" | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<any>(null);

  const [orgs, setOrgs] = useState<{ _id: string; name: string }[]>([]);
  const [organization, setOrganization] = useState<string>(
    (initial as any)?.organization?._id || (initial as any)?.organization || (mode === "create" ? ownerOrganization?._id : "") || ""
  );
  const [communityId, setCommunityId] = useState<string>(
    (initial as any)?.community?._id || (initial as any)?.community || ""
  );
  const [communities, setCommunities] = useState<{ _id: string; name: string; slug: string }[]>([]);

  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const venueInputRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  const gotoStep = (s: number) => {
    setStep(s);
    setMaxStep((m) => Math.max(m, s));
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Organizations the organizer can attach
  useEffect(() => {
    api
      .get("/organizations/mine")
      .then((res) => setOrgs(res.data?.organizations || []))
      .catch(() => {});
    api
      .get("/communities", { params: { limit: 50 } })
      .then((res) => setCommunities(res.data?.communities || []))
      .catch(() => {});
  }, []);

  // Google Maps autocomplete (optional — needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
  useEffect(() => {
    if (form.eventType === "online") return;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key || (window as any).google?.maps) return;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    document.head.appendChild(script);
  }, [form.eventType]);

  useEffect(() => {
    const g = (window as any).google;
    if (!g?.maps?.places || !venueInputRef.current) return;
    const ac = new g.maps.places.Autocomplete(venueInputRef.current, {
      types: ["establishment", "geocode"],
      fields: ["formatted_address", "geometry", "name"],
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (place?.name) set("venue", place.name);
    });
  }, [form.eventType]);

  const selectImageForCrop = (file: File, target: "banner" | "logo") => {
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be 5 MB or smaller");
    setCropTarget(target);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const applyCrop = async () => {
    if (!cropSrc || !croppedArea || !cropTarget) return;
    const blob = await getCroppedBlob(cropSrc, croppedArea);
    const file = new File([blob], cropTarget === "logo" ? "event-logo.jpg" : "poster.jpg", { type: "image/jpeg" });
    if (cropTarget === "logo") {
      setLogoFile(file);
      setClearLogo(false);
    } else {
      setPosterFile(file);
    }
    setCropSrc(null);
    setCropTarget(null);
  };

  const validateStep = (s: number): string | null => {
    if (s !== 0) return null;
    if (!form.title.trim()) return "Event title is required";
    if (!form.category) return "Pick an event type";
    if (!form.description.trim()) return "Description is required";
    if (!form.startDate || !form.startTime) return "Start date and time are required";
    if (!form.endDate || !form.endTime) return "End date and time are required";
    if (new Date(`${form.endDate}T${form.endTime}`) <= new Date(`${form.startDate}T${form.startTime}`))
      return "End must be after start";
    if (form.eventType !== "online" && !form.venue.trim()) return "Venue is required for in-person events";
    if (form.eventType !== "offline" && !form.onlineEventLink.trim()) return "Online event link is required for online events";
    return null;
  };

  const nextStep = () => {
    const err = validateStep(step);
    if (err) return toast.error(err);
    gotoStep(Math.min(STEPS.length - 1, step + 1));
  };

  const handleSubmit = async () => {
    for (const s of [0]) {
      const err = validateStep(s);
      if (err) {
        gotoStep(s);
        return toast.error(err);
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        organization: organization || null,
        ...(mode === "create" && ownerOrganization ? { organizerType: "ORGANIZATION" } : {}),
        community: communityId || null,
        startDate: new Date(`${form.startDate}T${form.startTime}`).toISOString(),
        endDate: new Date(`${form.endDate}T${form.endTime}`).toISOString(),
        bannerUrl: existingBanner || "",
        ticketSettings,
        speakers,
        schedule,
        benefits: benefits.filter((b) => b.trim() !== ""),
        partners,
        requiredProfileFields,
        registrationForm: customFields,
      };

      let savedEvent: any;
      if (mode === "create") {
        const res = await api.post("/events", payload);
        if (!res.data?.success || !res.data?.event?._id) {
          throw new Error(res.data?.message || "Failed to create event");
        }
        savedEvent = res.data.event;
      } else if (eventId) {
        const res = await api.put(`/events/${eventId}`, payload);
        if (!res.data?.success) throw new Error(res.data?.message || "Failed to update event");
        savedEvent = res.data.event || { _id: eventId };
      } else {
        throw new Error("Event id is missing");
      }

      // Upload only after the Event exists. The dedicated routes authorize via
      // the same owner-aware Event manager check and attach/retire assets.
      const imageFailures: string[] = [];
      if (posterFile) {
        try {
          // Preserve the existing 16:10 banner crop and optimize for poster delivery.
          const { file: posterToUpload } = await compressFor(posterFile, "poster");
          const fd = new FormData();
          fd.append("file", posterToUpload, posterToUpload.name);
          const up = await api.post(`/upload/event/${savedEvent._id}`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          if (!up.data?.success || !up.data?.url) throw new Error(up.data?.message || "Upload failed");
          setExistingBanner(up.data.url);
          setPosterFile(null);
        } catch {
          imageFailures.push("poster");
        }
      }

      if (logoFile) {
        try {
          // Logo crop is separate (1:1) and uses the existing logo compression preset.
          const { file: logoToUpload } = await compressFor(logoFile, "logo");
          const fd = new FormData();
          fd.append("file", logoToUpload, logoToUpload.name);
          const up = await api.post(`/upload/event/${savedEvent._id}/logo`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          if (!up.data?.success || !up.data?.url) throw new Error(up.data?.message || "Upload failed");
          setExistingLogo(up.data.url);
          setLogoFile(null);
          setClearLogo(false);
        } catch {
          imageFailures.push("logo");
        }
      } else if (clearLogo && mode === "edit") {
        try {
          await api.delete(`/upload/event/${savedEvent._id}/logo`);
          setExistingLogo("");
          setClearLogo(false);
        } catch {
          imageFailures.push("logo removal");
        }
      }

      if (imageFailures.length) {
        toast.error(`Event saved, but these image changes failed: ${imageFailures.join(", ")}. You can retry.`);
      } else {
        toast.success(mode === "create" ? "Event created" : "Event updated");
      }
      if (mode === "create") {
        router.push(returnTo || `/admin/events/edit/${savedEvent._id}?created=true`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save event");
    } finally {
      setSaving(false);
    }
  };

  const bannerPreview = posterFile ? URL.createObjectURL(posterFile) : getImageUrl(existingBanner);
  const logoPreview = logoFile
    ? URL.createObjectURL(logoFile)
    : clearLogo
      ? null
      : getImageUrl(existingLogo);

  // Category not among presets (e.g. legacy "General") → treat as Other + custom text
  const presetCategories = EVENT_TYPES.map((t) => t.value);
  const customCategory = form.category && !presetCategories.includes(form.category) ? form.category : "";

  /* ═══ STEPPER ═══════════════════════════════════════════ */
  const Stepper = () => (
    <div ref={topRef} className="no-scrollbar sticky top-2 z-30 -mx-1 flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card/95 p-2 px-2 backdrop-blur-md lg:top-4">
      {STEPS.map((s, i) => {
        const done = s.id < maxStep || (s.id === 4 && false);
        const active = step === s.id;
        return (
          <div key={s.id} className="flex shrink-0 items-center">
            {i > 0 && <span className={cn("mx-1 h-px w-4 sm:w-8", s.id <= maxStep ? "bg-primary" : "bg-border")} />}
            <button
              type="button"
              onClick={() => s.id <= maxStep && gotoStep(s.id)}
              disabled={s.id > maxStep}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : s.id <= maxStep
                    ? "text-foreground hover:bg-muted"
                    : "text-muted-foreground/50"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                  active
                    ? "border-primary-foreground"
                    : done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : s.id + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );

  /* ═══ STEP 0 — BASICS ══════════════════════════════════ */
  const StepBasics = (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Event title *</Label>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. HackCraft 4.0 — 36-hour Hackathon" />
      </div>

      <div className="space-y-1.5">
        <Label>Event type *</Label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {EVENT_TYPES.map((t) => {
            const selected = form.category === t.value || (t.value === "Other" && customCategory !== "");
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => set("category", t.value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-semibold transition-colors",
                  selected
                    ? "border-primary bg-brand-light text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                <t.icon className={cn("h-5 w-5", selected ? "text-primary" : t.tint)} />
                {t.value}
              </button>
            );
          })}
        </div>
        {(form.category === "Other" || customCategory) && (
          <div className="space-y-1.5">
            <Label>Custom type name</Label>
            <Input
              value={customCategory}
              onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Seminar, Exhibition, Bootcamp…"
            />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Description *</Label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What is this event about? What should participants expect?"
          rows={5}
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Format</Label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "offline", label: "In person", icon: MapPin },
              { value: "online", label: "Online", icon: Video },
              { value: "hybrid", label: "Hybrid", icon: Globe },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => set("eventType", t.value)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-xs font-semibold transition-colors",
                form.eventType === t.value
                  ? "border-primary bg-brand-light text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Start date *</Label>
          <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Start time *</Label>
          <Input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>End date *</Label>
          <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>End time *</Label>
          <Input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </div>
      </div>

      {form.eventType !== "online" && (
        <>
          <div className="space-y-1.5">
            <Label>Venue *</Label>
            <Input ref={venueInputRef} value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="Start typing a place name or address…" />
            <p className="text-[11px] text-muted-foreground">
              {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
                ? "Suggestions powered by Google Places"
                : "Tip: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for place autocomplete"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Map embed URL</Label>
            <Input value={form.venueIframeLink} onChange={(e) => set("venueIframeLink", e.target.value)} placeholder="Google Maps embed link (optional)" />
          </div>
        </>
      )}
      {form.eventType !== "offline" && (
        <>
          <div className="space-y-1.5">
            <Label>Online event link *</Label>
            <Input value={form.onlineEventLink} onChange={(e) => set("onlineEventLink", e.target.value)} placeholder="https://meet.google.com/…" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <select value={form.platform} onChange={(e) => set("platform", e.target.value)} className={inputCls}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p === "" ? "Select…" : p}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Meeting ID</Label>
              <Input value={form.meetingId} onChange={(e) => set("meetingId", e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label>Passcode</Label>
              <Input value={form.passcode} onChange={(e) => set("passcode", e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label>WhatsApp group link</Label>
        <Input value={form.whatsappGroup} onChange={(e) => set("whatsappGroup", e.target.value)} placeholder="Optional — shared with confirmed participants" />
      </div>

      {/* Poster */}
      <div className="space-y-1.5">
        <Label>Event poster</Label>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="h-36 w-56 shrink-0 overflow-hidden rounded-lg border border-dashed border-border bg-muted">
            {bannerPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerPreview} alt="Poster preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs">No poster yet</span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted">
                <ImagePlus className="h-4 w-4" /> {posterFile ? "Choose different image" : "Upload poster"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) selectImageForCrop(file, "banner");
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {posterFile && <span className="text-xs font-medium text-success">New poster — uploads on save</span>}
            <p className="text-[11px] text-muted-foreground">JPEG/PNG/WebP · max 5 MB · crop after selecting</p>
          </div>
        </div>
      </div>

      {/* Independent optional square Event logo — banner remains 16:10. */}
      <div className="space-y-1.5">
        <Label>Event logo (optional)</Label>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-dashed border-border bg-muted">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Event logo preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <CalendarDays className="h-7 w-7" />
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-2">
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted">
                <ImagePlus className="h-4 w-4" />
                {logoFile ? "Choose different logo" : existingLogo && !clearLogo ? "Replace logo" : "Upload logo"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) selectImageForCrop(file, "logo");
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {logoFile && <span className="text-xs font-medium text-success">New square logo — uploads on save</span>}
            {clearLogo && <span className="text-xs font-medium text-warning">Logo will be removed on save</span>}
            {logoFile ? (
              <button type="button" onClick={() => setLogoFile(null)} className="text-xs font-semibold text-muted-foreground underline underline-offset-2">
                Discard new logo
              </button>
            ) : existingLogo && !clearLogo ? (
              <button type="button" onClick={() => setClearLogo(true)} className="text-xs font-semibold text-destructive underline underline-offset-2">
                Remove logo
              </button>
            ) : clearLogo ? (
              <button type="button" onClick={() => setClearLogo(false)} className="text-xs font-semibold text-muted-foreground underline underline-offset-2">
                Undo removal
              </button>
            ) : null}
            <p className="text-[11px] text-muted-foreground">Square crop · JPEG/PNG/WebP · max 5 MB · legacy Events may leave this empty</p>
          </div>
        </div>
      </div>
    </div>
  );

  /* ═══ STEP 1 — DETAILS ═════════════════════════════════ */
  const StepDetails = (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Organizer name</Label>
          <Input value={form.organizer} onChange={(e) => set("organizer", e.target.value)} placeholder="e.g. Team Eklavya, GDG Gurgaon" />
        </div>
        <div className="space-y-1.5">
          <Label>Theme color</Label>
          <select value={form.theme} onChange={(e) => set("theme", e.target.value)} className={inputCls}>
            {THEMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {ownerOrganization ? (
        <div className="space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
          <Label>Event owner</Label>
          <p className="text-sm font-semibold text-foreground">{ownerOrganization.name}</p>
          <p className="text-[11px] text-muted-foreground">
            This event is explicitly owned by this organization. Host/community associations remain separate from ownership.
          </p>
        </div>
      ) : orgs.length > 0 ? (
        <div className="space-y-1.5">
          <Label>Host organization</Label>
          <select value={organization} onChange={(e) => setOrganization(e.target.value)} className={inputCls}>
            <option value="">No organization</option>
            {orgs.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">The event is associated with this organization for discovery; association alone does not transfer ownership.</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Community</Label>
        <select value={communityId} onChange={(e) => setCommunityId(e.target.value)} className={inputCls}>
          <option value="">No community</option>
          {communities.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">The event will appear on the community page.</p>
      </div>

      {/* Schedule */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Schedule</Label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSchedule((p) => [...p, { day: "", time: "", title: "", description: "", speakers: [] }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <div className="mt-3 space-y-2.5">
          {schedule.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
              No sessions yet — build the agenda for your event.
            </p>
          )}
          {schedule.map((item, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-3.5">
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Input type="date" value={item.day} onChange={(e) => setSchedule((p) => p.map((s, j) => (j === i ? { ...s, day: e.target.value } : s)))} />
                <Input type="time" value={item.time} onChange={(e) => setSchedule((p) => p.map((s, j) => (j === i ? { ...s, time: e.target.value } : s)))} />
                <Input value={item.title} onChange={(e) => setSchedule((p) => p.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)))} placeholder="Session title" />
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <Input value={item.description} onChange={(e) => setSchedule((p) => p.map((s, j) => (j === i ? { ...s, description: e.target.value } : s)))} placeholder="Description (optional)" />
                <Input
                  value={item.speakers.join(", ")}
                  onChange={(e) => setSchedule((p) => p.map((s, j) => (j === i ? { ...s, speakers: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } : s)))}
                  placeholder="Speakers (comma separated)"
                />
              </div>
              <button type="button" onClick={() => setSchedule((p) => p.filter((_, j) => j !== i))} className="mt-2 text-xs font-semibold text-destructive hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Speakers */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Speakers</Label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSpeakers((p) => [...p, { name: "", designation: "", company: "", linkedin: "", imageUrl: "" }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <div className="mt-3 space-y-2.5">
          {speakers.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
              Add speakers to showcase who&apos;s presenting.
            </p>
          )}
          {speakers.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-3.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Input value={s.name} onChange={(e) => setSpeakers((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
                <Input value={s.designation} onChange={(e) => setSpeakers((p) => p.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)))} placeholder="Designation" />
                <Input value={s.company} onChange={(e) => setSpeakers((p) => p.map((x, j) => (j === i ? { ...x, company: e.target.value } : x)))} placeholder="Company" />
                <Input value={s.linkedin} onChange={(e) => setSpeakers((p) => p.map((x, j) => (j === i ? { ...x, linkedin: e.target.value } : x)))} placeholder="LinkedIn URL" />
              </div>
              <button type="button" onClick={() => setSpeakers((p) => p.filter((_, j) => j !== i))} className="mt-2 text-xs font-semibold text-destructive hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Benefits */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Benefits</Label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setBenefits((p) => [...p, ""])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {benefits.map((b, i) => (
            <div key={i} className="flex gap-2">
              <Input value={b} onChange={(e) => setBenefits((p) => p.map((x, j) => (j === i ? e.target.value : x)))} placeholder="e.g. Certificate of participation" />
              <Button type="button" variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => setBenefits((p) => p.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Partners */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Partners</Label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPartners((p) => [...p, { name: "", role: "", website: "", logoUrl: "" }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <div className="mt-3 space-y-2.5">
          {partners.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
              Sponsors and partners are shown on the event page.
            </p>
          )}
          {partners.map((pt, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-3.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Input value={pt.name} onChange={(e) => setPartners((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Partner name" />
                <Input value={pt.role} onChange={(e) => setPartners((p) => p.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} placeholder="Role (e.g. Title Sponsor)" />
                <Input value={pt.website} onChange={(e) => setPartners((p) => p.map((x, j) => (j === i ? { ...x, website: e.target.value } : x)))} placeholder="Website URL" />
                <Input value={pt.logoUrl} onChange={(e) => setPartners((p) => p.map((x, j) => (j === i ? { ...x, logoUrl: e.target.value } : x)))} placeholder="Logo URL" />
              </div>
              <button type="button" onClick={() => setPartners((p) => p.filter((_, j) => j !== i))} className="mt-2 text-xs font-semibold text-destructive hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ═══ STEP 2 — ACTIVITIES ══════════════════════════════ */
  const StepActivities = (
    <div className="space-y-6">
      {/* What's available for this event type */}
      <div>
        <Label className="text-sm font-bold">Activities for {form.category || "your event"}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What participants can do at this event — enabled items are live, others are on the roadmap.
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {activitiesFor(form.category).map((a) => (
            <div
              key={a.name}
              className={cn(
                "flex items-start justify-between gap-3 rounded-lg border p-3.5",
                a.soon ? "border-dashed border-border bg-muted/40" : "border-primary/30 bg-brand-light"
              )}
            >
              <div>
                <p className={cn("text-sm font-semibold", a.soon && "text-muted-foreground")}>{a.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  a.soon ? "bg-muted text-muted-foreground" : "bg-success-light text-success"
                )}
              >
                {a.soon ? "Soon" : "Live"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Required profile fields */}
      <div>
        <Label className="text-sm font-bold">Ask participants for</Label>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(["institution", "course", "year"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setRequiredProfileFields((p) => ({ ...p, [f]: !p[f] }))}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors",
                requiredProfileFields[f]
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">These auto-fill from participant profiles at registration.</p>
      </div>

      {/* Custom questions */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Registration questions</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCustomFields((p) => [...p, { label: "", type: "text", required: false, options: [] }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add question
          </Button>
        </div>
        <div className="mt-3 space-y-2.5">
          {customFields.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
              No custom questions — participants register with just name & email.
            </p>
          )}
          {customFields.map((field, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Question label</Label>
                  <Input
                    value={field.label}
                    onChange={(e) => setCustomFields((p) => p.map((f, j) => (j === i ? { ...f, label: e.target.value } : f)))}
                    placeholder="e.g. T-shirt size"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <select
                      value={field.type}
                      onChange={(e) =>
                        setCustomFields((p) => p.map((f, j) => (j === i ? { ...f, type: e.target.value as CustomField["type"] } : f)))
                      }
                      className={inputCls}
                    >
                      {["text", "email", "number", "dropdown", "checkbox", "file"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Required</Label>
                    <label className="flex h-10 items-center gap-2 px-1 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => setCustomFields((p) => p.map((f, j) => (j === i ? { ...f, required: e.target.checked } : f)))}
                        className="h-4 w-4 accent-[#0070f0]"
                      />
                      Required
                    </label>
                  </div>
                </div>
              </div>
              {field.type === "dropdown" && (
                <div className="mt-3 space-y-1">
                  <Label className="text-xs">Options (comma separated)</Label>
                  <Input
                    value={field.options.join(", ")}
                    onChange={(e) =>
                      setCustomFields((p) =>
                        p.map((f, j) => (j === i ? { ...f, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : f))
                      )
                    }
                    placeholder="S, M, L, XL"
                  />
                </div>
              )}
              <div className="mt-3 flex justify-between">
                <div className="flex gap-2">
                  {(["institution", "course", "year"] as const).map((af) => (
                    <button
                      key={af}
                      type="button"
                      onClick={() =>
                        setCustomFields((p) => p.map((f, j) => (j === i ? { ...f, autoFillFromProfile: f.autoFillFromProfile === af ? null : af } : f)))
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize",
                        field.autoFillFromProfile === af
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      auto: {af}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setCustomFields((p) => p.filter((_, j) => j !== i))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-destructive hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ═══ STEP 3 — SETTINGS ════════════════════════════════ */
  const StepSettings = (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Capacity (max attendees)</Label>
          <Input type="number" min={1} value={form.maxAttendees} onChange={(e) => set("maxAttendees", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label>Price (₹, 0 = free)</Label>
          <Input type="number" min={0} value={form.price} onChange={(e) => set("price", Number(e.target.value))} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tickets</Label>
        {(
          [
            { key: "autoGenerate", label: "Auto-generate tickets on registration", desc: "A QR ticket is created for each participant" },
            { key: "sendEmail", label: "Email tickets to participants", desc: "Ticket with QR code is sent by email" },
            { key: "manualApproval", label: "Manual approval", desc: "Tickets start as pending until you approve them" },
          ] as const
        ).map((t) => (
          <label key={t.key} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3.5">
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Ticket className="h-4 w-4 text-primary" /> {t.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t.desc}</span>
            </span>
            <input
              type="checkbox"
              checked={ticketSettings[t.key]}
              onChange={(e) => setTicketSettings((p) => ({ ...p, [t.key]: e.target.checked }))}
              className="mt-1 h-4 w-4 shrink-0 accent-[#0070f0]"
            />
          </label>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label>Visibility</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { value: "public", label: "Public", desc: "Listed in discovery & search" },
              { value: "unlisted", label: "Unlisted", desc: "Only people with the link" },
              { value: "private", label: "Private", desc: "Invite-only, hidden from search" },
            ] as const
          ).map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => set("visibility", v.value)}
              className={cn("rounded-lg border px-3.5 py-3 text-left transition-colors", form.visibility === v.value ? "border-primary bg-brand-light" : "border-border hover:border-primary/40")}
            >
              <span className={cn("text-sm font-semibold", form.visibility === v.value ? "text-primary" : "text-foreground")}>{v.label}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{v.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-background px-4 py-3.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-purple" /> Feature this event
        </span>
        <input type="checkbox" checked={form.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} className="h-4 w-4 accent-[#0070f0]" />
      </label>

      <div className="space-y-1.5">
        <Label>External registration link (optional)</Label>
        <Input value={form.registrationLink} onChange={(e) => set("registrationLink", e.target.value)} placeholder="Use EventHub registration instead — leave empty" />
      </div>
    </div>
  );

  /* ═══ STEP 4 — REVIEW ══════════════════════════════════ */
  const ReviewRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value || "—"}</span>
    </div>
  );

  const StepReview = (
    <div className="space-y-4">
      {[
        {
          step: 0,
          title: "Basics",
          body: (
            <>
              <ReviewRow label="Title" value={form.title} />
              <ReviewRow label="Type" value={form.category} />
              <ReviewRow label="Format" value={form.eventType} />
              <ReviewRow
                label="When"
                value={
                  form.startDate
                    ? `${new Date(form.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${form.startTime} → ${new Date(form.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${form.endTime}`
                    : null
                }
              />
              <ReviewRow label="Where" value={form.eventType === "online" ? "Online" : form.venue} />
              <ReviewRow label="Poster" value={bannerPreview ? "Uploaded ✓" : "None"} />
            </>
          ),
        },
        {
          step: 1,
          title: "Details",
          body: (
            <>
              <ReviewRow label="Organizer" value={form.organizer} />
              <ReviewRow label="Host community" value={orgs.find((o) => o._id === organization)?.name} />
              <ReviewRow label="Sessions" value={schedule.length} />
              <ReviewRow label="Speakers" value={speakers.length} />
              <ReviewRow label="Benefits" value={benefits.filter(Boolean).length} />
              <ReviewRow label="Partners" value={partners.length} />
            </>
          ),
        },
        {
          step: 2,
          title: "Activities",
          body: (
            <>
              <ReviewRow label="Registration questions" value={customFields.length} />
              <ReviewRow
                label="Profile fields required"
                value={Object.entries(requiredProfileFields).filter(([, v]) => v).map(([k]) => k).join(", ") || "None"}
              />
            </>
          ),
        },
        {
          step: 3,
          title: "Settings",
          body: (
            <>
              <ReviewRow label="Capacity" value={form.maxAttendees} />
              <ReviewRow label="Price" value={form.price > 0 ? `₹${form.price}` : "Free"} />
              <ReviewRow label="Tickets" value={`${ticketSettings.autoGenerate ? "Auto-generated" : "Off"}${ticketSettings.sendEmail ? " · emailed" : ""}${ticketSettings.manualApproval ? " · manual approval" : ""}`} />
              <ReviewRow label="Visibility" value={form.visibility} />
              <ReviewRow label="Featured" value={form.isFeatured ? "Yes" : "No"} />
            </>
          ),
        },
      ].map((section) => (
        <div key={section.step} className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-light text-[11px] font-bold text-primary">
                {section.step + 1}
              </span>
              {section.title}
            </h3>
            <button type="button" onClick={() => gotoStep(section.step)} className="text-xs font-semibold text-primary hover:underline">
              Edit
            </button>
          </div>
          <div className="divide-y divide-border">{section.body}</div>
        </div>
      ))}
    </div>
  );

  const STEP_CONTENT = [StepBasics, StepDetails, StepActivities, StepSettings, StepReview];

  /* ═══ RENDER ═══════════════════════════════════════════ */
  return (
    <div className="space-y-4">
      <Stepper />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 4) handleSubmit();
        }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-base font-bold text-foreground">{STEPS[step].label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
          <div className="mt-5">{STEP_CONTENT[step]}</div>
        </div>

        {/* Sticky footer nav */}
        <div className="sticky bottom-0 z-30 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 backdrop-blur-md">
          <Button type="button" variant="ghost" onClick={() => router.push("/admin/events")}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => gotoStep(step - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={nextStep} className="px-8 font-semibold">
                Continue <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" className="px-8 font-semibold" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : mode === "create" ? (
                  "Create event"
                ) : (
                  "Save changes"
                )}
              </Button>
            )}
          </div>
        </div>
      </form>

      {/* Crop dialog */}
      <Dialog
        open={Boolean(cropSrc)}
        onOpenChange={(open) => {
          if (!open) {
            setCropSrc(null);
            setCropTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{cropTarget === "logo" ? "Crop event logo" : "Crop poster"}</DialogTitle>
          </DialogHeader>
          <div className="relative h-72 w-full overflow-hidden rounded-lg bg-muted">
            {cropSrc && (
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={cropTarget === "logo" ? 1 : 16 / 10}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area: any, px: any) => setCroppedArea(px)}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">Zoom</span>
            <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[#0070f0]" />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCropSrc(null);
                setCropTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={applyCrop} className="font-semibold">
              Use this crop
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
