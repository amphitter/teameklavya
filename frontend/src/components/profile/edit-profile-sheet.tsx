"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { AvatarUploader, CoverUploader } from "@/components/profile/media-uploader";
import { useEditProfile, useUsernameAvailability, type ProfileUser } from "@/hooks/use-social";

/**
 * Edit profile sheet (§21-24, §59).
 *
 * Structured on the supplied profile-edit references, with the parts the
 * product actually needs:
 *   • username checked server-side while typing, with a real debounce
 *   • save blocked while invalid, so a bad username can never be written
 *   • unsaved-changes tracking, so navigating away accidentally is caught
 *   • a sticky save bar
 */

export interface EditProfileSheetProps {
  open: boolean;
  onClose: () => void;
  user: ProfileUser | null;
  /** Called with the fresh user object after a successful save (§56). */
  onSaved?: (user: ProfileUser) => void;
}

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const BIO_MAX = 280;
const INTERESTS_MAX = 10;

export function EditProfileSheet({ open, onClose, user, onSaved }: EditProfileSheetProps) {
  const save = useEditProfile();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [interestsText, setInterestsText] = useState("");
  const [institution, setInstitution] = useState("");
  const [avatar, setAvatar] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [coverPosition, setCoverPosition] = useState(50);
  const [profileVisibility, setProfileVisibility] = useState("public");
  const [allowMessagesFrom, setAllowMessagesFrom] = useState("everyone");

  // Debounced username — the hook fires a request per keystroke otherwise.
  const [debouncedUsername, setDebouncedUsername] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUsername(username.trim().toLowerCase()), 400);
    return () => clearTimeout(t);
  }, [username]);

  const unchanged = user?.username && debouncedUsername === user.username;
  const { available, reason, checking, valid } = useUsernameAvailability(debouncedUsername, Boolean(user) && !unchanged);

  // Seed from the user whenever the sheet opens (§59: reflect current values).
  useEffect(() => {
    if (!open || !user) return;
    const p = user.profile || {};
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
    setUsername(user.username || "");
    setBio(p.bio || "");
    setLocation(p.location || "");
    setWebsite(p.website || "");
    setInterestsText((p.interests || []).join(", "));
    setInstitution(p.institution || "");
    setAvatar(p.avatar || "");
    setCoverImage(p.coverImage || "");
    setCoverPosition(typeof p.coverPosition === "number" ? p.coverPosition : 50);
    setProfileVisibility(user.socialSettings?.profileVisibility || "public");
    setAllowMessagesFrom(user.socialSettings?.allowMessagesFrom || "everyone");
  }, [open, user]);

  const interests = useMemo(
    () =>
      interestsText
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, INTERESTS_MAX),
    [interestsText]
  );

  const dirty = useMemo(() => {
    if (!user) return false;
    const p = user.profile || {};
    return (
      firstName !== (user.firstName || "") ||
      lastName !== (user.lastName || "") ||
      username !== (user.username || "") ||
      bio !== (p.bio || "") ||
      location !== (p.location || "") ||
      website !== (p.website || "") ||
      coverPosition !== (typeof p.coverPosition === "number" ? p.coverPosition : 50) ||
      institution !== (p.institution || "") ||
      interests.join(",") !== (p.interests || []).join(",") ||
      avatar !== (p.avatar || "") ||
      coverImage !== (p.coverImage || "") ||
      profileVisibility !== (user.socialSettings?.profileVisibility || "public") ||
      allowMessagesFrom !== (user.socialSettings?.allowMessagesFrom || "everyone")
    );
  }, [user, firstName, lastName, username, bio, location, website, institution, interests, avatar, coverImage, coverPosition, profileVisibility, allowMessagesFrom]);

  /* §59 — "Prevent accidental navigation loss." */
  useEffect(() => {
    if (!open || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, dirty]);

  const usernameProblem = useMemo(() => {
    if (!username) return "Username is required";
    if (!USERNAME_RE.test(username)) return "3-30 characters: letters, numbers and underscore only";
    if (unchanged) return null;
    if (checking) return null;
    if (reason === "taken") return "That username is already taken";
    if (available === false && reason === "invalid") return "That username isn't valid";
    return null;
  }, [username, unchanged, checking, reason, available]);

  const canSave = dirty && !usernameProblem && !save.isLoading && Boolean(firstName.trim()) && bio.length <= BIO_MAX;

  const submit = async () => {
    if (!canSave) return;
    const payload: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      username: username.trim().toLowerCase(),
      bio,
      location,
      website,
      coverPosition,
      interests,
      institution,
      profileVisibility,
      allowMessagesFrom,
    };
    /* The uploader persists each image the moment it uploads, so by the time
     * Save runs these are normally already stored. They are still included
     * when they differ: that covers "replaced the image, then hit Cancel" on
     * a previous visit, and it makes the save payload self-consistent rather
     * than depending on the uploader having run. Re-sending an identical URL
     * is a no-op write of one field. */
    if (avatar !== (user?.profile?.avatar || "")) payload.avatar = avatar;
    if (coverImage !== (user?.profile?.coverImage || "")) payload.coverImage = coverImage;

    const res = await save.mutate(payload);
    if (res?.success) {
      toast.success("Profile updated");
      onSaved?.(res.user);
      onClose();
    } else {
      toast.error((res as any)?.message || "Couldn't save your profile");
    }
  };

  const requestClose = () => {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-label="Edit profile">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(11,18,53,0.45)] backdrop-blur-[6px] animate-fade-in"
        onClick={requestClose}
        aria-label="Close edit profile"
      />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface-container-lowest elevation-float animate-sheet-up sm:rounded-l-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-outline-variant px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-on-surface">Edit profile</h2>
            {dirty ? <p className="text-[11px] font-semibold text-warning">Unsaved changes</p> : null}
          </div>
          <button type="button" onClick={requestClose} className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5">
          {/* §21 — Profile photo */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Profile photo</h3>
            <AvatarUploader value={avatar} onChange={setAvatar} />
          </section>

          {/* §22 — Cover */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Cover photo</h3>
            <CoverUploader
              value={coverImage}
              /* Removing the banner also clears the focal point here, mirroring
                 what the API does — otherwise the next upload would preview a
                 crop inherited from a photo the user deleted. */
              onChange={(url) => {
                setCoverImage(url);
                if (!url) setCoverPosition(50);
              }}
              position={coverPosition}
              onPositionChange={setCoverPosition}
            />
          </section>

          {/* §23 — Username */}
          <section>
            <label htmlFor="ep-username" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Username
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-on-surface-variant">@</span>
              <input
                id="ep-username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                maxLength={30}
                className={cn(
                  "w-full rounded-[10px] border bg-surface py-2.5 pl-7 pr-9 text-[15px] outline-none transition",
                  usernameProblem ? "border-destructive focus-visible:ring-[3px] focus-visible:ring-destructive/12" : "border-outline-variant focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
                )}
                aria-invalid={Boolean(usernameProblem)}
                aria-describedby="ep-username-status"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {checking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-on-surface-variant" />
                ) : usernameProblem ? (
                  <X className="h-4 w-4 text-destructive" />
                ) : available === true || unchanged ? (
                  <Check className="h-4 w-4 text-success" />
                ) : null}
              </span>
            </div>
            <p id="ep-username-status" className={cn("mt-1 text-[12px]", usernameProblem ? "text-destructive" : "text-success")} aria-live="polite">
              {checking ? "Checking availability…" : usernameProblem ? usernameProblem : unchanged ? "This is your current username" : available === true ? "Available" : ""}
            </p>
          </section>

          {/* §24 — Display name */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ep-first" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">First name</label>
              <input id="ep-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12" />
            </div>
            <div>
              <label htmlFor="ep-last" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Last name</label>
              <input id="ep-last" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12" />
            </div>
          </section>

          {/* §24 — Bio */}
          <section>
            <label htmlFor="ep-bio" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Bio</label>
            <textarea
              id="ep-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              rows={3}
              placeholder="Tell EventHub what you build."
              className="w-full resize-none rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none placeholder:text-on-surface-variant/60 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
            />
            <p className="mt-1 text-right text-[11px] text-on-surface-variant tabular-nums">
              {bio.length}/{BIO_MAX}
            </p>
          </section>

          {/* §24 — Location / institution */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ep-loc" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Location</label>
              <input id="ep-loc" value={location} onChange={(e) => setLocation(e.target.value.slice(0, 80))} placeholder="Oslo" className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12" />
            </div>
            <div>
              <label htmlFor="ep-inst" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Institution</label>
              <input id="ep-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="University" className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12" />
            </div>
          </section>

          {/* §2-7 — website. Was input state with nowhere to go; now a real
              field, validated and sanitised server-side. */}
          <section>
            <label htmlFor="ep-site" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Website
            </label>
            <input
              id="ep-site"
              type="url"
              inputMode="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value.slice(0, 200))}
              placeholder="https://"
              className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none placeholder:text-on-surface-variant/60 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
            />
          </section>

          {/* §24 — Skills / interests */}
          <section>
            <label htmlFor="ep-interests" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Skills &amp; interests
            </label>
            <input
              id="ep-interests"
              value={interestsText}
              onChange={(e) => setInterestsText(e.target.value)}
              placeholder="AI, Design, Robotics"
              className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none placeholder:text-on-surface-variant/60 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
            />
            {interests.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {interests.map((t) => (
                  <span key={t} className="rounded-full bg-purple-light px-2.5 py-1 text-[11px] font-semibold text-purple">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-[11px] text-on-surface-variant">Comma separated · up to {INTERESTS_MAX}</p>
          </section>

          {/* §59 — Privacy */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Privacy</h3>
            <div>
              <label htmlFor="ep-vis" className="mb-1 block text-[13px] font-semibold text-on-surface">Who can see your profile</label>
              <select id="ep-vis" value={profileVisibility} onChange={(e) => setProfileVisibility(e.target.value)} className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none focus-visible:border-primary">
                <option value="public">Everyone</option>
                <option value="followers">Followers only</option>
                <option value="private">Only me</option>
              </select>
            </div>
            <div>
              <label htmlFor="ep-msg" className="mb-1 block text-[13px] font-semibold text-on-surface">Who can message you</label>
              <select id="ep-msg" value={allowMessagesFrom} onChange={(e) => setAllowMessagesFrom(e.target.value)} className="w-full rounded-[10px] border border-outline-variant bg-surface px-3 py-2.5 text-[15px] outline-none focus-visible:border-primary">
                <option value="everyone">Everyone</option>
                <option value="followers">Followers only</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>
          </section>
        </div>

        {/* Sticky save bar (§59) */}
        <div className="flex shrink-0 items-center gap-2 border-t border-outline-variant bg-surface-container-lowest px-4 py-3 pb-safe">
          <button type="button" onClick={requestClose} className="rounded-xl border border-outline-variant px-4 py-3 text-[15px] font-semibold text-on-surface">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSave} className="btn-gradient flex-1 disabled:opacity-55">
            {save.isLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span> : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small verified-badge helper used by the header. */
export function VerifiedBadge({ className }: { className?: string }) {
  return <Icon name="verified" size={16} filled className={cn("text-primary", className)} label="Verified" />;
}
