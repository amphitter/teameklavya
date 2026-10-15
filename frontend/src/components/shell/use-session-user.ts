"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/utils/api";
import { queryCache, dedupedFetch, keyToString } from "@/lib/query";

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
  isSuperAdmin?: boolean;
  profile?: {
    avatar?: string;
    coverImage?: string;
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

function normalizeUser(raw: unknown): SessionUser | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  return {
    ...(u as object),
    _id: (u._id ?? u.id ?? u.userId ?? undefined) as string | undefined,
  } as SessionUser;
}

export const SESSION_EVENT = "eventhub:session-changed";

export function updateSessionUser(patch: Partial<SessionUser> | null | undefined) {
  if (typeof window === "undefined" || !patch) return;
  try {
    const raw = localStorage.getItem("user");
    const current = raw ? JSON.parse(raw) : {};
    const merged = { ...current, ...patch };
    localStorage.setItem("user", JSON.stringify(merged));
    // Also update query cache so deduped session query stays fresh
    const cacheKey = keyToString(["session"]);
    const existing = queryCache.get(cacheKey)?.data as any;
    if (existing?.user) {
      queryCache.setData(cacheKey, { ...existing, user: { ...existing.user, ...patch } });
    }
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* storage unavailable */
  }
}

/**
 * One canonical identity refresh per session token when the cached profile or
 * backend-derived Super Admin UI hint is missing. Uses dedupedFetch so
 * concurrent callers share one network round trip (Priority 2 fix).
 */
let profileSyncToken: string | null = null;
let profileSync: Promise<void> | null = null;
let lastSyncTime = 0;
const SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5 min throttle for focus sync

function syncCanonicalUser(force = false) {
  const token = localStorage.getItem("token");
  if (!token) return Promise.resolve();
  // Throttle unless forced (e.g., profile missing)
  if (!force && Date.now() - lastSyncTime < SYNC_THROTTLE_MS) {
    return Promise.resolve();
  }
  if (profileSync && profileSyncToken === token) return profileSync;

  profileSyncToken = token;
  const cacheKey = keyToString(["session"]);

  profileSync = (async () => {
    try {
      // Use dedupedFetch so multiple components mounting at once share one request
      const data = await dedupedFetch<{ user?: any }>(cacheKey, "/auth/me", { method: "GET" } as any);
      const fresh = (data as any)?.user || data;
      if (!fresh || localStorage.getItem("token") !== token) return;
      lastSyncTime = Date.now();
      // Update cache
      queryCache.setData(cacheKey, data);
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
      /* offline, expired token, or rate-limited — cached identity still renders */
    }
  })();
  return profileSync;
}

export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const lastFocusSyncRef = useRef(0);

  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const token = localStorage.getItem("token");
        const storedRole = localStorage.getItem("role");
        const raw = localStorage.getItem("user");
        const stored = token && raw ? normalizeUser(JSON.parse(raw)) : null;
        setUser(stored);
        if (stored && (!stored.profile || typeof stored.isSuperAdmin !== "boolean")) {
          void syncCanonicalUser(true); // force when profile missing
        }
        setRole(token ? storedRole : null);
      } catch {
        setUser(null);
        setRole(null);
      } finally {
        setReady(true);
      }
    };

    const onFocus = () => {
      // Throttle focus sync to avoid hammering /auth/me on tab switches
      if (Date.now() - lastFocusSyncRef.current < SYNC_THROTTLE_MS) {
        syncFromStorage();
        return;
      }
      lastFocusSyncRef.current = Date.now();
      syncFromStorage();
      // Only revalidate from server if throttle window passed
      void syncCanonicalUser(false);
    };

    syncFromStorage();
    window.addEventListener("focus", onFocus);
    window.addEventListener(SESSION_EVENT, syncFromStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SESSION_EVENT, syncFromStorage);
    };
  }, []); // No pathname dependency — prevents refetch on every route change (Priority 2)

  return { user, role, ready, refresh: () => syncCanonicalUser(true) };
}

export function initialsOf(user: SessionUser | null): string {
  if (!user) return "";
  const a = user.firstName?.trim()?.[0] ?? "";
  const b = user.lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}
