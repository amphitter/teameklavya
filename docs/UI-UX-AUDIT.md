# EventHub Part 8 — UI/UX Audit

**Date:** 2026-10-07
**Scope:** Complete frontend UX/UI rework + the minimum backend changes required to make the UI honest.
**Method:** Full read of `frontend/src` (55 routes, 84 components), all 8 supplied HTML references, `DESIGN.md`, and the Mongoose models + controllers backing every surfaced field.

Every entry below follows:

```
Current:        what exists today, with file:line
Problem:        why it fails the Part 8 bar
Expected:       the target behaviour
Reference:      which supplied artefact defines the target
Implementation: what will be built
```

---

## 0. Executive summary — the four blockers

The audit surfaced **four defects that are not cosmetic**. No amount of styling fixes them, and two of them are the specific complaints in the brief. They are listed first because they gate everything else.

### B1. `user._id` is always `undefined` — this is the message-direction bug

```
Current:        backend/controllers/auth.controller.js:187
                  res.json({ token, user: { id: user._id, firstName, lastName, email } })
                frontend/src/components/auth/login-form.tsx:53
                  localStorage.setItem("user", JSON.stringify(user))
                frontend/src/components/shell/use-session-user.ts:20
                  interface SessionUser { _id?: string; ... }
                frontend/src/app/(app)/messages/page.tsx:441
                  const mine = user && m.sender?._id === user._id;
```

`login` returns the id under the key **`id`**. The frontend reads **`_id`**. The value is therefore `undefined` for the entire session.

`/auth/me` *does* return `_id` (line 339), but nothing writes that back to `localStorage`, so the stored object keeps the broken shape.

`mine` evaluates falsy for **every** message, so `justify-end` never applies and the sent/received branch collapses. The bubble colours are already distinct in source — they just never render.

**36 call sites** across the frontend read `user._id`.

- **Problem:** §28 "messages appear visually identical" — this is the mechanism. It also silently breaks post authorship, follow state, comment ownership and `?with=` self-conversation guards.
- **Expected:** one canonical session-user shape. `mine` must be correct.
- **Reference:** `messages-team-chat-mobile.html`, `messages-team-collab-hub.html`
- **Implementation:** normalise `id` → `_id` **at the session boundary** in `useSessionUser`, so all 36 sites are fixed by one change and the fragile per-site pattern cannot recur. **Then** fix the bubble treatment properly (§28–31).

### B2. `updateProfile` silently discards everything except three fields

```
Current:        backend/controllers/auth.controller.js:354
                  const { institution, course, year } = req.body;
```

The User model **already has** every field the UI needs — `username`, `profile.avatar`, `profile.coverImage`, `profile.bio`, `profile.location`, `profile.interests`, `socialSettings` (`models/user.model.js:8-23`, `61-68`). None of them are writable.

Meanwhile `frontend/src/components/profile/profile-view.tsx:52-63` builds a `socialForm` containing `username, bio, location, interests, avatar, coverImage, profileVisibility, allowMessagesFrom, showAttendance, showAchievements` and PUTs it to `/auth/me/profile`. Every one of those values is dropped on the floor with a `200 OK`.

- **Problem:** §20 banner never loads · §21 avatar update dead · §22 cover update dead · §23 username update dead · §24 display name / bio dead. Mongoose `strict` mode means this fails **silently** — the UI reports success.
- **Expected:** all profile identity fields persist and propagate.
- **Reference:** `user-profile-edit-desktop.html`, `user-profile-edit-mobile.html`
- **Implementation:** rewrite `updateProfile` as an **explicit allowlist** — never `req.body` spread. This is the security-critical one: blind-spreading a request body onto a User document is how `role` and `points` get escalated. Add `GET /api/auth/username-availability`.

### B3. There is no stories backend

```
Current:        frontend/src/components/feed/story-rail.tsx:52
                  {cat.slice(0, 2).toUpperCase()}
                grep for a Story model / controller / route → none
```

The rail is a **category shortcut list** wearing story clothing. It renders the first two letters of each event category inside a story ring — literally the "random letters / EN placeholder" the brief prohibits (§15). There is no `Story` model, no controller, no route.

- **Problem:** §15–19, §36, §39, §57 cannot be satisfied at all. There is no data to bind.
- **Expected:** real stories — create, 9:16 portrait, 24h active → archive, category icons.
- **Reference:** `home-explore-feed.html`, `mobile-home-explore-feed.html`
- **Implementation:** build the smallest correct stories backend: `Story` model (`expiresAt`, `archivedAt`, `media`, `caption`, `category`, `event`), plus create / feed / view / archive / delete routes. **24h expiry is enforced at query time, not by a cron** — see §18 decision below.

### B4. Comments cannot reply, and cannot be liked

```
Current:        backend/models/comment.model.js — fields are
                  post, author, content, removedAt, removedBy
                no parent, no likes
```

- **Problem:** §13 requires one-level replies and comment likes. Neither is representable.
- **Reference:** `mobile-home-explore-feed.html`, `home-explore-feed.html`
- **Implementation:** add `parent` (nullable, **one level enforced server-side**) and a `likes` array to the Comment schema; add `POST /:commentId/like`, `GET /:commentId/replies`.

---

## 1. Home Feed

**Current:** `feed-view.tsx` (421 lines) — a single column of uniform `Card` surfaces. One `PostCard` shape repeated. No visual rhythm: post, post, post, post. Story rail collapses to `null` when no categories exist, leaving a bare top edge. Right rail and upcoming panel are separate stacked cards.

**Problem:** §4 — reads as "random dashboard cards", not a social feed. §5 — there is no rhythm, nothing invites continued scrolling. Every element is the same weight, so nothing is emphasised.

**Expected:** a deliberate interleaved rhythm — stories → live event → post → recommended event → post → community → post → upcoming. Desktop three-column (identity/nav · feed · discovery). Mobile single column with a floating create action.

**Reference:** `home-explore-feed.html`, `mobile-home-explore-feed.html`

**Implementation:** a ranked, interleaved feed composer. Feed items become a discriminated union (`post | event | community | live | people`) so the renderer can vary density instead of stamping one card repeatedly. Desktop shell gains a persistent left rail; the right rail becomes genuinely contextual (live now, suggested people, upcoming) rather than three stacked panels.

## 2. Stories

**Current:** see **B3** — category initials in a gradient ring. No upload, no viewer, no archive, no expiry.

**Problem:** §15 explicitly forbids letter placeholders when a visual icon exists. §16–19, §36, §39, §57 all unmet.

**Expected:** circular avatars with a gradient ring for unseen stories; category *icons* (Material Symbols) for category stories; 9:16 portrait upload with crop/position; full-screen viewer with progress bars; automatic move to archive after 24h; `/stories/archive` grid grouped by month.

**Reference:** `home-explore-feed.html`, `mobile-home-explore-feed.html`

**Implementation:** `StoryRail` → `StoryAvatar` → `StoryViewer` → `StoryComposer`. Central `storyCategoryIcons` map (§39) — never inline icon names in pages.

> **Decision — 24h expiry (§18).** Expiry is enforced **at query time**, not by a scheduled job: active stories are `expiresAt > now AND archivedAt == null`. A story is therefore never visible a moment past its window even if no sweeper ever runs, and no cron can silently fail and strand a live story. `archivedAt` is set lazily on first read after expiry. This keeps the guarantee total and removes a background worker.

## 3. Post

**Current:** `feed-post.tsx` (342 lines). Header, text, media grid, actions. Notably `feed-post.tsx:250` renders a `Trophy` with `Finished · 0 pts` whenever `post.memory` is truthy — **even when `rank` is null and `score` is 0**.

**Problem:** §9 — "Finished 0 points" with no real result is exactly the prohibited random-trophy UI. §10 — post types are not visually distinguished.

**Expected:** one common post shell with contextual content blocks. Achievement metadata appears **only** when the post genuinely is an achievement/memory post **and** carries real result data.

**Reference:** `home-explore-feed.html`, `mobile-home-explore-feed.html`

**Implementation:** extract `PostCard` shell + typed content blocks (text / media / event / announcement / achievement / memory / poll / code). Gate the trophy block on `rank || score > 0 || achievements.length` so an empty result renders nothing.

## 4. Likes

**Current:** single-tap like only (`feed-post.tsx`). No double-tap. Like is optimistic in some paths but not all.

**Problem:** §8 — double-tap like missing entirely, on both touch and desktop.

**Expected:** double-tap on media → heart animation at tap position → liked. **If already liked, stay liked** (accidental double-tap must never unlike). Roll back on API failure.

**Reference:** `mobile-home-explore-feed.html`

**Implementation:** `LikeAnimation` overlay + `useDoubleTap` hook. Touch and desktop double-click. Animation must not block scroll (`pointer-events: none`).

## 5. Comments

**Current:** `comments.tsx` (167 lines) — inline list under the post, plain `<form>`, no emoji picker, no replies, no likes, no pagination, no bottom sheet. Opens inside a `Dialog`.

**Problem:** §12 — "Do NOT navigate to an ugly separate page for normal comments"; the current dialog is not a sheet and has no sticky composer behaviour under a mobile keyboard. §13 replies/likes/emoji/pagination all absent. §14 no emoji picker.

**Expected:** mobile bottom sheet with drag-to-dismiss, sticky composer that survives the soft keyboard, emoji picker above the keyboard, one-level replies behind "View replies (N)", optimistic send.

**Reference:** `mobile-home-explore-feed.html`, `home-explore-feed.html`

**Implementation:** `CommentSheet` (mobile) / inline or right-panel (desktop, width-dependent) → `CommentList` → `CommentComposer` → `EmojiPicker`. Keyboard handled with `visualViewport` so the composer tracks the keyboard rather than being pushed off-screen.

## 6. Profile

**Current:** `profile-header.tsx` (179 lines) and `profile-view.tsx` (511 lines) — **two different profile components exist**, plus a third `src/components/profile-view.tsx`. The header already renders `p.coverImage` correctly, but nothing can ever set it (see **B2**).

**Problem:** §20 banner never loads from user data because it is always `''`. §21/§22/§23/§24 all dead. §26 tabs are static. Three competing profile components guarantee drift.

**Expected:** one `ProfileHeader` — real cover, overlapping avatar, name, `@username`, verified badge, bio, links, stats. Tabs shown **only** when the underlying collection is non-empty (§26).

**Reference:** `user-profile-edit-desktop.html`, `user-profile-edit-mobile.html`

**Implementation:** consolidate to one `ProfileView`. `ProfileCover` + `AvatarUploader` + `CoverUploader` + `EditProfileSheet` with upload progress and success/failure states (§21). Username availability checked server-side while typing (§23).

## 7. Messages

**Current:** `src/app/(app)/messages/page.tsx` (562 lines). Sent/received branch **exists in source** (`justify-end` / `justify-start`, primary vs muted bubble) but never fires — see **B1**. No grouping (§29), no reactions (§31), no archive (§32), no event context (§35).

**Problem:** §28 "This is a major bug." Confirmed — every message renders left-aligned because `user._id` is `undefined`. §31/§32/§35 unmet.

**Expected:** sent → right, received → left, distinct bubble styling and contrast (§28). Consecutive messages group under one avatar (§29). Emoji reactions (§31). `/messages/archived` with restore (§32).

**Reference:** `messages-team-chat-mobile.html`, `messages-team-collab-hub.html`

**Implementation:** fix the session shape (**B1**), then `MessageList` with grouping + day separators, `MessageBubble` with genuinely distinct sent/received treatment, `MessageComposer` (Enter send / Shift+Enter newline), reactions, and `ArchivedChats`.

> **Decision — archive on new message (§33).** A new incoming message **does not** auto-unarchive. The conversation stays archived but surfaces an unread badge on the archive entry. Rationale: auto-unarchive silently reverses a deliberate user action, and the user then cannot tell whether they archived it. The badge state is visible and reversible, so nothing is lost — and this satisfies "use one consistent rule".

## 8. Navigation

**Current:** `app-shell.tsx` (481 lines) — a single shell. Mobile bottom nav exists; desktop nav is present but the `(app)` group has no persistent three-column frame.

**Problem:** §40 — no coherent desktop shell; the feed has no left/right rails.

**Expected:** mobile — Home / Explore / Create / Community / Profile, with messages + notifications in the top header. Desktop — one consistent shell: Feed / Explore / Hackathons / Communities / Messages / Notifications / Profile.

**Reference:** `home-explore-feed.html`, `mobile-home-explore-feed.html`

**Implementation:** `EventHubShell` composing `DesktopNavigation` + `MobileNavigation`. One shell for the whole `(app)` group — no per-page navigation variants.

## 9. Create flow

**Current:** composer is inline in the feed; no unified create entry.

**Problem:** §41 — no action sheet; creation entry points are scattered.

**Expected:** one `CreateActionSheet` offering Post / Story / Event / Community / Poll / Hackathon, filtered by authorisation.

**Implementation:** `CreateActionSheet` + floating action button on mobile.

## 10. Loading / empty / error states

**Current:** `states.tsx` provides `EmptyState`, `ErrorState`, `Skeleton`. `post-skeleton.tsx` exists. Coverage is uneven — messages and comments have thin or no skeletons.

**Problem:** §43 blank areas while loading; §44 incomplete error coverage; §67 empty states not intentional.

**Expected:** skeletons matching final layout for feed, profile, comments, messages, events, stories. Every async surface has loading / success / empty / error / retry.

**Implementation:** extend `states.tsx`; add `FeedSkeleton`, `ProfileSkeleton`, `CommentSkeleton`, `MessageSkeleton`, `StorySkeleton`.

## 11. Data integrity

**Current:** the story rail fabricates nothing (it renders real categories), and `feed-post.tsx:250` renders `0 pts` from a real-but-empty record. No seeded fake metrics found in the feed.

**Problem:** §37/§52 — "Finished 0 pts" reads as a fabricated metric even though the field is real. §51 — no hardcoded identity found in the feed; profile components must be re-verified after consolidation.

**Expected:** no rendered value that is not meaningfully backed by data.

**Implementation:** gate empty-result renders (§3); keep fixtures isolated and labelled.

---

## Design system

`src/app/globals.css` already defines a token layer using shadcn names (`--color-background`, `--color-card`, `--color-muted`…). The supplied references and `DESIGN.md` use a **Material 3 "Vibrant Pulse"** vocabulary (`surface`, `on-surface`, `surface-container-low`, `on-surface-variant`, `primary`, `secondary`, `tertiary`, `outline`).

Rather than replace the existing layer — which would churn every component — the two vocabularies will be **aliased onto one source of truth**: the `DESIGN.md` palette becomes the canonical values, and the shadcn names become aliases pointing at them. Components may use either; both resolve to the same colour.

| Token | DESIGN.md | Role |
|---|---|---|
| `primary` | `#2563FF` → alias of `--color-primary` | trust, primary action |
| `secondary` / purple | `#6C35FF` | transition anchor |
| `tertiary` / magenta | `#D946EF` | energy highlight |
| `surface` | `#F8FAFF` | canvas |
| `surface-container-low` | `#F4F2FF` | quiet fills |
| `on-surface` | `#12193C` | dominant text |
| `on-surface-variant` | `#64709A` | secondary text |
| `outline` | `#E4E9F4` | borders |

**Brand gradient** `135deg #2563FF → #6C35FF → #D946EF`, per §3 reserved for: primary CTA, create button, selected states, milestone moments. Explicitly **not** applied broadly — the current story ring already uses it per-avatar, which will be narrowed to the unseen-story indicator and CTAs only.

Typography stays **Inter** with the DESIGN.md scale (`display-hero` 48/800/-0.03em → `label-sm` 11/600/+0.03em).

---

## Implementation plan

| Phase | Content | Depends on |
|---|---|---|
| 1 | Design tokens aliased onto DESIGN.md palette; `docs/` audit | — |
| 2 | **Backend blockers** — B1 session shape, B2 `updateProfile` allowlist + username availability, B3 stories model/routes, B4 comment replies + likes, message `archivedBy` + reactions | — |
| 3 | Primitives — `Button`, `Card`, `Sheet`, `Skeleton`, `OptimizedImage` pass; shell + navigation | 1 |
| 4 | Feed — ranked interleave, filters, infinite scroll, skeletons | 2, 3 |
| 5 | Post + `LikeAnimation` + double-tap + media layouts + viewer | 3 |
| 6 | Comments — sheet, emoji picker, replies, optimistic | 2, 5 |
| 7 | Stories — rail, composer, viewer, archive | 2, 3 |
| 8 | Profile — header, edit sheet, avatar/banner/username upload | 2, 3 |
| 9 | Messages — direction, grouping, reactions, archive | 2, 3 |
| 10 | Cleanup — remove bad UI, empty/error states, responsive + a11y pass, QA | 4–9 |

Backend phase 2 is front-loaded because four of the acceptance criteria are unreachable without it (§50: "If an endpoint does not exist: DO NOT invent fake data. Implement the smallest required backend/API change").
