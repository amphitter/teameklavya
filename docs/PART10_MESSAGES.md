# PART 10 — MESSAGES SYSTEM

Instagram-speed DMs on EventHub. This document is the record of what changed,
what it changed **from**, and what was verified.

---

## 1. FILES / MODULES CHANGED

### Backend

| File | Change |
|---|---|
| `models/message.model.js` | added `clientMessageId` (partial unique index); replaced the index block with a documented, minimal set |
| `models/conversation.model.js` | **added `participantsKey`** + `pairKeyOf()`; **removed the broken unique `{participants:1}` index**; added `{participants, updatedAt}` |
| `controllers/message.controller.js` | rewrote `getConversations`, `getMessages`, `getUnreadCount`; added `searchMessages`; added idempotent send; added realtime publishes; fixed `getOrCreateConversation`; slimmed all projections |
| `services/dm-realtime.service.js` | **NEW** — user-room fan-out, typing, read announcements, delete propagation |
| `services/realtime.service.js` | joins `user:{id}` on connect; registers DM handlers; attaches the DM service; adds `typingGuard` |
| `config/socket-protocol.js` | added `C_DM_TYPING`, `C_DM_READ`, `S_DM_MESSAGE`, `S_DM_TYPING`, `S_DM_READ`, `S_DM_DELETED` |
| `config/rate-limits.js` | added `REALTIME_TYPING` (40/min) |
| `routes/message.routes.js` | registered `GET /search` before the `/:id` catch-alls |
| `scripts/fix-conversation-index.js` | **NEW** — dry-run-by-default index repair + `participantsKey` backfill |
| `tests/part10-messages.js` | **NEW** — 59 assertions |
| `tests/part10-realtime.js` | **NEW** — 38 assertions |

### Frontend

| File | Change |
|---|---|
| `lib/messages/store.ts` | **NEW** — per-slice external store |
| `lib/messages/cache.ts` | **NEW** — IndexedDB warm-start cache |
| `hooks/use-messages.ts` | **NEW** — store-bound hooks, optimistic send, server search |
| `hooks/use-dm-socket.ts` | **NEW** — one DM subscription for the app, routing, typing emitter |
| `components/messages/thread-view.tsx` | **NEW** — windowed thread, scroll anchoring, grouping |
| `components/messages/thread-panel.tsx` | **NEW** — header + thread + composer |
| `components/messages/conversation-list.tsx` | **NEW** — compact inbox, tabs, server search |
| `app/(app)/messages/page.tsx` | rewritten (was 624 lines of polling + inline panes) |
| `app/(app)/messages/[id]/page.tsx` | **NEW** — a conversation is now a route |
| `components/messages/message-composer.tsx` | safe-area + keyboard, typing emit, non-blocking send |
| `components/messages/message-bubble.tsx` | thumbnails, retry affordance, read-tick state |
| `components/messages/message-list.tsx` | **deleted** — superseded by `thread-view.tsx` |
| `components/shell/messages-link.tsx` | realtime badge, poll removed |
| `components/shell/app-shell.tsx` | `/messages` opts out of shell padding; nav hidden in a chat; logout clears store + cache |
| `components/ui/emoji-picker.tsx` | reduced to the trigger |
| `components/ui/emoji-picker-panel.tsx` | **NEW** — lazy panel; also fixed a conditional hook |
| `hooks/use-social.ts` | removed the polling conversation hooks |
| `tests/messages-store.test.js` + `tests/run-messages-store-tests.js` | **NEW** — 23 assertions |

---

## 2. ARCHITECTURE: BEFORE → AFTER

### Before

```
page.tsx (624 lines, ~20 useState)
  ├─ usePolling(list, 12_000)      → replaces the whole conversation array
  ├─ usePolling(thread, 6_000)     → replaces the whole message array
  ├─ header badge: usePolling(30_000)
  └─ panes switched by CSS hidden/flex inside one flex row
No realtime for DMs at all. No cursor. No idempotency. No cache.
```

The 6-second thread poll is the root of most reported slowness:

1. it **replaced** `messages` wholesale, so a pending optimistic bubble was
   deleted on the next tick and re-appeared when its POST landed;
2. it re-rendered the entire list on a timer even with no change;
3. it refetched up to 100 messages with full sender profiles every 6 seconds;
4. opening a thread blocked the response on a `updateMany` marking up to 100
   messages read.

### After

```
/messages            → inbox screen        (route)
/messages/[id]       → conversation screen (route)

Socket.IO  ── dm:message / dm:typing / dm:read / dm:deleted
            └─→ lib/messages/store.ts  (per-slice, surgical)
                    ├─ thread:{id}   → only the open thread re-renders
                    ├─ inbox / archived → only the list re-renders
                    └─ unread        → only the badge re-renders
REST  → the source of truth for initial pages and for every write
IndexedDB → first-paint content on a warm start
```

**Routing rule (§12).** Every event carries `conversationId`. If it matches the
open conversation the thread slice is updated; otherwise only the inbox row and
the badge are. Because slices are keyed per conversation, "otherwise" means the
open thread is not written to at all — so it cannot re-render. A message
arriving in conversation B while the user reads A does not touch A.

---

## 3. API REQUESTS REMOVED / REDUCED

The old implementation polled. Verbatim, per open tab:

| Source | Before | After |
|---|---|---|
| Conversation list | every 12 s → **5/min** | once, + cursor pages |
| Open thread | every 6 s → **10/min** | once, + `before=` pages on scroll |
| Header badge | every 30 s → **2/min** | once on mount, then realtime |
| Typing | n/a | **0 requests** — socket only |
| Read receipts | side effect of opening the thread | 1 batched call per new incoming message |
| Search | 0 requests (client-side, so useless) | 1 per settled query (300 ms debounce) |
| **Total, idle conversation open** | **≈17 requests/min** | **0/min** |

Payload per request, measured from the projections:

| | Before | After |
|---|---|---|
| Conversation list | 50 rows × 2 full profiles + a last-message profile | 20 rows × `firstName lastName username profile.avatar` |
| Thread | ≤100 messages, full sender profile, `__v` | 30 messages, named fields only |
| Badge | `find` all conversations + `countDocuments` | two indexed counts (see §5) |

Search changed from "filter the rows already loaded" (which could not find a
message the user had not scrolled to) to a server query scoped to the caller's
own conversations.

---

## 4. DATABASE QUERIES OPTIMISED

| Query | Before | After |
|---|---|---|
| Unread count | `countDocuments({conversation: {$in: allMine}, readAt: null, sender: {$ne: me}})` — full collection filter | same predicate, now served by `{conversation, readAt, sender}` |
| Inbox | `.sort({updatedAt: -1}).limit(50)` on `{participants}` — in-memory sort of the user's whole set | `.sort({updatedAt: -1, _id: -1})` served by `{participants, updatedAt}` |
| Thread page | `find({conversation}).sort({createdAt: -1}).limit(100)` | same index, `limit=30`, `before`/`after` resolved to a `(createdAt, _id)` seek |
| Read marking | `updateMany` **awaited before responding** | `updateMany` fired, response not blocked; skipped entirely on history scrolls |
| Conversation lookup | exact-array match on `participants` | scalar `participantsKey` (also fixes the bug in §7) |
| Projections | whole documents + full `profile` subdocs | explicit field lists |

**Why two counts instead of one.** §24 requires an archived thread to keep its
unread visible inside the archive but not to reappear in the inbox. A single
number cannot express both, so `unread-count` returns `unreadCount` **and**
`archivedUnreadCount`. Both are computed concurrently, and each visits only
unread documents — O(unread), not O(messages).

**Why `lastReadAt` was not used.** Part 8 added that Map but nothing ever wrote
to it except `markRead`. Adopting it would create a second source of truth for
"read", able to disagree with `readAt`, and would need a backfill of every
conversation. `readAt` per message already is the truth; the new index makes
counting it cheap.

---

## 5. NEW INDEXES

Deliberately short — §15 warns against adding them blindly. Each names the
query it serves.

| Collection | Index | Serves |
|---|---|---|
| Message | `{conversation: 1, createdAt: -1}` | thread read, forward and backward; the `before`/`after` cursor seek |
| Message | `{conversation: 1, readAt: 1, sender: 1}` | unread counts (badge, inbox) |
| Message | `{clientMessageId: 1}` unique, partial | idempotent send |
| Conversation | `{participantsKey: 1}` unique, partial | one conversation per **pair** |
| Conversation | `{participants: 1, updatedAt: -1}` | inbox membership + ordering |

**Not added:** `{conversation, sender, createdAt}`. The spec lists it, but no
query filters on all three — `{conversation, readAt, sender}` covers the unread
path and `{conversation, createdAt}` the thread path. It would tax the hottest
write in the app for zero reads.

**Not a text index** (so not listed above). §25 search is prefix-based — typing
`hel` must match `hello`. `$text` tokenises whole words and would not. The
regex is bounded to the caller's own conversations, so index (1) turns it into
one bounded seek per thread and the cost scales with the user's own message
volume, not the collection.

---

## 6. REALTIME OPTIMISATIONS

- **One room per user**, not per conversation. Every authenticated socket joins
  `user:{id}`. There is no `dm:join`/`dm:leave` state to leak, the inbox hears
  about conversations the user is not reading, and multi-device works with no
  extra code.
- **No whole-conversation refetch after an event.** A `dm:message` appends the
  one message (deduped by id **and** `clientMessageId`).
- **Typing never writes to the database.** Verified by assertion, including
  that the conversation document's `updatedAt` is untouched.
- **Typing self-expires.** The server holds a 6 s timer per (user, conversation)
  and cancels it on `typing:false`, so a client killed mid-typing cannot leave
  a permanent "typing…". The client expires independently at the same deadline.
- **Read receipts are announced, not per-message written.** One `updateMany`
  per batch; the peer learns via `dm:read` and does not refetch.
- **Unsend propagates** so the peer drops the content without a refetch.
- **Reconnect replays nothing.** Socket.IO re-runs the connection handler, so
  the user room is re-joined automatically; a fresh socket receives no history.
  The client then catches up with a single `?after=<newestId>` fetch — only the
  gap.

---

## 7. MOBILE-SPECIFIC FIXES

- **§30 — separate screens.** `/messages` is the inbox; `/messages/[id]` is the
  conversation. Back (button or iOS swipe) returns to the inbox because it *is*
  the previous history entry. The old implementation swapped two panes inside
  one flex row, so Android back exited Messages entirely.
- **§2 — `dvh`, not `vh`.** Both screens size against `100dvh` (with `100vh`
  declared first as the fallback), minus the shell header, minus the bottom nav
  where the nav is present.
- **§2 — the bottom nav is hidden inside a conversation** so the composer can
  own the bottom edge. It stays on the inbox, so the five destinations are
  always one tap away.
- **§2 — the shell stops adding padding on `/messages`.** Every other page is a
  scrolling document, so the shell reserves 4.5 rem for the fixed nav; a chat
  cannot work that way, and that padding put the composer below the fold.
- **Safe area.** The composer pads with
  `max(var(--keyboard-inset), env(safe-area-inset-bottom))`. A `max()`, not a
  sum — otherwise the composer would float a home-bar's height above the
  keyboard.
- **§44 — 44 px targets.** Composer buttons, the back button, the header icon
  and the row height all meet it. `touch-manipulation` removes Android's tap
  delay.
- **Keyboard.** `visualViewport` drives `--keyboard-inset`; the composer tracks
  it and stays directly above the keyboard. Sending does not steal focus back
  on touch devices, where re-focusing can round-trip through a keyboard
  close/open that visibly jolts the composer.

---

## 8. RENDERING / PERFORMANCE FIXES

- **One slice per concern.** `thread:{id}`, `inbox`, `archived`, `unread` are
  separate slices. A subscriber re-renders only when *its* slice is replaced —
  asserted in the store test (`writing thread t5 does NOT notify a t4
  subscriber`).
- **Typing does not touch the store.** The composer's text is local state; only
  the debounced `dm:typing` signal leaves the component.
- **Windowing above 60 messages** (§6), with measured row heights and an
  overscan of 12. Below 60 everything renders — windowing a short conversation
  buys nothing and adds moving parts.
- **Scroll position is preserved across a prepend** (§5): `scrollHeight` is
  captured while the older page is in flight and the delta is added to
  `scrollTop` in a layout effect, so the message the reader was on stays under
  the same pixel.
- **Bottom stickiness is conditional.** Auto-scroll only happens when the
  reader is already within 140 px of the bottom. The scroll-jump is scoped to
  the conversation, so an arriving message cannot yank someone out of history.
- **Sends are never blocked.** The composer no longer disables on an in-flight
  text send; each send carries its own `clientMessageId`, so firing two quickly
  is safe and neither waits.
- **Images are thumbnails.** A 240 px Cloudinary variant with reserved
  dimensions, `loading="lazy"`, `decoding="async"` — the original is fetched
  only when the photo is opened.
- **Emoji panel is a separate chunk.** Verified in the build: the panel lives
  in its own file, and the chunk containing the trigger does not contain the
  panel's contents.

---

## 9. ASSUMPTIONS

1. **The `{participants: 1}` unique index was a bug, not a feature.** Read as
   "one conversation per pair"; MongoDB implemented it as "no two documents may
   share any participant". The replacement is deliberately conservative (see
   §7 below) and ships with a dry-run migration.
2. **`status: "hidden"` stays moderation-owned.** Unchanged from Part 9 — not
   reused for user archiving.
3. **Group conversations do not exist.** The `Groups` tab renders but is
   disabled with a tooltip, rather than showing a permanent empty state for a
   feature that is not there.
4. **Video messages have no backend support.** The Message model carries
   `image` and a file `attachment`; there is no video field, no transcoding and
   no poster generation. Nothing was faked: video uploads go through the
   existing file path and render as a file link, and no video bubble UI was
   invented.
5. **An `unarchive` endpoint was not added.** Archiving is one toggle
   (`{archived: true|false}`), so unarchiving already works and is tested.
6. **Read receipts are coarse** — a batch timestamp per conversation, not a
   per-message watermark. `readAt` on each message is set to the same instant.
7. **The migration is not auto-run.** Per the standing rule that structural
   operations are opt-in, `scripts/fix-conversation-index.js` dry-runs by
   default.

---

## 10. REMAINING LIMITATIONS

Honest list. None of these is hidden behind a fake UI.

1. **The index migration must be run once.** Until
   `node scripts/fix-conversation-index.js --apply` runs against production, the
   broken `participants_1` index is still present and a user with an existing
   conversation still cannot start a second one. **This is the one thing that
   needs a human.** It is idempotent, dry-runs by default, and skips (and
   reports) any conversation that does not have exactly two participants rather
   than guessing.
2. **No real browser was available in this environment.** Mobile QA is a code
   audit plus JSDOM-free unit assertions, not a device test. The specific
   checks that need a device — iOS Safari keyboard behaviour, Android Chrome
   resize, 320/360/390/430 px rendering — are listed in §38 of the spec and are
   **not** claimed as verified.
3. **Windowing is measurement-driven** and therefore approximate until rows
   have been seen once; the first screen or two of scrolling can shift slightly
   as heights are learned. It only engages above 60 messages.
4. **`Reconnecting…` is driven by the socket**; a REST failure while the socket
   is healthy surfaces as the inline retry on the failed message rather than as
   a connection banner.
5. **Search scope.** Conversations are matched on participant name/username and
   last-message text; messages on body text. Attachments are not searched, and
   there is no ranking beyond recency.
6. **Typing is 1:1 only** — meaningless without groups, and groups do not exist.
