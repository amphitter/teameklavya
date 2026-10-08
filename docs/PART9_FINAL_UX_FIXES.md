# EVENTHUB PART 9 COMPLETE

Final UX fixes. Product fix and UX polish on the deployed application — no
rewrite, no architecture change, nothing removed from authentication, events,
registrations, tickets, check-in, live events, posts, comments, follows or
messaging. Every claim below was measured on a real backend with a real browser
at 320 / 390 / 1440; the harnesses and the screenshots are named so they can be
re-run.

---

## Profile

**PASS.** One screen serves both entry points — `/profile/<handle|id>` for
anyone and `/user/profile` for yourself — so there are no longer two headers,
two tab sets and two post renderers for the same thing.

* Cover image, avatar, display name, `@username`, bio, website, location,
  institution, skills/interests.
* Compact inline stats row: **Posts · Followers · Following** — not a dashboard.
* Own profile shows **Edit profile** plus the "…" menu; another person's profile
  shows **Follow / Following / Requested**, **Message**, and share/report/block.
* Desktop: large cover with the avatar overlapping its lower edge; mobile:
  compact. Cover → avatar → identity → stats → actions → tabs, content starts
  inside the first screen.
* `Member since` from the real `createdAt`; no invented badges.

Measured: `docs/mobile-qa/part9.js` §C — the profile renders, the counts are
live, `@ana_roy` is shown, and the empty state for a member with no posts is the
honest one. Screens: `qa/profile-audit/p9-profile-{320,390,1440}.png`.

**No fake data (§41).** Checked in the harness: the profile text contains no
`XP`, `LV`, `points` or `level N`. Everything numeric on that screen comes from
the profile payload.

## Profile Editing

**PASS.** Already built in Part 11 and re-verified here, not rebuilt.

* **Avatar** — Camera or Gallery, JPG/PNG/WEBP, size and dimension validation,
  preview, progress, saving state, and the new image appears on the profile,
  header, nav, composer, comments, posts and messages without a re-login (one
  canonical square crop, propagated through the session event).
* **Banner** — fully user-managed: upload, crop, reposition, save, remove. Real
  uploaded media; no hardcoded banner; a clean EventHub fallback when there is
  none — never an empty rectangle.
* **Username** — live availability (`Checking…` / `Available` / `Already taken`
  / `Invalid`), letters/numbers/underscore/period, no spaces or duplicates,
  enforced by a server-side uniqueness check rather than by the UI.
* **Display name, bio, website, location, skills** — `Unsaved changes` →
  `Saving…` → `Saved` → error, never a silent failure. A 2xx is success; only
  genuine failures surface a message.

Backend suite: `backend/tests/profile-edit.js` — **53 passed / 0 failed**.

## Posts / Saved / Liked / Archive

**PASS**, with one thing added this round: **Archive is now ONE destination with
two sections.**

* **Own posts** appear on your own profile immediately and are rendered by the
  same post component as the feed — no second-class profile post.
* **`/saved`** — private to you, cursor-paginated, remove-from-saved, open the
  original, and the empty state the brief names: **"No saved posts yet."** with
  an **Explore events** link.
* **`/liked`** — same shell, its own query.
* **`/archived`** — **Posts** and **Stories** tab sections. Archived posts
  vanish from the feed and the public profile but stay owned: View, Restore and
  Delete permanently. Expired stories are the second section, and the screen
  says out loud that archive is neither saved nor liked.
* **`/stories/archive`** still exists and renders the *same* body
  (`StoryArchiveBody`), so a story deleted in one place disappears from both.

`§12` "archive ≠ saved ≠ liked" is a correctness rule, and it is enforced by the
API, not by hiding tabs: `/posts/saved`, `/posts/liked` and `/posts/archived`
are three different filters, each viewer-scoped.

Measured: part9.js §C, plus `phase3.js` **57 / 0**, which drives a real post
through save → archive → restore and asserts the owner's counts match the lists.

## Story Creator

**PASS — this was the one genuinely missing P0/P1 block, and it is new this
round.**

The screen the brief calls the **story creator** is
`frontend/src/components/stories/story-creator.tsx` (opened from the rail's
*Your story*, the ⊕ badge, the Create menu, or `/?story=1`). It is **phone-only
for V1** (§14): on a desktop the same entry shows "Stories are created on the
EventHub mobile app." with a copy-link, and **no editor** — never a poor
approximation.

* Full-screen, mobile-first, one 9:16 canvas. Everything is positioned in
  fractions of the canvas, so the layout is identical at 320px and in the
  published story.
* **Media** — camera or gallery, photo or video; a non-9:16 photo is not
  aggressively cropped: **Fill / Fit / Reposition**, with drag and pinch-zoom.
* **Text** — the real keyboard, then the text becomes a movable **layer**:
  drag, pinch to resize, two fingers to rotate, align, weight, colour and an
  optional plate. Placeable anywhere; a canvas object, not a locked area.
* **Draw** — pen, marker, highlighter and eraser; colour palette, brush size,
  **undo and redo**; drawn with a finger directly on the canvas and kept inside
  it.
* **Stickers** — emoji tray plus mention / location / event / hashtag over real
  data (mentions search real users and carry real ids).
* **Layers** — every overlay is stored as metadata (type, position, scale,
  rotation, payload) and is re-rendered by the *same* component that drew it, so
  the preview is the published result.
* **Preview** — the exact final composition, with **Back**, **Save Draft** and
  **Share**; the audience is stated as EventHub's real model (followers, 24
  hours).
* **Publish** — upload media → create story → refresh the rail → success. The
  story is stored with its layers, and `POST /api/stories` now accepts the
  server-relative upload path the local storage provider returns (**this was a
  real bug: the upload answered 200 and creating the story answered 400, so
  publishing was impossible on that provider**).
* **Draft** is local to the device and says so.

Backend suite: `backend/tests/part9-stories.js` — **42 passed / 0 failed**
(round-trip of every layer type, 24-hour expiry, hostile payloads clamped, a
`javascript:`/`data:`/protocol-relative media URL and a traversing path all
refused, a server-relative path accepted, a non-follower blocked, a follower
served the layers).

## Story Viewer

**PASS.** `frontend/src/components/stories/story-viewer.tsx`.

* Tap right → next, tap left → previous, swipe sideways → next/previous,
  **swipe down → close**, Escape closes, ArrowLeft/ArrowRight step.
* Progress bars per item; the author, avatar and relative time; a delete path
  for your own story.
* Renders the published **layers** through the shared renderer, so a follower
  sees exactly what the author previewed; stories published before layers
  existed still render their legacy text overlay.

**Fixed this round:** your own active story was listed **twice** in the rail
(once as "Your story", once as your group) — and the ring opened the *creator*,
so there was no way to watch your own story. Now the ring means "watch mine" for
everyone, the ⊕ beside it creates, and your row appears once.

## Story Archive

**PASS.** Stories are kept for 24 hours, then leave the rail and move to the
archive — reachable from the Archive screen's **Stories** section, from
`/stories/archive`, and from a profile's "…" menu. Grouped by month/year, grid,
tap to reopen full-screen, delete, and the live/expired state is labelled on
each tile. Media, text, layers, `createdAt`, `expiresAt` and views are all
preserved (asserted in `part9-stories.js`: the archived story still carries its
layers and its month/year label, and another user's archive is empty).

## Feed Fixes

**PASS.** `/`, `components/feed/feed-view.tsx`.

* **No initials for a category.** Categories resolve through one mapping
  (`lib/story-categories.ts` + the backend's `CATEGORY_ICONS`) to real icons —
  hackathon → `code`, sports → `sports_soccer`, music → `music_note`,
  design → `palette`, AI/ML → `auto_awesome`, robotics → `smart_toy`. The
  backend suite asserts `categoryIcon === "code"` for hackathon.
* **Simplified rail** — Your story, the people you follow, then categories. No
  analytics look, no hero card, no oversized controls; a compact strip that fits
  the story and bell icons in one row at 320px.
* **The filter bug (§29)** — audited for z-index/overflow/pointer-events/touch
  handlers/stacking/event propagation **without** raising any z-index. The real
  cause was layout and touch behaviour: a hidden-scrollbar strip clipped the
  fourth tab, so the four filters are now a **2×2 grid on a phone** (a flex row
  from `sm` up), each **44px** tall, with `touch-action: manipulation`, an
  `aria-pressed` selected state, and a labelled group. Content updates without a
  full reload and the scroll position is kept.
* Skeleton while loading, retry on failure (all three owner lists retry from
  their error state).

**Fixed this round, found by the §49 sweep:** the category ring in the rail
rendered with two vertical lines running through it. The tinted disc's wrapper
was an inline box containing a flex child, so the browser split it and painted
its ring twice. It is now a block box — one clean ring.

## Mobile Navigation

**PASS.** The bottom nav stays Home / Explore / Create / Community / Profile
(it is **not** overloaded — the brief forbids putting Messages there), and
Messages keeps its persistent entry with a live unread badge. All entries are
full-height touch targets.

## Messages

**PASS**, re-verified as acceptance criteria — not rebuilt.

* **Entry** — bottom-nav Messages with an unread badge; on a phone thread the
  bottom navbar hides (verified in `phase3.js`).
* **List** — search plus **All / Unread / Teams / Archived**, with the archived
  unread count visible inside Archived; rows are avatar, name, last message,
  timestamp, unread badge and presence.
* **Bubbles** — **sent = right in the primary colour, received = left on
  surface**; consecutive messages grouped; intelligent timestamps.
* **Composer** — attachment, emoji, voice, send, respecting the safe area; the
  keyboard does not cover it (§18: sending does not close the keyboard).

**Fixed this round, found by the harness:** the inbox filter chips were **32px**
tall — a mouse target, not a thumb one. They are now 44px (and the same fix
applied to the team member picker). Part 10's suites are unaffected: 59/0
messages, 38/0 realtime.

## Responsive Fixes

**PASS.** `docs/mobile-qa/sweep.js` walks **15 screens at 320px and at 390px**,
including the new `/user/activity`, `/user/settings`, `/archived` and
`/stories/archive`: **0 overflowing elements on every route**. The same run
confirms each screen's own text is the only "wrong-language leak" and reports
none. At 1440 the feed, discovery rail and two headers behave (feed 620px · gap
32px · rail 320px, margins balanced: `ui-fixes` 221/0).

**Fixed this round:** the Settings privacy rows put a label and a
`shrink-0` three-option control on one line; at 390 the label collapsed to ~70px
and "Who can see your profile" broke to one word per line. Rows now stack on a
phone and go side-by-side from `sm`, with equal-width 40px minimum options so
three options cannot overflow at 320.

## Messages / Feed / Rail touch behaviour

Tap, long-press, drag, pinch, rotate, swipe and scroll are all handled with
pointer/touch events, not click-only assumptions. The story creator's gestures
were exercised through the browser's own touch pipeline (`Input.dispatchTouchEvent`),
not synthetic events — the first harness attempt that used hand-built
`PointerEvent`s produced fake passes and a real defect (`setPointerCapture`
throwing on a pointer id the browser never issued), which is exactly why the
gestures are tested through real input.

## APIs Added / Changed

The brief allows the smallest useful backend support when a UI function
genuinely does not work — and requires saying what was added. This round:

| Endpoint | Change | Why |
| --- | --- | --- |
| `POST /api/stories` | accepts a server-relative `/uploads/…` media path, still refusing `javascript:`, `data:`, `//host` and `..` | the local storage provider returns that shape; without it publishing always failed with "Media must be a valid URL" |
| `GET /api/stories` | returns `isMe` for the viewer's own group; rows carry `layers` | the rail needs to know your row is yours, and the viewer renders layers |
| `GET /api/stories/archive` | unchanged; now also consumed by `/archived` and `/user/activity` | one archive, two placements |

Everything the new screens do was already supported and already enforced:
privacy and message permissions via `PUT /api/users/me/social`, notification
mutes via `PUT /api/notifications/preferences`, saved/liked/archived via
`GET /api/posts/{saved,liked,archived}`, activity via `GET /api/users/:id/posts`
and the lists above. **No endpoint was invented for a screen that could not
otherwise be honest.**

## Performance

* Cursor pagination on saved / liked / archived (and 12-per-page on profile
  posts), one page at a time — no "fetch thousands".
* Only active stories load in the rail; the archive is a separate request and
  only fires when its section is opened.
* `loading="lazy"` on media grids; skeletons rather than blank space; the media
  transform in the creator previews on the client (see Remaining Issues).

## Visual QA

`docs/mobile-qa/part9.js` (96 checks), `sweep.js` (15 routes × 2 widths),
`shots9.js` → **41 screenshots** in `qa/profile-audit/p9-*.png`, covering every
screen the brief names, at **320 / 390 / 1440**. Checked: spacing, alignment,
touch targets (≥40px, ≥44px where the control is primary), overflow (0px
document overflow on every route at every width), font sizes, icon mapping, safe
areas, and loading / empty / error states.

Three real defects were found by this sweep and fixed rather than reported:
the doubled category ring, the crushed Settings labels, and the duplicate
"Your story" row.

## Remaining Issues

Stated plainly, because a report that hides these is worse than no report:

1. **Poll / question stickers are not shipped.** The sticker tray offers
   mention, location, event and hashtag only. There is no vote or answer model,
   and §20 forbids faking sticker functionality — so the honest answer is that
   they are absent, and the harness asserts they are absent rather than
   pretending.
2. **GIF / music / countdown stickers are not shipped** — same reason: no
   media-provider or audio infrastructure for them.
3. **The media transform (pan/zoom) in the story creator is preview-only.** The
   client uploads the image and sends the layers; the pan/zoom the user framed
   is not persisted as a focal point, so a re-crop on a different screen can
   differ slightly from the published story. Fixing it means a second render
   pass server-side, which is a larger change than this brief allows.
4. **No audience selector** beyond EventHub's existing model (followers, 24
   hours). There is no close-friends list in the data model; the preview states
   the real audience instead of offering a control that would not persist.
5. **Drafts are local to the device** (localStorage), not server-side.
6. **A "Comments I wrote" activity tab is deliberately absent** — there is no
   such endpoint, and a tab that renders an empty list because the API does not
   exist would be worse than not having the tab.
7. **Not verifiable from this environment:** a real phone's keyboard, hardware
   safe-area insets, 430px on real hardware, and desktop chat views. These
   remain parked from earlier rounds and are not claimed as verified here.

## Build Status

| Gate | Result | Evidence |
| --- | --- | --- |
| **Frontend build** | **PASS** | `npm run build` (same-origin + backend proxy) — compiled successfully, all routes emitted |
| **TypeScript** | **PASS** | `tsc --noEmit` — 0 errors |
| **Lint** | **N/A** | no ESLint in this repo; `tsc` + `build` are the gate |
| **Tests (backend)** | **PASS** | part9-stories **42/0** · part13-social **40/0** · part10-messages **59/0** · part10-realtime **38/0** · part11-profile-content **60/0** · profile-edit **53/0** · stories-audience **10/0** |
| **Tests (frontend)** | **PASS** | query **17/0** · messages-store **38/0** · crop **26/0** · image-variants **15/0** |
| **Mobile QA** | **PASS** | part9 **96/96** · ui-fixes **221/0** · feed-topbar **101/0** · part13 **98/98** · phase3 **57/0** · phase4 **50/0** · phase4-widths **132/0** · sweep 15 routes × 320/390, 0 overflowing elements |
| **Desktop QA** | **PASS** | 1440/1568 columns and margins measured (`ui-fixes`), desktop story creation correctly refused with no editor |
| **Visual QA** | **PASS** | 41 screenshots, `qa/profile-audit/p9-*.png` |

Two harness-side bugs were fixed rather than papered over: `boundingBox()`
returns `height`, not `h` (a check that could never pass as written), and a
selector that matched the ⊕ badge as well as the ring (so a "swipe" was 20px on
a 36px button).
