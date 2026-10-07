"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export interface SessionUser {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  profile?: {
    avatar?: string;
    institution?: string;
    course?: string;
    year?: string;
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
        setUser(token && raw ? normalizeUser(JSON.parse(raw)) : null);
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
    return () => window.removeEventListener("focus", sync);
  }, [pathname]);

  return { user, role, ready };
}

export function initialsOf(user: SessionUser | null): string {
  if (!user) return "";
  const a = user.firstName?.trim()?.[0] ?? "";
  const b = user.lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}
