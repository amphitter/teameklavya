# PART 13 — Quick social interaction fixes

Five features, one rule from the brief: **small targeted changes, no large
refactor, no unrelated UI rewrite, no database architecture rewrite.** Everything
below reuses what already existed; the only schema addition is one nullable field.

Evidence for every claim is in the last section. Nothing here is "implemented, not
verified".

---

## 1 · The "+" popover — stable, anchored, mobile-safe

**What was wrong.** The menu is a Radix `DropdownMenu` and its placement was left
at the defaults: `side="bottom"`, `align="end"`. In the bottom navigation that
means "open below a button that sits on the bottom edge of the screen", so Radix
first renders it below, finds no room, and flips it above — *after* the first
paint. That flip is the reported "it moves / disappears". `align="end"` also
pinned a button that is centred in a five-column grid to the right, so on a
320px screen the menu ran off the side.

**What it is now.** Placement is explicit per host and nothing is hand-positioned:

* bottom nav → `side="top"`, `align="center"` (its own centre, not an offset)
* desktop header → `side="bottom"`, `align="end"`
* both → `sideOffset={10}`, `collisionPadding={8}`, so it can never touch the
  viewport edge

One tap opens, the same tap closes, a tap outside closes, Escape closes — all of
that is Radix's own behaviour and is deliberately not re-implemented.

## 2 · Create Post from anywhere — one global composer

**What was wrong.** "+ → Create Post" called `router.push("/?compose=1")`. It
navigated you to the feed and threw away your context: from an open conversation
you lost the conversation, from a profile you lost the profile. §4 names this
exactly.

**What it is now.**

* `ComposerProvider` (`components/post/composer-provider.tsx`) hosts **one**
  composer instance inside the shell, so every shell route can open it.
* `CreatePost` gained `variant="inline" | "modal"`. The **same** component renders
  both — same upload, same visibility rules, same error handling, same publish —
  so a post from Messages is not a second implementation.
* The modal is a full-height sheet on a phone (`h-[100dvh] max-h-none`) and a
  compact centred card from `sm` up.
* **No navigation happens.** Opening and closing leaves the route, the scroll
  position and any open conversation untouched. Publishing closes the composer,
  invalidates the feed/profile caches, and shows the same "Posted!" feedback.
* Inside an **open chat** the bottom nav is hidden on purpose (Part 12 §30 — the
  composer needs the bottom edge of the screen). That left it as the one surface
  with no way in, so the conversation's own options menu (the ⓘ menu that already
  holds Mute/Archive/View profile) gained **"Create a post"**. It opens the same
  overlay; it does not navigate.

## 3 · Tagging

* A **Tag people** button in the composer opens a picker that searches real
  users through the existing `GET /api/search?type=people`.
* Debounced at 300ms (one request per pause in typing, not per keystroke), with
  distinct loading / empty ("No people found") / error states, and rows showing
  avatar + display name + @username.
* Selecting a person writes `@username` into the post at the caret and shows a
  removable chip in the composer; untagging removes the handle again, so a
  removed person is not notified.
* **Structured mentions**: `Post.mentions` already existed and is populated by the
  server's own `parseMentions()` (real users, author excluded, capped), so the
  stored mention is a user id and `RichContent` already links `@username` to the
  profile. The picker feeds the existing parser rather than inventing a parallel
  format.
* The mention notification is created by `createPost` **after** the post is saved
  — never for a failed or rejected post.

## 4 · Post sharing

**What was wrong.** The share button copied a link. That is not sharing: it
assumes the person you are sending it to is reachable outside the app.

**What it is now.**

* A real share sheet — bottom sheet on a phone, compact modal on desktop, safe-area
  aware — with search over eligible users, multi-select chips, and a quick-share
  row built from **existing** relationships in a deliberately shallow order:
  recent conversations (the endpoint's own recency order) → followers →
  people you follow. No scoring model, as the brief asks.
* **Followers** get a separate bulk action with an explicit confirmation that
  states how many people it will reach; it is capped at 25 per share and reports
  exactly what happened ("Shared with 4 of 25 — some couldn't be reached").
* A share **reuses the existing messaging stack completely**: the sheet resolves
  each person to a conversation with `POST /api/messages/conversations`
  (get-or-create — the same call the Message button makes) and sends
  `sharedPostId` to `POST /api/messages/conversations/:id`. Realtime delivery,
  read receipts, unread badges, archive behaviour and blocking rules all apply
  unchanged, and `clientMessageId` dedupes a retry or a double tap.
* **A reference, never a copy.** `Message.sharedPost` stores the post id. The
  bubble renders the canonical post by id, so an edit shows the new text, a
  deleted post shows **"Post unavailable"**, and a post the reader may not see
  simply is not returned by the API.
* **Visibility is enforced on both ends** — see "bugs found" below. This was the
  one place where a small feature could have become a security hole.
* Copy-link is still there, inside the sheet, as a secondary action.

## 5 · Discover → People, and the mobile people-search bug

**The bug, and its root cause (§28).** The brief said not to assume it is CSS.
It was not.

* The feed's own discovery card links to **`/search?tab=people`**.
* The search page read `q` from the URL but kept the **tab in component state**,
  initialised to `"events"`. So `?tab=people` was silently ignored: tapping
  "People you may know" landed on the Events tab, and with no query that renders
  "Type at least 2 characters" — nothing at all to do with people.
* Worse, the input's debounce wrote a bare `/search?q=…`, which **dropped every
  other parameter**: typing one character on the People tab threw the tab away
  and dropped you back on Events.
* On a phone that card is the main route into people search (the tab strip has to
  be scrolled horizontally to reach the third pill), which is why it presented as
  "people search is broken on mobile".

**Fixed at the root.** The tab is read from the URL and written back to it — the
URL is the single source of truth — and the debounce rebuilds the URL from the
current parameters instead of replacing it. People is now the second pill
(`[Events][People][Communities][Posts]`).

**The People surface.** Compact, avatar-first rows; the whole row is the link and
the follow control (with precise Follow/Following/Requested state) sits outside
it so a tap on Follow does not navigate; `People you may know` renders real
suggestions from the existing `/users/suggested` before you type; mutual
connections are shown; searching is debounced and server-side; the empty state is
a sentence ("No people found"), never a blank panel or a 500.

## 6 · Branding

* **EventHub-originated notifications now show the EventHub mark.** An actor-less
  notification (achievement, reminder, announcement) used to render the initials
  fallback for a null user — an empty grey circle. It renders the product mark
  now, so "this came from EventHub" is legible at a glance. Notifications caused
  by a person keep that person's avatar.
* **The phone mark is now the mark everywhere.** `<Logo>` (one component, used by
  the desktop sidebar, the auth/login pages and the admin header) points at
  `/brand/eventhub-logo-plain.png` — the same lockup as the mobile bar. The
  tagline version is a grey smudge at the 24–44px those call sites render.
* The app has no browser/Web Push integration (`new Notification(` and
  `showNotification` have no callers anywhere in `src` or `public`), so in-app
  notification rows are the only place this could apply — and they are covered.

## 7 · Bugs found while building this (all fixed)

1. **`invalidateQueries` invalidated nothing anyone could see.** It cleared the
   cached entry and told no one, so a *mounted* list never refetched — publishing
   a post from another surface could leave the feed showing stale data or an
   empty list. The cache now has a second, dedicated invalidation channel that
   only `invalidate()` fires (data writes deliberately do not, or the refetch
   would re-trigger itself into an infinite loop), and both `useQuery` and
   `useInfiniteQuery` refetch on it. §8 is only possible because of this.
2. **A share could be sent by someone who could not read the post.** The first
   version checked only the *recipients*. Anyone who knew or guessed a post id
   could put it into a conversation — and in a group it would reach everyone who
   *can* read it, with the sharer as the apparent source. The sender is now
   checked with the same predicate (`canViewPost`), and the backend test asserts
   both directions.
3. **The search debounce dropped the tab** (above) — the same bug class as the
   deep link, one effect further down.
4. **A deleted post still rendered in the thread for its author.** `GET
   /posts/:id` deliberately lets an author read their own deleted post (that is
   what makes the archive list work), so the card now also checks `post.status`
   and shows "Post unavailable" for deleted/hidden/draft posts — for everyone,
   including the sender.

No visibility rule, and no Part 12 message fix, was weakened by any of this.

## 8 · What changed — APIs and components

**Backend (minimum necessary support, as the brief allows)**

| File | Change |
|---|---|
| `models/message.model.js` | `sharedPost` (nullable ObjectId → Post). One field; no document changes |
| `controllers/message.controller.js` | `sendMessage` accepts `sharedPostId`: validates it, checks **sender and every recipient** with `canViewPost`, stores the reference, fills a "Shared a post" preview line when there is no note. `MESSAGE_FIELDS` includes `sharedPost` |
| `services/post-visibility.service.js` | **New.** `canViewPost` / `authorIdOf` moved out of `post.controller.js` unchanged so messaging applies the same rules instead of duplicating them |
| `controllers/post.controller.js` | requires the extracted predicate (behaviour identical) |
| `controllers/search.controller.js` | `GET /api/search?type=people` now returns `mutuals` for a signed-in viewer — one aggregation for the whole page, absent (not faked) for anonymous callers |

**Frontend — new**

`components/post/composer-provider.tsx` · `components/post/tag-people-picker.tsx` ·
`components/post/post-share-sheet.tsx` · `components/post/shared-post-card.tsx` ·
`components/people/use-people-search.ts` · `components/people/person-row.tsx`

**Frontend — changed**

`components/feed/create-post.tsx` (variants, tag chips, modal chrome) ·
`components/shell/app-shell.tsx` (menu placement, provider host) ·
`components/feed/feed-post.tsx` (Share opens the sheet) ·
`components/feed/feed-top-bar.tsx` (`data-feed-top-bar` hook) ·
`components/messages/thread-panel.tsx` ("Create a post") ·
`components/messages/message-bubble.tsx` (renders a shared post) ·
`components/notifications/notification-item.tsx` (system rows carry the mark) ·
`components/logo.tsx` (phone mark) · `hooks/use-social.ts` (`sharedPost` on
`ChatMessage`) · `lib/query.ts` (refetch on invalidation) ·
`app/(app)/search/page.tsx` (URL-driven tab, People surface, param-preserving
debounce)

No feed, messages, auth, realtime or database architecture was rewritten.

## 9 · Tests performed

**Browser (Playwright, real servers, real data)** — `docs/mobile-qa/part13.js`,
run at 320/390 and 1440:

| Check | Result |
|---|---|
| PART 13 (all five features + branding, 98 assertions) | **98/98** |
| feed top bar (regression) | 101/0 |
| ui-fixes (regression) | 221/0 |
| phase 4 live / widths (regression) | 50/0 · 132/0 |
| phase 3 live (regression) | 57/0 |

What the Part 13 run actually proves, including: the menu's bottom edge is above
the button and its centre is on the button's centre and it does not move once
open; the composer opens from the feed, from the inbox, from an open chat and from
Discover without changing the URL; four keystrokes cost one search request; a
tagged handle reaches the post and `Post.mentions` is non-empty; the recipient
receives the share with the post id and the post's text is not duplicated; the
deleted share reads "Post unavailable" *in the recipient's client*; a link to
`/search?tab=people` selects the People tab; tapping the feed's people card lands
on People; the EventHub mark appears on system notifications.

**Backend** — `node tests/part13-social.js`: **40 passed, 0 failed.** Covers
mentions (real users only, author excluded, exactly one notification each, none
for a rejected post), the share reference (id stored, text not copied, recipient
sees it, retry does not duplicate), visibility in both directions (followers-only
refused to a non-follower, nothing written; the same share allowed once they
follow; sender without access refused; deleted post unshareable and 404 for the
reader) and people search (mutuals only for signed-in viewers, 1-char floor,
empty result is an empty array, no credential fields leak).

**Unit** — `node tests/run-query-tests.js` **17/0** (including: a data write does
not schedule a refetch, an invalidation reaches the subscriber exactly once, and
the refetch that lands does not re-trigger it) · `run-messages-store-tests.js`
38/0 · `tsc --noEmit` clean · `next build` clean.

**Regression** — part10-messages 59/0 · part10-realtime 38/0 · phase4 selftest
37/0 · phase11 selftest 73/0.

**Honest limits.** Quick-share covers recent conversations → followers →
following; event/community connections are not a separate ranker (the brief said
not to build one). The follower fan-out is capped at 25 per share and says so.
Real-phone keyboard behaviour and `env(safe-area-inset-*)` on hardware remain
unverified — they need a device, not a sandbox. Screenshots of the menu, the
composer, the tag picker, the share sheet and the People tab: `qa/profile-audit/p13-*.png`.
