"use client";

/**
 * Socket.IO client singleton (Part 4, Phase 2).
 * - Identity from the stored JWT (same token as the HTTP api util) —
 *   the server derives the user, the client NEVER sends a userId (spec §80).
 * - Auto-reconnect is on; pages re-join rooms on reconnect (spec §51).
 * - If auth fails (e.g. re-login changed the token), the singleton is
 *   discarded so the next call reconnects with the fresh token.
 */
import { io, type Socket } from "socket.io-client";
import { API_ROOT } from "@/utils/api";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  /* API_ROOT is "" in same-origin mode: io() with no URL connects to the
     origin serving the page, which is exactly right there. */
  socket = io(API_ROOT || undefined, {
    auth: { token },
    // Low-latency upgrade: prefer websocket, keep polling as fallback only for restrictive networks
    // but start with websocket to avoid initial polling upgrade latency.
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    // Exponential backoff with jitter: 500ms * 2^attempt + rand(0..500), capped 5s
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 8000,
    // Reduce initial connection latency
    autoConnect: true,
    // Force new connection if token changed handled via resetSocket on logout
  });

  // Refresh auth token on each reconnection attempt — token may have been refreshed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (socket as any).on("reconnect_attempt", () => {
    if (typeof window !== "undefined") {
      const fresh = localStorage.getItem("token");
      if (fresh) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (socket as any).auth = { token: fresh };
      }
    }
  });

  socket.on("connect_error", (err: Error) => {
    let isAuthFailure = false;
    try {
      const parsed = JSON.parse(err.message);
      isAuthFailure = parsed?.code === "AUTH_FAILED";
    } catch {
      isAuthFailure = err.message?.includes("AUTH_FAILED") || false;
    }
    if (isAuthFailure && socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  });

  // Visibility & network recovery: when tab becomes visible or online, ensure socket is connected
  if (typeof window !== "undefined") {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && socket && !socket.connected) {
        socket.connect();
      }
    };
    const onOnline = () => {
      if (socket && !socket.connected) socket.connect();
    };
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    // Clean up listeners when socket is reset — handled via resetSocket removing all
  }

  return socket;
}

/** Drop the singleton (used on logout / auth failure). */
export function resetSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
