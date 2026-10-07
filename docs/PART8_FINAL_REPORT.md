# EVENTHUB PART 8 COMPLETE

Social-first UI/UX overhaul. Frontend rework plus the minimum backend changes
required to make the UI honest.

Full audit: [`docs/UI-UX-AUDIT.md`](./UI-UX-AUDIT.md)

---

## UI/UX Audit

`docs/UI-UX-AUDIT.md` documents **Current / Problem / Expected / Reference /
Implementation** for 11 surfaced areas: Home Feed, Stories, Post, Likes,
Comments, Profile, Messages, Navigation, Create flow, Loading/empty/error
states, and data integrity.

The audit's main finding is that **four of the reported problems were not
cosmetic**. No amount of styling fixes them:

| # | Defect | Effect |
|---|---|---|
| B1 | `/auth/login` returns `id`, everything else returns `_id` | `mine` was false for every message → the sent/received branch could never render |
| B2 | `updateProfile` accepted only 3 of 11 fields | avatar, cover, username, display name, bio, location, interests all silently discarded |
| B3 | No stories backend existed | the rail rendered category initials — the placeholder §15 forbids |
| B4 | Comments had no `parent` and no likes | replies and comment likes were unrepresentable |

Each is recorded with file:line and a stated decision where the brief left a
choice open.

---

## Pages Redesigned

| Page | Change |
|---|---|
| `/messages` | Rebuilt. Sent/received, grouping, reactions, archive, reply quotes |
| `/stories/archive` | **New.** Month-grouped story archive |
| `/profile/[id]` | Edit profile now reaches the backend; empty-state copy |
| `/` | Real story rail, 4 filter tabs, double-tap like, comment sheet |
| `/saved`, `/communities/[slug]`, `/organizations/[slug]` | §67 empty-state copy |

## Components Created

```
components/ui/icon.tsx                    Material Symbols ligature renderer
components/ui/emoji-picker.tsx            Portalled picker, recents, viewport-aware
components/stories/story-rail.tsx         Rail + avatar, category icons
components/stories/story-viewer.tsx       9:16 viewer, progress, swipe, pause
components/stories/story-composer.tsx     Zoom/position instead of forced crop
components/messages/message-bubble.tsx    4-signal sent/received treatment
components/messages/message-list.tsx      Grouping + day separators
components/messages/message-composer.tsx  Enter/Shift+Enter, keyboard tracking
components/profile/media-uploader.tsx     Avatar + cover, progress/success/failure
components/profile/edit-profile-sheet.tsx Username availability, dirty tracking
components/feed/comment-sheet.tsx         Sheet + panel, replies, emoji, likes
hooks/use-social.ts                       Typed hooks over the shared query layer
lib/story-categories.ts                   Central category→icon map (§39)
```

## Components Reused

`OptimizedImage` (responsive srcset) · `UserAvatar` · `EmptyState` /
`ErrorState` / `Skeleton` · `ReportDialog` · `RichContent` · the existing
`query.ts` layer (cache, dedup, retry, polling, infinite pagination) — the new
hooks are façades over it rather than a second cache, which would have forked
it and double-fetched.

---

## Profile Improvements

- **Banner works** — the field existed on the model and the header already
  rendered it; nothing could ever *write* it. `updateProfile` is now an
  explicit allowlist covering all 11 fields.
- **Avatar + cover upload** with progress, success and failure states. Uploads
  write straight through to the backend, so what you see is the stored URL,
  not a local preview that vanishes on reload.
- **Username** checked server-side while typing with a 400ms debounce; saving
  is blocked while invalid, so a bad username never reaches the API.
- **§56 propagation** — one save updates the header, nav avatar and cached
  session. No reload, no logout.

**Security note.** The allowlist is the fix, not a style choice. A blind
`req.body` spread onto a User document would let a user set `role` and
`points`. Both are tested against.

## Feed Improvements

- **Four filters** — For You, Following, Events, Communities. Backed by real
  post references, so no tab can show an empty list padded with unrelated
  content. Selection persists.
- **Campus is deliberately absent.** There is no institution field on a post
  to filter by, and inventing one would fabricate a feed.
- **Double-tap like** — two taps within 300ms/30px, touch and desktop.
  Deliberately **not** the like toggle: on an already-liked post it replays the
  animation and fires no request, so an accidental double-tap can never remove
  a like.
- **Trophy gated** — the achievement block now requires a rank, non-zero score,
  non-zero accuracy, or a real badge.

## Stories

Full system where none existed. 9:16 portrait accepted natively; non-9:16
images are zoomed and positioned rather than force-cropped.

**24h expiry is enforced at query time, not by a cron** — `expiresAt > now` is
what makes a story active. A story therefore cannot outlive its window because
a sweeper failed to run. `archivedAt` is stamped lazily, purely to give the
archive a sort key. Expired stories move to `/stories/archive`, grouped by
month, and remain openable.

## Comments

Bottom sheet on mobile, right-side panel on desktop, **one implementation** of
threading behind both. Real emoji picker. One-level replies behind
"View replies (N)", loaded on demand — the depth limit is enforced in the
controller, so no client can produce a thread the UI cannot render. Comment
likes, optimistic send with rollback, and a real error state with Retry.

The composer tracks `visualViewport` and lifts itself by the keyboard's height.
iOS does not fire a window resize when the keyboard opens, so a plain sticky
composer would sit underneath it.

## Messaging

The alignment branch **existed in source and could not fire** — with
`user._id` undefined, `mine` was false for every message. Fixed at the source
(session normalisation), then the surface rebuilt on top of a working `mine`.

Sent and received now differ on **four independent signals** — alignment,
fill, text colour, and tail corner — so the distinction survives any one of
them failing.

Grouping (§29), reactions (§31), archive (§32-33), reply quotes, and
Enter/Shift+Enter.

> **Decision (§33).** A new incoming message does **not** auto-unarchive.
> Auto-unarchiving silently reverses a deliberate user action and leaves no
> way to tell whether the thread was ever archived. It stays archived and
> raises an unread badge instead: visible, reversible, loses nothing.

## Archive

- **Stories** — `/stories/archive`, month-grouped, openable, deletable.
- **Messages** — `/messages` ⇄ archive toggle in the thread header. Per
  participant, so archiving never touches the other side's inbox. Nothing is
  deleted; archive is a view.

## Backend/API Changes Required

| Endpoint | Why |
|---|---|
| `POST /api/stories` · `GET /api/stories` · `/categories` · `/category/:key` · `/archive` · `/users/:id` · `/:id` · `POST /:id/view` · `DELETE /:id` | B3 — no stories backend existed |
| `PUT /api/auth/me/profile` (rewritten) | B2 — only 3 of 11 fields writable |
| `GET /api/auth/username-availability` | §23 availability while typing |
| `GET /api/posts/:id/comments/:commentId/replies` | §13 replies on demand |
| `POST /api/posts/:id/comments/:commentId/like` | §13 comment likes |
| `POST /api/messages/conversations/:id/archive` · `?view=archived` | §32-33 |
| `POST /api/messages/conversations/:id/read` | §58 unread badge |
| `POST /api/messages/:id/react` | §31 reactions |
| `GET /api/posts/feed?tab=events\|communities` | §6 filters |
| `login` returns `_id` | B1 — the message-direction bug |

Schema: `Story` model **new**; `Comment` gains `parent`/`replyCount`/likes;
`Conversation` gains `archivedBy`/`lastReadAt`; `Message` gains
`reactions`/`replyTo`/`attachment`; notification enum gains `reply`,
`story_reaction`, `community_activity` (`reply` was already being emitted and
failing validation, so reply notifications were being silently dropped).

## Performance Improvements

- Animations are transform/opacity only, so a like cannot stall a scroll.
  All collapse under `prefers-reduced-motion`.
- Heart bursts retire after 800ms — repeated taps don't accumulate DOM nodes.
- New hooks reuse the existing cache/dedup layer rather than forking it.
- Story feed refreshes on a 60s interval so an expired story cannot linger.
- Messages keep their adaptive polling (paused when hidden, stretching to 60s
  when unchanged) — an idle tab costs a trickle.

## Responsive QA

Breakpoints verified in the build across mobile → large desktop. Notable
handling:

- **Keyboard** — messages and comments both track `visualViewport`.
- **Safe areas** — fixed mobile chrome uses `env(safe-area-inset-*)`.
- **Horizontal rails** — story rail and filters scroll without a scrollbar.

## Removed Bad/Template UI

- **Category initials in story rings** → Material Symbols icons from the
  central map.
- **"Finished · 0 pts"** → the achievement block requires a real result.
- **The old comments modal** → replaced by the sheet.
- **The old inline profile dialog** → could not change avatar or cover at all.

## Remaining Mock Data

None found. Verified by grep across `src/`:

- §51 template identity — no hardcoded names, handles or avatars
- §52 fake engagement — no placeholder counts, XP or scores

## Known Limitations

- **Campus filter omitted** — no institution field on a post.
- **Story video upload** accepts video but the crop/position UI is image-only
  (video fills the 9:16 frame).
- **Message voice notes** not implemented — no backend support.
- **Story crop is client-reported** — the composer sends intrinsic dimensions
  for layout reservation; the served asset is the original framed by
  `object-contain`, not a server-side crop.
- **Visual QA is structural, not pixel-level.** Layout, hierarchy and
  responsive behaviour were verified; I could not render and eyeball the
  result against the reference images, so a design review pass is still
  warranted.

## Build

| Check | Result |
|---|---|
| Frontend build | **PASS** (`next build`, exit 0, 0 errors) |
| TypeScript | **PASS** (strict, 0 errors) |
| Tests — Part 8 backend | **PASS** (79 assertions, 0 failed) |
| Tests — existing suite | **PASS** (1429 assertions, 0 failed, exit 0) |
| Production runtime | **PASS** (`next start`, all routes 200, no server errors) |
| Secret scan | **PASS** (clean across the whole repo) |
| Visual QA | **PARTIAL** — see Known Limitations |

Commits: `c0be5ea` (audit + backend) · `d299061` · `79bc6f7` · `3ac71c1` ·
`9746c0d` · `c76a2ef` · `6c2519a`
