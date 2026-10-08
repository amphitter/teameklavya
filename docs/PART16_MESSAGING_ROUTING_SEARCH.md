# Part 16 §D — Messaging: conversation routing, search and the DM surface

**Scope:** §71–§101. Profile → Message end-to-end, search inside Messages (people **and**
chats), the DM surface's zoom/overflow rules, the Old Feed's liked-post eligibility, and the
profile header's layout at every width the brief names.

**Status:** implemented on top of `f7c9dd5`, verified against the running app. See
"Evidence" — every number below is a harness run against the live build, not a code reading
exercise.

---

## 1 · What was actually broken (root causes)

The brief is explicit that the visible button must not be the only thing patched. Tracing the
whole path — click → conversation creation → route → chat load → composer — found five
distinct causes, only one of which lived in the button:

| # | Cause | Where |
|---|-------|-------|
| 1 | **The Message button created nothing.** It pushed `/messages?with=<id>` and left the destination page to do the get-or-create. The user left the profile on a promise, and any failure surfaced on a screen they never asked for. | `profile-screen.tsx` (Message action) |
| 2 | **A failed start was invisible.** The Messages page called `useResolveConversation(...)` but destructured only `conversationId` — `error` and `loading` were dropped on the floor, so a failed conversation creation rendered the inbox as if everything was fine. | `app/(app)/messages/page.tsx` |
| 3 | **Notification deep links went nowhere.** They point at `/messages?c=<conversationId>`; the page only understood `?with=` and `?view=`, so tapping a message notification landed on the inbox instead of the thread. | `components/notifications/notification-item.tsx` |
| 4 | **iOS zoomed the DM UI.** The composer textarea was 15px and the messages search 14px. iOS Safari magnifies the whole page when a focused field is under 16px — which is what "the chat zooms when I tap it" was. | `message-composer.tsx`, `conversation-list.tsx` |
| 5 | **The profile header had no layout regions.** Identity and actions shared one flex row in which the actions were `shrink-0` and could not wrap; on a laptop the row's min-content width exceeded the card, and the card is `overflow-hidden`, so the actions were clipped *over* the name and handle rather than pushing anything. | `profile-header.tsx` |

Two things were **not** broken, and are recorded so nobody "fixes" them again:

* **The backend start-conversation contract is already correct.** `getOrCreateConversation`
  is idempotent — a sorted `participantsKey`, a unique index, and a race catch that returns
  the winner — and `startConversation` refuses with precise, useful errors (400 self, 404
  unknown user, 403 blocked / "doesn't accept messages" / "only followers"). No backend
  change was needed for §71–§75, and the fix keeps the server's own wording.
* **Old Feed liked-eligibility was a *backend* gap** (fixed under Part 16 B): candidate
  selection read impression rows only, and likes never write one. `findSeenCandidates` now
  unions `Reaction(type: "like")` with `PostImpression` (seen, not dismissed), newest signal
  per post. This is what makes §87 true rather than aspirational.

---

## 2 · The fix, requirement by requirement

### §71–§75 — Profile → Message works, once, and says what it is doing

New `components/messages/message-button.tsx`:

* resolves **or creates** the conversation itself (`POST /api/messages/conversations`), seeds
  the inbox row so the thread header has the peer's name immediately, then routes straight to
  `/messages/<id>` — the user never stops at Messages;
* shows **"Opening…"** with a spinner and `aria-busy="true"` while the request is in flight;
* **collapses repeat taps while pending** (a `Set` ref, which also survives the re-render a
  second tap causes), so three impatient taps are one request;
* on refusal it renders the **server's own reason** inline (`role="alert"`) with a
  `Try again` button (`data-testid="message-button-retry"`) and **does not navigate** — no
  generic success UI, no silent failure.

`hooks/use-messages.ts` gained `useStartConversation` (one implementation, shared by the
profile button and the People search rows), `seedConversationRow`, and a
`useResolveConversation` that finally returns `{conversationId, error, loading, retry}`.

The Messages page now **renders** what it previously discarded: a spinner state while a
`?with=` link resolves, and an error card carrying the server's message, a retry
(`data-testid="conversation-retry"`) and "Back to messages" when it refuses. It also reads
`?c=<conversationId>` and goes straight into the thread (§99's notification entry point).

One logical DM per pair is therefore enforced by construction: every entry point calls the
same get-or-create endpoint, and the harness asserts the backend holds exactly one
conversation with the peer after repeated visits from two different surfaces.

### §76–§83 — Search inside Messages: people *and* chats

`conversation-list.tsx` now answers both questions in one field, with three sections' worth of
behaviour compressed into two labelled groups:

* **PEOPLE** — from the existing server-side `GET /api/search?type=people` through
  `usePeopleSearch` (300 ms debounce, minimum two characters, aborts stale requests, small
  server-side limit, lightweight projection). Each row is a `PersonRow` — avatar, display
  name, `@username` — and tapping it runs the **same** `useStartConversation` path as the
  profile button: existing chat opens, otherwise it is created then opened. No profile detour
  unless the user chooses one.
* **CHATS** — the existing server-side conversation search, unchanged in ranking, now
  labelled and empty-stated.

Empty states are real: "No people found for *query*" (`data-testid="no-people-found"`) and
"No chats match *query*. Pick someone above to start one." — never a blank panel. Nothing
loads the user table into the browser: every keystroke settles into one debounced request
(the harness asserts exactly one request for a three-character burst).

Mobile keeps the search bar where it already was — at the top of the Messages screen, above
the tabs, 36px tall, not behind a menu. Desktop reuses the identical component inside the
two-pane layout; the inbox column keeps its own search and the layout is asserted at 1366.

### §84–§86 — No zoom, no sideways scroll

Focused DM inputs are **≥16px on phones**: the composer, the messages search field, the member
picker, and the team create/info sheets all use `text-base`, reverting to their tighter
designed sizes from `sm` up (where no such browser behaviour exists). Nothing was solved by
disabling zoom: the harness reads the viewport meta and fails if `user-scalable=no` or
`maximum-scale=1` appears.

Overflow was measured, not eyeballed: at 320/360/375/390/412/430 — and at 1366 desktop —
`documentElement.scrollWidth === clientWidth`, every bubble fits the thread column, and every
image/shared post inside the thread is no wider than the element that contains it.

### §87–§89 — Old Feed keeps its rules (and now its likes)

Liked-but-never-read posts are eligible in Old Feed (backend union fix, above), while liked
posts remain excluded from the fresh stream — that exclusion lives in the fresh query and was
not relaxed. Old Feed stays cursor-paginated, de-duplicated against everything already on
screen (a shown-set filter before render), and its heading keeps the feed's own scale rather
than becoming a heavier banner. Covered by `backend/tests/part16-old-feed.js` (28/0) and
`check-part16-oldfeed-api.js` (23/0), and re-asserted end-to-end by `check-part16.js` §B.

### §90–§98 — The profile header, rebuilt as regions

The header is now a grid with three real tracks:

```
[ avatar ] [ identity ]                      (phones, tablet)
           [ actions  ]                      ← wraps below
[ avatar ] [ identity ] [ actions ]          (xl and up)
```

* The actions are a **direct child of the grid** with their own region; they may wrap
  internally but cannot reach the name, handle, joined line or avatar — asserted at 320, 360,
  375, 390, 412, 430, 768, 1024, 1366, 1440 and 1920 by rectangle intersection, plus "stays
  inside the viewport" and "no horizontal page scroll" at each width.
* `minmax(0, 1fr)` on the identity track is the load-bearing part: it lets the identity shrink
  instead of forcing the grid wider, which is what used to push the actions over the text.
* The avatar reserves real layout space (its own track) and is scaled for phones — 80px with
  a proportional 40px overlap below `sm`, 96px with the original overlap from `sm` up — rather
  than being pulled up with a negative margin and hoping.
* The 0-posts state is compact (`EmptyState compact`, opt-in): "No posts yet." plus one line,
  measured under 180px instead of the old full-height dashed panel. The same treatment is
  applied to the Saved/Liked/Archive tabs and the empty search/inbox states.
* Mobile keeps the shorter cover (112px vs 144px from `sm`), the scaled avatar, wrapping
  metadata and readable counters — the counters scan in `check-part16-profile.js` still pass.

### §99–§100 — Every entry point reaches the same system

Verified in the browser: **profile → Message**; **Messages search → person → chat**; an
**existing chat** from the inbox; **post → author profile → Message**; and the
**notification `?c=<id>` deep link**. All five resolve to the same conversation; the
post-share sheet already uses the same endpoint (Part 13) and was not disturbed. The
acceptance flow from §100 is the harness's own fixture: the search corpus contains a **Ruby
Singh**, searching "ruby" lists her under PEOPLE, and tapping her opens her conversation —
the same conversation on the second visit, with the backend holding exactly one.

---

## 3 · Evidence

All runs are against the QA backend on `:5999` and `next start` on `:3000`, seeded fresh for
this pass (`qa-mobile-server.js`, 16 posts, 3 events, 2 communities, a story, an uploaded
avatar).

| Harness | Result | What it covers |
|---|---|---|
| `docs/mobile-qa/check-part16-messaging.js` | **106 passed, 0 failed** | §71–§101: profile→thread, pending collapse, refusal surfacing, PEOPLE/CHATS search, debounce, no-match state, 16px inputs, no global zoom lock, overflow at 6 widths, `?c=` deep link, post→profile→Message, desktop, profile header at 11 widths, compact empty state |
| `docs/mobile-qa/check-part16.js` | **163 passed, 0 failed** | Part 16 A (chat viewport) + B (fresh→old boundary, no duplicates) |
| `docs/mobile-qa/check-part16-profile.js` | **50 passed, 0 failed** | profile contracts: counters, tabs, one-request saves, rejected edits |
| `docs/mobile-qa/check-part16-avatar.js` | **23 passed, 0 failed** | canonical avatar + banner crop, upload → profile → reload |
| `docs/mobile-qa/check-identity.js` | **25 renders / 0 leaks** | one canonical avatar per surface |
| `docs/mobile-qa/check-messages.js` | **130 passed, 0 failed** | the messages surface end-to-end |
| `docs/mobile-qa/check-part15.js` | **218 passed, 0 failed** | Part 15 mobile chat edge/header |
| `docs/mobile-qa/part9.js` | **98 passed, 0 failed** | Part 9 profile/feed/messages |
| `docs/mobile-qa/ui-fixes.js` | **167 checks, 0 failures** | layout grid at 11 widths |
| `docs/mobile-qa/part14.js` | **320 passed, 0 failed** | Part 14 feed/nav + §23–§25 exclusions |
| `backend/tests/part16-old-feed.js` | **28 passed, 0 failed** | liked-but-unread reachable; dismissal beats impressions; per-viewer |
| `backend/tests/part10-messages.js` | **59 passed, 0 failed** | messaging API |
| `backend/tests/part10-realtime.js` | **38 passed, 0 failed** | realtime messaging |
| `backend/tests/part14-feed-impressions.js` | **30 passed, 0 failed** | impressions + ranking |
| frontend units (`crop`, `image-variants`, `messages-store`, `query-mutation`) | **26 / 15 / 38 / 17, 0 failed** | — |
| `next build` + `parse-check` | clean (193 files) | — |

Screenshots: `/home/user/qa/part16/p16d-thread-390.png`, `p16d-search-390.png`,
`p16d-inbox-390.png`, `p16d-dm-320.png`, `p16d-dm-390.png`, `p16d-desktop-1366.png`,
`p16d-profile-{320,390,768,1366,1920}.png`, `p16d-empty-profile-390.png`, plus the two
diagnostic shots `p16d-dbg-burst.png` / `p16d-dbg-person-tap.png`.

Diagnostics worth keeping: `docs/mobile-qa/dbg-part16-messaging.js` prints the timed
request/console log for the burst and person-tap paths — it is what proved the two initial
harness failures were *assertion* bugs rather than product bugs (a read-receipt POST matching
a `includes()` filter, and a brand-new conversation correctly rendering its empty state
instead of the scroller).

---

## 4 · §101 — the sixteen questions, answered

1. **Why could a conversation fail to start?** Not the backend: the button never asked it to.
   The profile action navigated to `/messages?with=<id>` and relied on the destination to
   create the conversation — and the destination discarded the error when it couldn't.
2. **What was the actual cause of "Failed to start conversation"?** Two layers: (a) the start
   was attempted *after* navigation, so the user saw a screen with no context; (b) the
   Messages page destructured only `conversationId` from `useResolveConversation`, so both
   the failure and the loading state were dropped. `startConversation` itself returns 400
   (self), 404 (unknown user), 403 (blocked / policy) or 500 with distinct messages.
3. **How does Profile → Message work now?** `MessageButton` calls
   `POST /api/messages/conversations`, seeds the inbox row, and routes to `/messages/<id>` on
   success. "Opening…" while pending; the button is disabled; repeat taps collapse.
4. **Can it create duplicates?** No. `getOrCreateConversation` is a sorted-pair
   `participantsKey` with a unique index and a race catch; the harness asserts one
   conversation after repeated visits and three rapid taps.
5. **Is the failure still hidden?** No. On refusal the button shows the server's own message
   with a retry and does not navigate; `?with=` links that fail render an error card with a
   retry and a way back.
6. **How does search offer people as well as chats?** One field, two labelled sections:
   PEOPLE from `GET /api/search?type=people` (debounced, aborted when stale, lightweight
   projection) and CHATS from the existing server-side message search.
7. **Does tapping a person open a chat?** Yes — existing conversation opens, otherwise it is
   created and opened. No profile detour; the profile remains a deliberate choice elsewhere.
8. **Does search hammer the server?** No: 300 ms debounce, minimum two characters, stale
   requests aborted, small server-side limit. Three keystrokes inside the debounce window
   produce exactly one request (asserted).
9. **What if nobody matches?** "No people found for *query*", and "No chats match *query*.
   Pick someone above to start one." — both asserted; never a blank or broken panel.
10. **Where is search on a phone?** At the top of the Messages screen, above the tabs — the
    same place it already was — sized compactly (36px) and never hidden behind a menu.
11. **What keeps the DM surface from zooming?** 16px (`text-base`) focus sizes on phones for
    the composer, search field and every messaging sheet input, reverting to the tighter
    designed sizes from `sm` up. Global zoom was left alone — asserted by reading the
    viewport meta.
12. **Can the chat scroll sideways?** Not at 320/360/375/390/412/430 or 1366: document width
    equals viewport width, bubbles fit the thread column, and images/shared posts are no
    wider than their bubble.
13. **Are liked posts in the Old Feed — and still out of the fresh one?** Yes to both. The
    candidate query unions likes with impressions (newest signal per post, dismissals
    excluded); the fresh stream's exclusions were not touched, and Part 14's §23–§25 checks
    still pass.
14. **Any repetition or pagination trouble?** Old Feed is cursor-paginated and filtered
    against everything already on screen; the Part 16 harness asserts no post renders twice
    and that the history arrives from the separate `mode=old` query.
15. **What was wrong with the desktop profile header?** No layout regions: actions were a
    `shrink-0` flex child that could not wrap, so on narrow desktops they were clipped over
    the identity text. It is now a grid — avatar | identity | actions — with the actions in
    their own track, wrapping internally, and the avatar reserving real space. Verified by
    rectangle-intersection at 11 widths from 320 to 1920.
16. **Does the mobile profile hold up?** Yes: shorter cover, 80px avatar with a proportional
    overlap, wrapping metadata, compact actions, a compact "No posts yet." state, readable
    counters, and no horizontal page scroll at any of the six phone widths.

**Acceptance (§100):** search "Ruby" → Ruby Singh appears under PEOPLE → tapping her opens
her conversation; Profile → Message from any profile opens the identical conversation; no
broken route, no dead button, no duplicate conversation, no unnecessary redirect. All of it
is the harness's own walk, run against the live build.

---

## 5 · Remaining issues

* **Native focus-zoom itself is not observable in headless Chromium.** The rule that governs
  it (a computed font size of at least 16px on the focused field, with no global zoom lock) is
  asserted directly; the magnification is a real-device behaviour and is called out as such.
* **The PEOPLE section shows a small page and does not paginate further.** That is the brief's
  own shape for people (§79: small limit, server-side); pagination is exercised on the chats
  side and on Old Feed, where it exists.
* **CHATS search ranking is unchanged.** It searches what the server already searched
  (conversations, including message content) — no new relevance model was invented.
* **Teams appear in CHATS, not PEOPLE.** Correct, and deliberate: a team is a conversation,
  not a person you can open a DM with.
* **Deskop ≥1280 keeps actions beside the identity** rather than stacked — stacked is the
  narrower-desktop/tablet behaviour the brief asks for, and the harness confirms no overlap at
  either.

## 6 · Files changed

New: `frontend/src/components/messages/message-button.tsx`,
`docs/mobile-qa/check-part16-messaging.js`, `docs/mobile-qa/dbg-part16-messaging.js`.

Changed: `frontend/src/hooks/use-messages.ts`,
`frontend/src/app/(app)/messages/page.tsx`,
`frontend/src/components/messages/conversation-list.tsx`,
`frontend/src/components/messages/message-composer.tsx`,
`frontend/src/components/messages/member-picker.tsx`,
`frontend/src/components/messages/team-create-sheet.tsx`,
`frontend/src/components/messages/team-info-sheet.tsx`,
`frontend/src/components/profile/profile-screen.tsx`,
`frontend/src/components/profile/profile-header.tsx`,
`frontend/src/components/feed/post-list.tsx`, `frontend/src/components/states.tsx`,
`docs/mobile-qa/check-part16.js` (history precondition for the boundary).

Backend: **none** for §71–§101. The one backend behaviour that mattered (§87 liked-eligibility)
was already fixed and committed with Part 16 B.
