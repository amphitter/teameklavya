# Part 11 — Teams, presence, typing, and faster conversations

Five asks, in the order they were given. Everything below was run, not planned.

| # | Ask | Status |
|---|-----|--------|
| 1 | Hide the bottom navbar inside a chat on a phone | **Already correct — verified, not changed** |
| 2 | Chats and messages take time to load — fix it | **Fixed** (2 real waits removed, 2 warm-ups added) |
| 3 | The typing animation must reach the other user | **Fixed** (the backend was the broken half) |
| 4 | Active / last-seen presence | **Implemented** (backend + UI, both halves) |
| 5 | Teams, not groups — create a team from followers / following / anyone | **Implemented** (API + full UI) |

---

## 1. The bottom navbar inside a chat

Already true before this part. `components/shell/app-shell.tsx` computes
`isChatRoute = /^\/messages\/[^/]+$/` and renders the nav with `hidden` on that
route, while `<main>` drops its bottom padding (`isMessagesRoute` → `pb-0`) so
the composer gets the space the nav was reserving.

Nothing was re-implemented. The reasoning is unchanged: `/messages/[id]` is a
real route, so the composer can own the bottom of the viewport and the nav has
nothing useful to do there.

## 2. Chats and messages loaded slowly

Two genuine waits sat in front of the data:

* **The inbox** ran `await readCachedInbox()` and only *then* called
  `refresh()`. An IndexedDB open — tens of ms cold, worse on a low-end phone —
  was in front of the request that actually had the rows.
* **The thread** did the same with `readCachedThread()` before
  `GET /messages/conversations/:id`.

Both now start the network request **first** and let the disk read race it.
Disk only seeds the store when it is still empty, so a slow disk can never
overwrite fresh data with stale.

Added on top, in the same spirit:

* `prefetchInbox()` — fired from the messages badge (which renders on every
  page) through `requestIdleCallback`, so the inbox is usually already in the
  store by the time Messages is opened. It seeds presence too.
* A once-per-page-load `GET /health` ping from the app shell. The backend runs
  on Render, which suspends an idle instance; that cold start was landing on
  the first tap of the day.

No new dependency, no polling, no timer: the store, the socket and the request
cache are the same three things as before.

## 3. Typing reaches the other user

The animation itself already existed (`TypingBubble`, driven by
`thread.isPeerTyping`). The broken half was the server: typing was published to
a single recipient, so a team never saw it and the wrong person sometimes did.

Now `publishTyping({ conversationId, senderId, toUserIds })` fans out to **every
other participant**, and the client stores typing **per user id**
(`thread.typing: Record<userId, untilEpochMs>`), so:

* a team shows “Ana is typing…” and names whoever is typing,
* one person withdrawing their indicator cannot cancel another's,
* repeated `typing:false` events do not replace the slice, so they cost no
  re-render.

Still zero database writes for typing, and still one debounced emitter
(`useTypingEmitter`) rather than an event per keystroke.

## 4. Active now / last seen

**Server.** `isUserOnline` is derived from live sockets — true the instant a
socket opens, no database involved. `lastSeenAt` is the durable half, written
at most once per 60 s per connected user plus once, forced, on the final
disconnect. A second tab does not re-announce a user; only the first socket
flips them online.

Presence is pushed **only to watchers of a conversation the user belongs to**,
so nobody's activity pattern leaks and no per-socket fan-out cost is paid for
people who are not looking.

**Client.** `dm:watch` / `dm:unwatch`, sent when a thread opens and withdrawn
when it closes, re-announced after every reconnect. Two shapes:

* `{ conversationId }` — the thread on screen. The server answers immediately
  with everyone's current state, so the header does not wait for the first
  transition.
* `{ conversationIds: [...], silent: true }` — the inbox list, batched into one
  query with no state burst, because the list already carries each row's
  presence from its REST read. Capped at 50 watches per socket.

**UI.** A green dot on avatars that are online; `Active now` / `Last seen 5m
ago` / `Last seen yesterday` in the thread header. Presence lives in its own
store slice **per user**, so a peer going offline re-renders a dot, not a list.
Exact timestamps are deliberately never shown.

## 5. Teams

> “GROUPS NHI, TEAMS HONGI”

The disabled **Groups** tab is gone. There is now a **Teams** tab, and the word
“group” appears nowhere a user can read it.

### Creating one
`New team` sits at the top of the inbox and inside every thread header. The
sheet is one screen: name it, then pick people from three real sources —

| Tab | Source |
|-----|--------|
| Followers | `GET /api/follow/:me/followers` |
| Following | `GET /api/follow/:me/following` |
| Anyone | `GET /api/users/suggested`, then debounced `GET /api/search?type=people` |

No fixtures, no invented people: an empty list says so.

### Using one
Team rows carry the name, a member count and **who spoke**
(“Ben: standup at 6”). Team bubbles name their sender. Team info (header menu)
shows the roster with owner/admin badges, and offers add / remove / leave —
each entry point gated by the role the server reports, not by a guess.

### API

```
POST   /api/messages/teams                    { name, memberIds[] }
GET    /api/messages/teams/:id/members        { members[], myRole }
POST   /api/messages/teams/:id/members        { userIds[] }
DELETE /api/messages/teams/:id/members/:userId   (self = leave)
PATCH  /api/messages/teams/:id                { name?, avatar? }
```

Owner does everything · admin renames and manages members · member sends,
reads and leaves · non-members see nothing, not even that the team exists.
The owner can never be removed. A team that drops below two members is
**closed, not deleted** (§7 — no source deletion). Cap: 100 members.
Membership is re-validated against the database on every write and never
trusted from the client.

### Bug found by the new tests, and fixed

`getOrCreateConversation`'s legacy fallback looked up a pair with
`Conversation.findOne({ participants: sorted })`. A **two-person team** has
exactly those two participants, so “message this person” could return the team
as if it were a private chat. The lookup is now guarded with
`type: { $ne: "team" }` — the pair key belongs to direct conversations only.
A test asserts the direct chat created for two people who share a two-person
team is not that team.

---

## Verification

| Suite | Result |
|-------|--------|
| `PART 11 TEAMS + PRESENCE` (new) | **82 passed, 0 failed** |
| `PART 10 MESSAGES BACKEND` | 59 / 0 |
| `PART 10 REALTIME` | 38 / 0 |
| `PART 8 BACKEND` | 95 / 0 |
| `MESSAGES STORE` (was 23, now covers presence, typing, teams) | **38 / 0** |
| `tsc --noEmit` | 0 errors |
| `next build` | compiled |

Reachability was grepped, per the Part 9 lesson: every new component
(`TeamCreateSheet`, `TeamInfoSheet`, `MemberPicker`, `PresenceDot`,
`PresenceText`, `watchConversations`) has a live import from a route or a
component that a route renders.

**Not verified, and cannot be from here:** Android, iPhone, 320/360/390/430 px,
the keyboard opening and closing, and scroll-position preservation — there is
no device or browser in this environment. Those remain the user's QA.

## Deploying

Backend first (new routes and socket events), then the frontend:

* `backend/` → Render
* `frontend/` → Vercel

The one-off `backend/scripts/fix-conversation-index.js --apply` was already run
in Part 10; nothing to re-run here.
