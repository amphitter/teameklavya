"use client";

/**
 * Part 8 data hooks (§54).
 *
 * "Do not scatter fetch calls randomly inside components."
 *
 * These wrap the existing query layer (src/lib/query.ts), which already
 * provides caching, request de-duplication, retry-with-backoff, polling and
 * infinite pagination. Re-implementing any of that here would fork the cache
 * and produce the double-fetching §63 warns about — so every hook below is a
 * thin, typed façade over the shared client.
 */

import { useCallback, useMemo } from "react";
import { api } from "@/utils/api";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  queryClient,
  type UseQueryOptions,
} from "@/lib/query";

/* ── Stories (§15-19, §57) ─────────────────────────────────────────────── */

export interface StoryMedia {
  url: string;
  publicId?: string;
  type?: "image" | "video";
  width?: number;
  height?: number;
  poster?: string;
}

export interface StoryItem {
  _id: string;
  author?: StoryAuthor;
  media: StoryMedia;
  caption?: string;
  category?: string;
  categoryIcon?: string;
  categoryLabel?: string;
  event?: { _id: string; title?: string; slug?: string; bannerUrl?: string } | null;
  textOverlay?: string;
  link?: string;
  createdAt: string;
  expiresAt: string;
  archivedAt?: string | null;
  viewsCount?: number;
  viewedByMe?: boolean;
  archived?: boolean;
}

export interface StoryAuthor {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  verified?: boolean;
  profile?: { avatar?: string; coverImage?: string };
}

export interface StoryGroup {
  author: StoryAuthor;
  stories: StoryItem[];
  isMe: boolean;
  hasUnseen: boolean;
}

export function useStories(options?: UseQueryOptions<any>) {
  const q = useQuery<{ groups: StoryGroup[]; ttlHours: number }>(["/stories"], "/stories", {
    // §57 — a story can expire while the tab is open; without a refresh the
    // rail would keep showing one that has already aged out.
    refetchInterval: 60_000,
    ...options,
  });
  return { ...q, groups: q.data?.groups ?? [] };
}

export function useStoryCategories() {
  const q = useQuery<{ categories: { key: string; label: string; icon: string; count: number }[] }>(
    ["/stories/categories"],
    "/stories/categories",
    { refetchInterval: 120_000 }
  );
  return { ...q, categories: q.data?.categories ?? [] };
}

export function useStoryArchive() {
  const q = useQuery<{ groups: { key: string; label: string; stories: StoryItem[] }[] }>(
    ["/stories/archive"],
    "/stories/archive"
  );
  return { ...q, groups: q.data?.groups ?? [] };
}

export function useCreateStory() {
  return useMutation((body: {
    media: { url: string; publicId?: string; type?: "image" | "video"; width?: number; height?: number; poster?: string };
    caption?: string;
    category?: string;
    event?: string;
    textOverlay?: string;
    link?: string;
  }) => api.post("/stories", body).then((r) => r.data), {
    // §57 — the rail must reflect a new story immediately, and the archive
    // page (if open) must gain it too.
    invalidate: [["/stories"], ["/stories/categories"], ["/stories/archive"]],
  });
}

export function useDeleteStory() {
  return useMutation((id: string) => api.delete(`/stories/${id}`).then((r) => r.data), {
    invalidate: [["/stories"], ["/stories/archive"], ["/stories/categories"]],
  });
}

export function useMarkStoryViewed() {
  return useMutation((id: string) => api.post(`/stories/${id}/view`, {}).then((r) => r.data));
}

/* ── Comments (§12-14) ─────────────────────────────────────────────────── */

export interface CommentData {
  _id: string;
  author?: { _id: string; firstName?: string; lastName?: string; username?: string; verified?: boolean; profile?: { avatar?: string } };
  content: string;
  createdAt: string;
  parent?: string | null;
  replyCount?: number;
  likesCount?: number;
  likedByMe?: boolean;
  removedAt?: string | null;
  pending?: boolean;
}

export function useComments(postId: string | null) {
  const q = useQuery<{ comments: CommentData[] }>(
    ["/posts", postId, "comments"],
    postId ? `/posts/${postId}/comments` : null,
    { enabled: Boolean(postId) }
  );
  return { ...q, comments: q.data?.comments ?? [] };
}

/** Replies load on demand behind "View replies (N)" (§13). */
export function useReplies(postId: string, commentId: string | null) {
  const q = useQuery<{ replies: CommentData[] }>(
    ["/posts", postId, "comments", commentId, "replies"],
    commentId ? `/posts/${postId}/comments/${commentId}/replies` : null,
    { enabled: Boolean(commentId) }
  );
  return { ...q, replies: q.data?.replies ?? [] };
}

export function useAddComment(postId: string) {
  return useMutation(
    (body: { content: string; parent?: string }) =>
      api.post(`/posts/${postId}/comments`, body).then((r) => r.data),
    { invalidate: [["/posts", postId, "comments"]] }
  );
}

export function useLikeComment(postId: string) {
  return useMutation(
    (commentId: string) => api.post(`/posts/${postId}/comments/${commentId}/like`, {}).then((r) => r.data),
    { invalidate: [["/posts", postId, "comments"]] }
  );
}

export function useDeleteComment(postId: string) {
  return useMutation(
    (commentId: string) => api.delete(`/posts/${postId}/comments/${commentId}`).then((r) => r.data),
    { invalidate: [["/posts", postId, "comments"]] }
  );
}

/* ── Profile (§20-27, §56) ─────────────────────────────────────────────── */

export interface ProfileUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  verified?: boolean;
  role?: string;
  profile?: {
    avatar?: string;
    coverImage?: string;
    /** Vertical focal point of the cover, 0–100 (§7 — "repositionable"). */
    coverPosition?: number;
    bio?: string;
    location?: string;
    website?: string;
    institution?: string;
    course?: string;
    year?: string;
    interests?: string[];
  };
  socialSettings?: {
    profileVisibility?: string;
    allowMessagesFrom?: string;
    showAttendance?: boolean;
    showAchievements?: boolean;
  };
}

export function useProfile(idOrUsername?: string | null) {
  const q = useQuery<{ user: ProfileUser }>(
    ["/users", idOrUsername],
    idOrUsername ? `/users/${idOrUsername}` : null,
    { enabled: Boolean(idOrUsername) }
  );
  return { ...q, profile: q.data?.user ?? null };
}

/**
 * Classify a failed profile save so the UI can say something true.
 *
 * The report listed a "Couldn't save profile" toast next to a 200 response and
 * an `API Error: canceled` in the console. Both come from one habit: treating
 * every rejected promise the same. These are four different situations with
 * four different answers, and a cancellation is not an error at all — a
 * component unmounting, a newer save replacing a stale one, or the user
 * navigating away must be silent.
 */
export type SaveFailure =
  | { kind: "cancelled" }
  | { kind: "network"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "server"; message: string };

export function classifySaveError(error: unknown): SaveFailure {
  const e = error as {
    code?: string;
    name?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string; errors?: { message?: string }[] } };
  };

  // AbortController / axios cancellation — never the user's problem.
  if (e?.code === "ERR_CANCELED" || e?.code === "ECONNABORTED" || e?.name === "CanceledError") {
    return { kind: "cancelled" };
  }

  const status = e?.response?.status;
  const serverMessage =
    e?.response?.data?.message || e?.response?.data?.errors?.[0]?.message || "";

  if (!status) {
    // No response at all: offline, DNS, CORS, timeout.
    return { kind: "network", message: "Couldn't connect. Please check your connection and try again." };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", message: serverMessage || "Your session expired — please sign in again." };
  }
  if (status >= 400 && status < 500) {
    return { kind: "validation", message: serverMessage || "Some details were rejected. Please review them." };
  }
  return { kind: "server", message: serverMessage || "Couldn't save your profile. Please try again." };
}

export function useEditProfile() {
  return useMutation((body: Record<string, unknown>) =>
    api.put("/auth/me/profile", body).then((r) => r.data), {
    // §56 — one save must refresh the profile everywhere it is rendered:
    // header, nav avatar, post author labels, cached profile.
    invalidate: [["/auth/me"], ["/posts"], ["/users"]],
    /* Let the sheet see the real failure. Without this a 422 and a cancelled
       request both arrived as `undefined`, so the sheet showed the same
       "Couldn't save" line for both — the false failure in the report. */
    throwOnError: true,
    }
  );
}

/** §23 — availability is checked server-side while typing. */
export function useUsernameAvailability(username: string, enabled = true) {
  const clean = username.trim().toLowerCase();
  const valid = clean.length >= 3 && /^[a-z0-9_]{3,30}$/.test(clean);
  const q = useQuery<{ available: boolean; reason?: string; message?: string }>(
    ["/auth/username-availability", clean],
    valid && enabled ? `/auth/username-availability?username=${encodeURIComponent(clean)}` : null,
    {
      enabled: valid && enabled,
      /* Five minutes, not thirty seconds. Retyping a name you already checked
         (deleting a character and putting it back) is a common pattern, and
         each round trip to a cold API is what made this feel slow. The key is
         the username, so editing down to a name already checked is free. */
      staleTime: 5 * 60_000,
    }
  );
  return {
    available: q.data?.available ?? null,
    reason: q.data?.reason,
    message: q.data?.message,
    checking: valid && enabled && q.isFetching,
    valid,
  };
}

/* ── Messages (§28-35, §58) ────────────────────────────────────────────── */

export interface Conversation {
  _id: string;
  other: StoryAuthor | null;
  lastMessage?: { text: string; at: string; mine: boolean } | null;
  updatedAt: string;
  unreadCount: number;
  muted?: boolean;
  archived?: boolean;
}

export interface ChatMessage {
  _id: string;
  sender?: { _id: string; firstName?: string; lastName?: string; username?: string; profile?: { avatar?: string } } | null;
  content: string;
  image?: string;
  attachment?: { url?: string; name?: string; size?: number; mime?: string };
  replyTo?: string | null;
  reactions?: { emoji: string; count: number; mine: boolean }[];
  deletedAt?: string | null;
  readAt?: string | null;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
}

/* ── Messages: REMOVED in Part 10 ────────────────────────────────────────
 *
 * `useConversations`, `useConversation` and `useArchiveConversation` lived
 * here and polled the API on fixed intervals (15s for the inbox, 8s for an
 * open thread). They are gone, not deprecated, because keeping them would
 * leave a SECOND way to load messages — one that refetches whole
 * conversations on a timer and cannot reconcile an optimistic send. The
 * messages data path is now single:
 *
 *   realtime events    → hooks/use-dm-socket.ts
 *   state              → lib/messages/store.ts
 *   reads / writes     → hooks/use-messages.ts
 *   rendering          → components/messages/*
 *
 * `ChatMessage` stays here because the store and the bubble type against it.
 */

/* ── Shared helpers ────────────────────────────────────────────────────── */

/** Optimistically patch a cached list, then let invalidation correct it (§45). */
export function useOptimisticPatch() {
  return useCallback((key: readonly unknown[], updater: (prev: any) => any) => {
    queryClient.setQueryData(key, updater);
  }, []);
}

/** Stable empty array reference — avoids a new [] breaking memoisation (§63). */
export function useEmptyArray<T>(): T[] {
  return useMemo(() => [], []);
}
