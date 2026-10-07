"use client";

/**
 * Presence watch subscriptions (Part 11 §4)
 * ─────────────────────────────────────────
 * The server pushes presence only to sockets that asked to watch a
 * conversation, which keeps one user's comings and goings from being
 * broadcast to people they have never spoken to.
 *
 * THIS MODULE EXISTS TO BREAK A CYCLE. The inbox hook needs to watch, the
 * socket hook needs to re-announce watches after a reconnect, and the socket
 * hook already imports the inbox hook for `refreshUnread`. Putting the watch
 * registry in its own module that depends on nothing but the socket means no
 * import cycle, and the re-announce is a plain function call rather than a
 * hook ordering puzzle.
 */

import { getSocket } from "@/lib/socket";

/** Conversations the inbox is following, remembered for reconnect replay. */
const inboxWatches = new Set<string>();

/**
 * Watch a set of conversations WITHOUT asking for their current state.
 *
 * The conversation list already carries each row's presence from its REST
 * read, so the only thing missing on that screen is what happens next.
 * Batching the ids into one event keeps opening Messages to a single round
 * trip rather than one per row, and `silent` skips a reply the client would
 * only discard.
 */
export function watchConversations(conversationIds: string[]): void {
  if (!conversationIds.length) return;
  conversationIds.forEach((id) => inboxWatches.add(id));
  const socket = getSocket();
  if (!socket.connected) return; // replayed on the next connect
  socket.emit("dm:watch", { conversationIds, silent: true });
}

export function unwatchConversations(conversationIds: string[]): void {
  if (!conversationIds.length) return;
  conversationIds.forEach((id) => inboxWatches.delete(id));
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit("dm:unwatch", { conversationIds });
}

/**
 * Re-announce every inbox watch. Called on connect: a fresh socket has no
 * subscriptions, and without this the list's dots would silently freeze after
 * a network drop — the failure mode where everything looks fine until someone
 * goes offline and the label never changes.
 */
export function replayInboxWatches(): void {
  if (!inboxWatches.size) return;
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit("dm:watch", { conversationIds: [...inboxWatches], silent: true });
}

/** A single conversation, watched while its thread is on screen. */
export function watchThread(conversationId: string, options: { silent?: boolean } = {}): void {
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit("dm:watch", options.silent ? { conversationId, silent: true } : { conversationId });
}

export function unwatchThread(conversationId: string): void {
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit("dm:unwatch", { conversationId });
}

/** Test seam — clears the registry so a fresh session starts empty. */
export function resetInboxWatches(): void {
  inboxWatches.clear();
}
