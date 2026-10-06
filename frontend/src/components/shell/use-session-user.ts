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
        setUser(token && raw ? (JSON.parse(raw) as SessionUser) : null);
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
