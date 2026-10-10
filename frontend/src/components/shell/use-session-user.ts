"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/utils/api";

export interface SessionUser {
  _id?: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  verified?: boolean;
  emailVerified?: boolean;
  role?: string;
  /** Computed by /auth/me from the backend's centralized email rule. UI hint only. */
  isSuperAdmin?: boolean;
  profile?: {
    avatar?: string;
    coverImage?: string;
    /* The canonical crop + asset version (§6, §27). The shell needs the
       version: without it a replaced photo would stay cached in the header. */
    avatarVersion?: number;
    coverVersion?: number;
    coverPosition?: number;
    avatarCrop?: { x: number; y: number; w: number; h: number } | null;
    coverCrop?: { x: number; y: number; w: number; h: number } | null;
    bio?: string;
    location?: string;
    institution?: string;
    course?: string;
    year?: string;
    interests?: string[];
  };
}

/**
 * The stored session user arrives from /auth/login, which returns the id as
 * `id` — while /auth/me returns `_id`. Consumers throughout the app read
 * `_id`, so before this normalisation the session id was `undefined` for the
 * whole session.
 *
 * That broke every ownership comparison in the app. The visible symptom was
 * messaging: `mine` was always false, so no message ever rendered as sent and
 * the sent/received styling collapsed into one alignment.
 *
 * Normalising here — at the single boundary where the session is read — fixes
 * it once for every consumer, rather than patching each of the ~36 sites that
 * read `user._id` and leaving the next one to be written wrong again.
 */
function normalizeUser(raw: unknown): SessionUser | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  return {
    ...(u as object),
    _id: (u._id ?? u.id ?? u.userId ?? undefined) as string | undefined,
  } as SessionUser;
}

/**
 * Reads the session (token + role + user) from localStorage.
 * Re-syncs when the tab regains focus or the route changes,
 * so login/logout in another tab is reflected.
 */
/**
 * Session-changed event.
 *
 * WHY A CUSTOM EVENT AND NOT JUST localStorage
 *   The hook used to re-read the session only on `focus` and on a route
 *   change. So after editing your profile the header avatar, the nav avatar,
 *   your post author labels and your own profile header all kept the OLD
 *   identity until you navigated or switched tabs — and on a single-page
 *   visit, effectively until a reload. §2-7 requires the update to propagate
 *   "everywhere without logout", so the write and the notification have to
 *   happen together, at the one place that owns the session.
 */
export const SESSION_EVENT = "eventhub:session-changed";

/**
 * Persist a saved user and tell every `useSessionUser` consumer at once.
 *
 * `patch` is merged rather than replacing the stored object: the login
 * response and `/auth/me/profile` do not return byte-identical shapes, and
 * overwriting would drop whichever fields the caller's response happened to
 * omit.
 */
export function updateSessionUser(patch: Partial<SessionUser> | null | undefined) {
  if (typeof window === "undefined" || !patch) return;
  try {
    const raw = localStorage.getItem("user");
    const current = raw ? JSON.parse(raw) : {};
    const merged = { ...current, ...patch };
    localStorage.setItem("user", JSON.stringify(merged));
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* storage unavailable — the next focus sync will pick it up */
  }
}

/**
 * One canonical identity refresh per session token when the cached profile or
 * backend-derived Super Admin UI hint is missing. The server remains the
 * authority; local storage is only a fast first paint. The refresh is
 * non-blocking and a changed token gets its own request.
 */
let profileSyncToken: string | null = null;
let profileSync: Promise<void> | null = null;

function syncCanonicalUser() {
  const token = localStorage.getItem("token");
  if (!token) return Promise.resolve();
  if (profileSync && profileSyncToken === token) return profileSync;

  profileSyncToken = token;
  profileSync = (async () => {
    try {
      const res = await api.get("/auth/me");
      const fresh = res?.data?.user || res?.data;
      // A sign-out/sign-in can happen while the request is in flight. Never
      // copy the previous account's server hint into the new session.
      if (!fresh || localStorage.getItem("token") !== token) return;
      updateSessionUser({
        _id: fresh._id || fresh.id,
        id: fresh.id || fresh._id,
        firstName: fresh.firstName,
        lastName: fresh.lastName,
        email: fresh.email,
        username: fresh.username,
        role: fresh.role,
        profile: fresh.profile,
        verified: fresh.verified,
        emailVerified: fresh.emailVerified,
        isSuperAdmin: fresh.isSuperAdmin === true,
      });
    } catch {
      /* offline, expired token, or an old backend — cached identity still
         renders; the backend remains the authorization boundary */
    }
  })();
  return profileSync;
}

export function useSessionUser() {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      try {
        const token = localStorage.getItem("token");
        const storedRole = localStorage.getItem("role");
        const raw = localStorage.getItem("user");
        const stored = token && raw ? normalizeUser(JSON.parse(raw)) : null;
        setUser(stored);
        /* Cached identity renders first; /auth/me supplies the canonical
           profile and Super Admin UI hint when either is absent. */
        if (stored && (!stored.profile || typeof stored.isSuperAdmin !== "boolean")) {
          void syncCanonicalUser();
        }
        setRole(token ? storedRole : null);
      } catch {
        setUser(null);
        setRole(null);
      } finally {
        setReady(true);
      }
    };
    sync();
    window.addEventListener("focus", sync);
    // Identity changed in this tab (e.g. a profile save) — re-read immediately
    // so the header, nav and avatars update on the same frame as the save.
    window.addEventListener(SESSION_EVENT, sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener(SESSION_EVENT, sync);
    };
  }, [pathname]);

  return { user, role, ready };
}

export function initialsOf(user: SessionUser | null): string {
  if (!user) return "";
  const a = user.firstName?.trim()?.[0] ?? "";
  const b = user.lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}
