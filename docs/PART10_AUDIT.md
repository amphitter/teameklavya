# PART 10 — MESSAGES AUDIT (before state)

Read before any code was written. Every claim below was verified in the source,
not inferred.

## 1. There is no realtime for DMs at all

`services/realtime.service.js` owns **live events only** (rooms `event:{id}`).
`grep` for `dm:`, `direct`, `conversation` in that file and in `server.js`
returns nothing. The only `socket.join()` calls are
`roomKey(eventId)` and `activityRoomKey(...)` (lines 1202, 1220, 1260).

**Consequence:** the DM client polls. `frontend/src/app/(app)/messages/page.tsx`:

- conversation list — `usePolling(loadList, { intervalMs: 12_000 })`
- active thread — `usePolling(loadThread, { intervalMs: 6_000 })`

Every 6 s the thread poll does `setMessages(msgs)` — it **replaces the whole
array** with up to 100 refetched messages. Three separate defects follow:

1. A pending optimistic message is silently dropped by the next poll
   (the server does not have it yet), so the bubble the user is looking at
   vanishes and reappears.
2. The whole list re-renders on a timer even when nothing changed.
3. Fetches O(all messages in thread) every 6 s forever.

## 2. No cursor pagination anywhere

- `getConversations` — `.limit(50)`, no cursor (controller line ~38).
- `getMessages` — `.limit(min(100, …))`, no cursor (controller line ~113).

## 3. No idempotency

`sendMessage` has no `clientMessageId`. A retry after a timeout, or a
Socket.IO reconnect replaying a send, creates a second message. The existing
`idempotentPost()` helper is not used by the messages page.

## 4. Conversation list is heavier than it needs to be

`USER_FIELDS = "firstName lastName username profile"` — `profile` is the whole
subdocument (bio, avatar, cover, social links, institution). Populated for
**both** participants and again for `lastMessage.sender`, on every list poll.

Unread is recomputed by an aggregate that scans every unread message across
every conversation on every poll:

```js
Message.aggregate([
  { $match: { conversation: { $in: ids }, sender: { $ne: me }, readAt: null } },
  { $group: { _id: "$conversation", count: { $sum: 1 } } },
])
```

`Conversation.lastReadAt` (a Map added in Part 8 §34) exists but is never read
by `getConversations`.

## 5. Marking read is on the request path

`getMessages` awaits
`Message.updateMany({ conversation, sender: {$ne: me}, readAt: null }, …)`
**before** responding. Opening a thread with 300 unread blocks the response on
300 writes.

## 6. Search is client-side only

`filtered` in the page filters the already-loaded array. Searching for a
message the user has not scrolled to is impossible.

## 7. Frontend render structure

`messages/page.tsx` is 624 lines with ~20 `useState` hooks in one component.
Typing in the search box re-renders the entire page, including the thread.

## 8. Mobile layout

- `h-[calc(100vh-4rem)]` — **`100vh`, not `100dvh`** (spec §2).
- Composer has `paddingBottom: var(--keyboard-inset)` but **no
  `env(safe-area-inset-bottom)`**.
- Mobile pane switching is `hidden`/`flex` on two siblings inside one flex
  row — it works, but the thread pane is not a real route, so Android back
  exits Messages instead of returning to the list (spec §30).

## 9. Images

`MessageBubble` renders `cloudinaryUrl(message.image, { w: 560, h: 560 })` —
a single size, no thumbnail tier, no explicit width/height (layout shift).

## 10. What is already good and must not be regressed

- `MessageBubble` is already `memo()`ised with four independent
  sent/received signals (alignment, fill, text colour, tail) — §9 is largely
  met; keep it.
- `MessageList` already groups by author within a 4-minute window and inserts
  day separators (§8) — keep and extend.
- Grouping, reactions, reply, unsend, mute, hide, archive all work.
- `lib/query.ts` is a real cache with dedup + retry; **reuse it, don't fork it**.
- `MessageComposer` already tracks `visualViewport` for the keyboard.
- Emoji picker is a static list — no heavy library is loaded.
