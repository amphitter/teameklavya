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
  socket = io(API_ROOT, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });
  socket.on("connect_error", (err: Error) => {
    let isAuthFailure = false;
    try {
      const parsed = JSON.parse(err.message);
      isAuthFailure = parsed?.code === "AUTH_FAILED";
    } catch {
      isAuthFailure = false;
    }
    if (isAuthFailure && socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  });
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
