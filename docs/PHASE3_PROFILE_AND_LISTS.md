# Part 11 · Phase 3 — the profile rebuild, and the three lists that were invisible

**Status:** complete and verified in a real browser at 390×844 and 320–430 px.
Backend `part11-profile-content.js` 60/0 · `uploads-static.js` 9/0 · browser
`phase3.js` 57/0 · `phase3-widths.js` 0 failures across 6 widths · `tsc` 0 ·
`npm run build` ✓. All earlier suites re-run green (see §6).

This phase was scoped by `docs/PHASE3_PROFILE_AUDIT.md`, which is the record of
what was wrong *before* anything was touched. Read it first; this file is what
changed and what it was verified against.

---

## 1 · The audit's eight findings, and their fate

| # | Finding (before) | Now |
|---|---|---|
| A1 | `POST /posts/:id/archive` existed with **zero frontend callers** — archiving was impossible from the app | Archive / Restore in the post's ••• menu, on the profile **and** in the feed, with an Undo action on the toast |
| A2 | No `/liked` or `/archived` page existed; `/saved` was a bespoke screen | One `OwnerListPage` shell serves `/saved`, `/liked`, `/archived`, reachable from the account menu |
| A3 | The profile's Posts tab was a static grid — posts you could not like, comment or save | The Posts tab renders `PostList` → the **feed's own `FeedPost`**; like/comment/save/shares behave identically to the feed |
| A4 | Five dashboard tiles (Events · Attended · Hosted · Posts · Followers) | One inline row: **`10 Posts · 1 Followers · 2 Following`**, plus an `attended · hosted` clause that only appears when non-zero |
| A5 | Media tab scraped 12 images off already-loaded posts | Real `GET /api/users/:id/media` endpoint, paginated grid, every tile links to its post |
| A6 | Tab counts showed `posts.length` (capped at 24) while the header showed true totals | A count appears **only when the list is complete**, and then it is the list's own length |
| A7 | The Posts stat included archived posts, so header and Posts tab disagreed | `stats.posts` filters `{status:"published", archivedAt:null}` — the number now equals what the tab renders |
| A8 | saved ≠ liked ≠ archived was claimed but never tested | `part11-profile-content.js` — 60 assertions, the negative ones first |

## 2 · What the phase added

**Backend (smallest changes that make the UI honest)**

- `GET /api/users/:id/media?page=&limit=` → `{posts:[{_id, images[], content, createdAt, event}], page, hasMore, total, canView}` — published, unarchived, image-bearing posts only; `canView:false` on a private profile.
- `stats` for the **owner only** also carries `archivedPosts` and `draftPosts` — a visitor is never told about anyone's archive.
- `stats.posts` excludes archived (A7).

**Frontend (architecture, not patching)**

- `components/feed/post-list.tsx` — one list, four consumers (profile, saved, liked, archive), page-based *and* cursor-based, with a run-id guard so a slow first page cannot land after a fast second one.
- `components/feed/owner-list-page.tsx` — the shared shell for the three owner lists.
- `components/profile/media-grid.tsx` — the real grid.
- `components/profile/profile-screen.tsx` — **one** profile screen, rendered by both `/user/profile` (the post-login landing page and the account-menu target) and `/profile/[id]`. Before this, only `/profile/[id]` had been rebuilt, so the rebuild was unreachable from the menu that points at it.
- `components/profile/profile-header.tsx` — the compact `Stat` row replaces the tile grid.
- Deleted with `git rm` (nothing imported them): `components/profile-view.tsx`, `components/profile/profile-view.tsx`, `components/profile/posts-grid.tsx`.

## 3 · Four defects found by *running* it, not by reading it

1. **Archive was owner-only in the lists but not at the permalink.** `canViewPost` never consulted `archivedAt`, so anyone holding the URL still got the post and its comments — while the toast promised "only you can see it". Now an archived post is visible to its author alone.
2. **`canViewPost` never recognised the author of a populated post.** `String(post.author)` on a populated user is `"[object Object]"`, so the ownership check silently failed on the single-post route. Latent until (1) made it matter: the fix locked the owner out of their own archived post. Now resolved through `authorIdOf()`.
3. **Everything uploaded was 404.** `server.js` served `/uploads` from a hardcoded `backend/uploads` while the storage provider wrote to `UPLOADS_DIR`. Any environment that set the variable accepted the upload, stored it, returned its URL, and served nothing — the seeded media grid rendered seven broken-image glyphs. The mount now uses the provider's resolved directory and keeps the legacy one as a fallback. `tests/uploads-static.js` asserts the round trip byte-for-byte.
4. **The tab strip hid its own tabs.** Seven tabs in a `no-scrollbar overflow-x-auto` pill put Achievements, Saved, Liked and Archive past the right edge of every phone — the phase's headline feature was invisible until you happened to drag the strip. The strip now **wraps** (2 rows at ≥375, 3 at 320, **0 px hidden**). This is the A1 failure mode repeating itself, so the widths harness now asserts `scrollWidth - clientWidth <= 1`.

## 4 · Cross-surface rule established this phase

`FeedPost` gained `onArchived(id, archived)`. Every list that renders it consumes it:

- profile Posts tab, Saved, Liked → the card is removed;
- Archive tab → restoring removes it from Archive;
- **the feed** → added to the same `removed` overlay that hides a deleted post, and **Undo/restore puts it back** without a refetch.

Without that last one the feed kept showing a post the toast had just declared invisible.

## 5 · Evidence

| Check | Result |
|---|---|
| `node tests/part11-profile-content.js` | **60 / 0** |
| `node tests/uploads-static.js` | **9 / 0** |
| `node phase3.js` (390×844, real backend) | **57 / 0** |
| `node phase3-widths.js` (320/360/375/390/412/430) | **0 failures** |
| `tsc --noEmit` | 0 |
| `npm run build` | ✓ 13.2 s |

The live harness drives **both** entry points, archives through the ••• menu (not the API), asserts the card leaves the screen *and* the API, checks the toast, restores, checks Saved ≠ Liked with fixtures chosen so the lists must differ, loads the media grid and requires every image to have **decoded** (`naturalWidth > 0` — counting `<img>` tags is how broken images passed before), then repeats the whole thing as a visitor who must see none of it.

Screenshots: `qa/profile-audit/phase3-390.png`, `phase3-320.png` … `phase3-430.png`, `phase3-visitor-profile.png`.

## 6 · Regression sweep after the change

| Suite | Result |
|---|---|
| backend `part11-profile-content` · `uploads-static` · `media-canonical` · `profile-edit` · `user-achievements-route` · `part11-teams` · `part10-messages` · `part10-realtime` · `part7-recovery` · `part7-scale` · `phase2` · `phase3` · `phase4` · `phase6` · `phase7` · `phase8` | all 0 failed |
| frontend `run-crop` · `run-variant` · `run-query` · `run-messages-store` | 26/0 · 15/0 · 11/0 · 38/0 |
| `sweep.js` at 390 + 320: 9 routes each | no page horizontal overflow, no desktop header on mobile |
| `scrollbar2.js` (composer scrollbar) | PASS |

**Two selftests needed their file lists corrected, not weakened:** `phase4.selftest.js` named two files Phase 3 deleted (`profile-view.tsx`, `posts-grid.tsx`) — an assertion pointed at a deleted file stops testing anything. It now names the live owners (`post-list.tsx`, `media-grid.tsx`, `crop-editor.tsx`, `canonical-image.ts`), and accepts the canonical renderer as the profile's on-device compression path (it re-encodes at fixed pixels + quality, which is a *stronger* guarantee than `compressFor` for an identity image).

**Pre-existing, not mine:** `phase5.selftest.js` reports 5 failures about adaptive polling in `app/(app)/messages/page.tsx`, `components/shell/messages-link.tsx` and `presence-dot.tsx`'s 60-second tick. Verified identical at HEAD (`52e4463`) in a clean worktree. Carried forward for Part 10/5.

## 7 · Limits — do not read as verified

- Real phone keyboard, real IME gestures, `env(safe-area-inset-*)` and 430 px on hardware remain unverified (unchanged from Phase 2).
- The tab strip wraps to 3 rows at 320×568. Accepted: hiding a tab is worse than one more row. If the owner lists grow again, revisit the grouping rather than restoring a scroller.
- `status:"draft"` posts are counted for the owner but have no UI surface yet.
- A deep link straight into `?tab=archive` is not supported; the tab resets to Posts on load.
