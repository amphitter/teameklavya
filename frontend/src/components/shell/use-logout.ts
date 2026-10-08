"use client";

/**
 * The one sign-out path.
 *
 * Signing out is four steps in a fixed order, and one of them is a privacy
 * requirement rather than a convenience: the messages store and its IndexedDB
 * cache hold this user's conversations, so they are cleared BEFORE the token
 * goes away. Left behind, the next account to sign in on this device paints the
 * previous user's threads for a frame (Part 10 §23).
 *
 * It lives here because there are now two ways to sign out — the account menu
 * and Settings — and a second copy would be a second chance to forget the
 * cache.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { resetMessagesStore } from "@/lib/messages/store";
import { clearMessagesCache } from "@/lib/messages/cache";
import { resetSocket } from "@/lib/socket";

export function useLogout() {
  const router = useRouter();

  return useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    resetMessagesStore();
    void clearMessagesCache();
    resetSocket();
    toast.success("Logged out");
    router.push("/");
    router.refresh();
  }, [router]);
}
