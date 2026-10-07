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

---

# Mobile pass — "when we open stuff it's breaking things, remove the top navbar too"

Reported from a phone. I stopped guessing and drove the real UI in a headless
Chromium at 390×844, 360×800 and 320×568, against a **real backend** (seeded
people, a team, a direct chat, live sockets). The harness is in
`docs/mobile-qa/` and is re-runnable.

## What was actually wrong

**One — the chrome stacked.** On a phone the shell's 56px top bar sat above the
thread's own 56px header, so a conversation opened with ~112px of chrome before
the first message, plus the "Connecting…" row. That is the "breaking" that was
visible on every screen.

**Two — the sheets' action buttons were at the very bottom edge.** A full-height
panel runs to the bottom of the layout viewport, so on a phone the button sat
under the home indicator, and with the keyboard open it sat under the keyboard.
Padding the *footer* does not fix this — the panel still extends underneath.
The inset has to go on the sheet **root**, which shrinks the box the panel
measures itself against.

**Three — the viewport maths still subtracted a header that no longer exists.**
With the top bar gone, `calc(100dvh - 8rem)` on the inbox and
`calc(100dvh - 3.5rem)` on a thread would have left a dead strip at the foot of
both screens. Fixed to 4.5rem (the nav) and 100dvh (a chat has no shell chrome
at all below lg).

## What changed

| Change | Why |
|--------|-----|
| Top bar is `hidden lg:block` | No top navbar on a phone, on any route |
| Bottom nav is six items: Home · Explore · Create · **Messages** · Alerts · Profile | The Messages icon lived in the top bar. Removing the bar without this would re-open the P0 where Messages was unreachable on a phone |
| Account menu gained **Search** and the theme switch | Both were top-bar controls; the theme could not be changed on a phone otherwise. Search also still exists as the feed's own phone field |
| Thread page height → `100dvh` (was `100dvh - 3.5rem`) | A chat hides both bars; it owns the whole viewport |
| Inbox height → `100dvh - 4.5rem` (was `8rem`) | Only the bottom nav is left to reserve |
| `top-[104px]` → `top-2` on the organizer form's chip row | It was measured down from the header's height |
| All three sheets: keyboard/safe-area inset on the sheet root | Action buttons clear the keyboard and the home indicator |
| `hooks/use-keyboard-inset.ts` (new) | One implementation, element-scoped CSS variable — never a document-wide one |

## Evidence (production build, real backend, real sockets)

```
iphone-390 / android-360 / small-320
  header (top bar)          none, height 0, display:none     ← gone
  bottom nav                left=0 right=390, bottom=844     ← full width, on screen
  nav items                 6: Home|Explore|Create|Messages (7 unread)|Notifications|Profile
  horizontal overflow       0 on every route tested

two users, live sockets
  Ana types in the team     Ben's screen: "Ana Roy is typing…"      ← reached the peer
  Ana stops                 indicator cleared on its own
  Ben opens the DM          header: "Ana Roy · Active now"
  inbox                     1 "Active now" dot, rows name the team and WHO spoke

team info sheet            3 members listed from the real roster (Ben is a plain
                           member, so no Remove/Add buttons — correct)
keyboard (simulated 300px) panel 844 → 544; "Create team" 832 → 532  ← clear of the keyboard

nine routes × two widths   0 overflow, 0 page errors, no top bar anywhere
```

## Correction to my own earlier report

Three things I flagged while investigating were **my test's fault, not the
app's**, and I am recording that rather than quietly dropping them:

* The "0 members" team sheet was my mock missing the roster endpoint. Against
  the real API the roster loads with roles.
* The missing typing indicator in the first screenshot was my mock omitting
  `userId` from the socket payload, which the client correctly ignores.

A 5px overflow in the 320px inbox — a chip reaching x=325 — sat on my
open-defects list and does **not** reproduce against the real backend: all four
tabs (All / Unread / Teams / Archived) at 320, 360 and 390 measure
`overflow = 0` with no element past the right edge. It came from a mocked run,
so nothing was broken and no fix was made.

The ~4px gutter I saw in the dev-server screenshots was the Next.js dev
overlay, not a layout bug: in a production build `body` has `margin: 0` and the
nav spans 0 → 390.

## Still not verified (no device here)

Real iOS/Android keyboards, real safe-area insets (the emulator reports 0, so
the sheet lift was proven by simulating a 300px keyboard rather than a real
one), gesture navigation, and text-entry behaviour with a real IME. `env()`
handling is present and correct by construction, but the geometric proof above
uses a simulated inset.
