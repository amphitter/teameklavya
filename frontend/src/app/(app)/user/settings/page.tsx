"use client";

/**
 * Settings (§13) — the destination the profile's "…" menu needed.
 *
 * The brief lists Settings as an explicit menu item, and it had no screen. What
 * it must NOT be is a wall of switches that write nothing: every control here
 * is wired to an endpoint that already existed and was already enforced
 * server-side — `PUT /api/users/me/social` (privacy), `PUT
 * /api/notifications/preferences` (mutes), the theme context (appearance), and
 * the same sign-out path as the account menu.
 *
 * Sections are ordered by how often a person touches them: identity, then
 * appearance, then privacy, then notifications, then account.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BellRing,
  Check,
  ChevronLeft,
  Globe2,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MessageSquareOff,
  Moon,
  Shield,
  Sun,
  UserCog,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageLoader, ErrorState } from "@/components/states";
import { useTheme } from "@/context/ThemeContext";
import { useLogout } from "@/components/shell/use-logout";
import { useSessionUser, updateSessionUser } from "@/components/shell/use-session-user";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { UserAvatar } from "@/components/user-avatar";

type Visibility = "public" | "followers" | "private";
type MessagesFrom = "everyone" | "followers" | "nobody";

interface SocialSettings {
  profileVisibility?: Visibility;
  allowMessagesFrom?: MessagesFrom;
  showAttendance?: boolean;
  showAchievements?: boolean;
}

/** One labelled section — the whole page is four of these. */
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
          {description ? <p className="text-[12.5px] text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/** A row that holds a label and a control, and nothing else. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  /* Stacked on a phone, side-by-side from sm up.
   *
   * Measured at 390: a label column and a `shrink-0` three-option control in
   * one line left the label about 70px wide, so "Who can see your profile"
   * broke to one word per line and the row read as broken text. The control is
   * the wider element and it is not negotiable, so the label gets the full
   * width above it instead. */
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-2.5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-foreground">{label}</p>
        {hint ? <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0 sm:shrink-0">{children}</div>
    </div>
  );
}

/** Segmented control — used for the three-value settings, never a `<select>`
 *  that would be a tiny target on a phone (§30, §44). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full gap-1 rounded-xl bg-muted p-1 sm:w-auto">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            /* ≥40px so the options are tappable, and equal width on a phone so
               three options never overflow a 320px screen (§44). */
            "min-h-[40px] flex-1 rounded-lg px-2.5 py-2 text-[12px] font-semibold transition-colors sm:flex-none sm:px-3 " +
            (value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { user, ready } = useSessionUser();
  const { theme, setTheme } = useTheme();
  const logout = useLogout();

  const [social, setSocial] = useState<SocialSettings | null>(null);
  const [identity, setIdentity] = useState<any>(null);
  const [prefTypes, setPrefTypes] = useState<string[]>([]);
  const [mutes, setMutes] = useState<Record<string, boolean>>({});
  const [error, setError] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingDiscoveryPrivacy, setSavingDiscoveryPrivacy] = useState(false);
  const [hideFromDiscovery, setHideFromDiscovery] = useState(false);
  const [canHideFromDiscovery, setCanHideFromDiscovery] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [editOpen, setEditOpen] = useState(false);

  const load = () => {
    setError(false);
    api
      .get("/users/me/social")
      .then((r) => {
        const u = r.data?.user || null;
        setIdentity(u);
        setSocial(u?.socialSettings || {});
        setHideFromDiscovery(Boolean(u?.hidePersonalProfileFromDiscovery));
        setCanHideFromDiscovery(Boolean(u?.canHidePersonalProfile));
      })
      .catch(() => setError(true));
    api
      .get("/notifications/preferences")
      .then((r) => {
        setPrefTypes(r.data?.types || []);
        setMutes(r.data?.mutes || {});
      })
      .catch(() => {
        /* Preferences are optional chrome: a failure here must not blank the
           whole screen (§7 — but it is also not a save the user made). */
      });
  };

  useEffect(() => {
    if (ready && !user) return; // signed out: the layout will bounce to /login
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?._id]);

  /* Privacy writes go through one function so a toggle and a segmented control
     cannot disagree about the payload shape. */
  const savePrivacy = async (patch: SocialSettings) => {
    const next = { ...(social || {}), ...patch };
    setSocial(next);
    setSavingPrivacy(true);
    try {
      const r = await api.put("/users/me/social", { socialSettings: next });
      /* The PUT returns the saved record — believe IT, not the optimistic copy,
         so a rejected value cannot sit on screen looking saved. */
      const stored = r.data?.user?.socialSettings;
      if (stored) setSocial(stored);
      setSavedAt(Date.now());
    } catch (e: any) {
      setSocial((prev) => ({ ...(prev || {}), ...(social || {}) })); // roll back
      toast.error(e?.response?.data?.message || "Couldn't save that setting");
    } finally {
      setSavingPrivacy(false);
    }
  };

  const toggleMute = (type: string) => {
    const next = { ...mutes, [type]: !mutes[type] };
    setMutes(next);
    api
      .put("/notifications/preferences", { mutes: next })
      .then(() => setSavedAt(Date.now()))
      .catch(() => {
        setMutes(mutes); // roll back
        toast.error("Couldn't save that notification preference");
      });
  };

  const saveDiscoveryPrivacy = async (nextValue: boolean) => {
    const prev = hideFromDiscovery;
    setHideFromDiscovery(nextValue);
    setSavingDiscoveryPrivacy(true);
    try {
      const r = await api.put("/users/me/discovery-privacy", {
        hidePersonalProfileFromDiscovery: nextValue,
      });
      const stored = r.data?.user?.hidePersonalProfileFromDiscovery;
      if (typeof stored === "boolean") setHideFromDiscovery(stored);
      setSavedAt(Date.now());
      toast.success(
        stored
          ? "Your personal profile is now hidden from people discovery"
          : "Your personal profile is now visible in people discovery"
      );
    } catch (e: any) {
      setHideFromDiscovery(prev);
      const msg = e?.response?.data?.message || "Couldn't save that setting";
      toast.error(msg);
    } finally {
      setSavingDiscoveryPrivacy(false);
    }
  };

  if (!ready || (!social && !error)) return <PageLoader label="Loading settings…" />;
  if (error) return <ErrorState title="Couldn't load your settings" onRetry={load} />;

  const saved = savedAt > 0 && Date.now() - savedAt < 2500;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <Link
          href="/user/profile"
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Your profile
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          <UserCog className="h-5 w-5 text-primary" /> Settings
        </h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          {savingPrivacy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : saved ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-500" /> Saved
            </>
          ) : (
            "Your account, how people find you, and what you hear about."
          )}
        </p>
      </div>

      {/* ── Identity ─────────────────────────────────────────────── */}
      <Section icon={UserCog} title="Profile" description="What people see when they open your profile.">
        <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
          <UserAvatar user={identity || user} size={48} alt="Your profile photo" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold text-foreground">
              {[identity?.firstName, identity?.lastName].filter(Boolean).join(" ") || user?.firstName || "You"}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">
              {identity?.username ? `@${identity.username}` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit profile
          </Button>
        </div>
      </Section>

      {/* ── Appearance ───────────────────────────────────────────── */}
      <Section icon={theme === "dark" ? Moon : Sun} title="Appearance" description="Applies immediately, on this device.">
        <Row label="Theme">
          <Segmented
            ariaLabel="Theme"
            value={theme}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
      </Section>

      {/* ── Privacy ──────────────────────────────────────────────── */}
      <Section icon={Shield} title="Privacy" description="Enforced by the server, not by hiding buttons.">
        <Row label="Who can see your profile" hint="Posts, events and achievements follow this.">
          <Segmented
            ariaLabel="Profile visibility"
            value={(social?.profileVisibility || "public") as Visibility}
            onChange={(v) => savePrivacy({ profileVisibility: v })}
            options={[
              { value: "public", label: "Public" },
              { value: "followers", label: "Followers" },
              { value: "private", label: "Only me" },
            ]}
          />
        </Row>
        <Row label="Who can message you" hint="Applies to new conversations.">
          <Segmented
            ariaLabel="Message permissions"
            value={(social?.allowMessagesFrom || "everyone") as MessagesFrom}
            onChange={(v) => savePrivacy({ allowMessagesFrom: v })}
            options={[
              { value: "everyone", label: "Everyone" },
              { value: "followers", label: "Followers" },
              { value: "nobody", label: "No one" },
            ]}
          />
        </Row>
        <Row label="Show my events" hint="Hide the events you attend from your profile.">
          <Switch
            checked={social?.showAttendance !== false}
            onCheckedChange={(v) => savePrivacy({ showAttendance: v })}
            aria-label="Show my events"
          />
        </Row>
        <Row label="Show my achievements" hint="Badges earned at events you attended.">
          <Switch
            checked={social?.showAchievements !== false}
            onCheckedChange={(v) => savePrivacy({ showAchievements: v })}
            aria-label="Show my achievements"
          />
        </Row>
        <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-foreground">Hide my personal profile from people discovery</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                {canHideFromDiscovery
                  ? hideFromDiscovery
                    ? "Your personal profile is hidden from people search, suggested users, and discovery lists. Your organization stays searchable and your events remain visible. You can still sign in and manage your organization. This applies to your entire account."
                    : "Your personal profile appears in people search and discovery. Enable to hide it while keeping your organization searchable. Applies to your entire account; organization profile, events, memberships, and management continue."
                  : "Only owners and managers of approved organizations can hide their personal profile from people discovery. Your organization must be approved and active."}
              </p>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                <span className="font-medium">Does not hide:</span> direct profile links if someone knows your username, posts, comments, event participation, messages, or historical activity — those follow existing privacy rules. Organization search and org profile remain unaffected.
              </p>
            </div>
            <div className="shrink-0">
              <Switch
                checked={hideFromDiscovery}
                disabled={!canHideFromDiscovery || savingDiscoveryPrivacy}
                onCheckedChange={(v) => saveDiscoveryPrivacy(v)}
                aria-label="Hide my personal profile from people discovery"
              />
            </div>
          </div>
          {!canHideFromDiscovery && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              You need an approved organization where you are owner, admin, or event manager to use this setting.
            </p>
          )}
          {savingDiscoveryPrivacy && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </p>
          )}
        </div>
      </Section>

      {/* ── Notifications ────────────────────────────────────────── */}
      <Section
        icon={BellRing}
        title="Notifications"
        description="Muted types stop arriving. Account-critical email is unaffected."
      >
        {prefTypes.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nothing to configure right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {prefTypes.map((t) => (
              <label
                key={t}
                className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
              >
                <span className="truncate text-[12.5px] font-medium capitalize text-foreground">
                  {t.replace(/_/g, " ")}
                </span>
                <Switch checked={Boolean(mutes[t])} onCheckedChange={() => toggleMute(t)} aria-label={`Mute ${t}`} />
              </label>
            ))}
          </div>
        )}
        <p className="flex items-start gap-1.5 pt-1 text-[11.5px] leading-snug text-muted-foreground">
          <MessageSquareOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Muting hides the notification — the message, mention or follow still happened.
        </p>
      </Section>

      {/* ── Account ──────────────────────────────────────────────── */}
      <Section icon={Lock} title="Account" description="Details tied to how you sign in.">
        <Row label="Email">
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Mail className="h-3.5 w-3.5" /> {identity?.email || user?.email || "—"}
          </span>
        </Row>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link href="/user/registrations">
              <Globe2 className="h-3.5 w-3.5" /> My registrations
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link href="/user/organizations">
              <Shield className="h-3.5 w-3.5" /> Organization requests
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={logout} className="gap-1.5 text-destructive hover:text-destructive">
            <LogOut className="h-3.5 w-3.5" /> Log out
          </Button>
        </div>
      </Section>

      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={(identity || user) as any}
        onSaved={(u) => {
          setIdentity((prev: any) => ({ ...(prev || {}), ...(u as any) }));
          updateSessionUser(u as any);
        }}
      />
    </div>
  );
}
