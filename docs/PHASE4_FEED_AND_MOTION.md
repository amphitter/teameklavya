# Phase 4 — the feed's second shape, and the micro-interactions that were dead CSS

Evidence for phase 4 of `docs/PART11_PROFILE_REBUILD.md` (§20–21). The audit that
decided what to build is `docs/PHASE4_FEED_AUDIT.md`; this file is what was
built, what running it actually found, and the numbers.

Everything below was measured on a real Chromium at a phone viewport
(390×844 first, then 320/360/375/390/412/430) against the seeded backend on
`:5999`, served through `next start` on `:3000` with the same-origin proxy — the
same code path a phone hits.

---

## What shipped

| File | What it does |
|---|---|
| `frontend/src/components/feed/use-feed-discovery.ts` | New. One cached `useQuery` per kind (`events`, `people`, `communities`) → `{people, communities, events, settled}`. Off the critical path; the rail and the cards share it. |
| `frontend/src/components/feed/discovery-card.tsx` | New. `DiscoveryCard` + `EventRow` / `PeopleRow` / `CommunityRow`. Returns `null` when its kind has no rows (D3 — real data or nothing). |
| `frontend/src/components/feed/feed-view.tsx` | The `stream` memo: posts with a discovery card after every third one, cycling the available kinds — the shape the feed could not express before, because `posts` is a flat array of one type. `for-you` only (D2). |
| `frontend/src/components/profile/avatar-preview.tsx` | New. Full-size preview of the canonical avatar, Escape to close, "Change photo" on your own profile, real `versionedUrl` so a stale copy cannot appear. |
| `frontend/src/components/feed/feed-post.tsx` | `like-pop` / `save-press` wired to keyed pulses (bumped only on the become-liked / become-saved edge, never on mount), plus `data-testid="post-media"` and `data-post-id` so a post can be addressed without counting. |
| `frontend/src/components/stories/story-viewer.tsx` | `key={story._id}` + `animate-viewer-in` — the third animation that was written for this purpose and referenced by nothing. |
| `frontend/src/components/feed/follow-author-button.tsx` | 36px-tall pill (was 25px), `aria-busy` instead of a disabled flicker. |
| `frontend/src/components/profile/profile-header.tsx` | The avatar is an affordance (it had no handler at all); honest `aria-label`. |
| `frontend/src/components/profile/profile-screen.tsx` | Follow is optimistic with rollback and single-flight, matching the feed's pill. |
| `backend/controllers/story.controller.js` | `followingIds()` read a field that does not exist (`following`; the model declares `followee`), so the story rail was empty for every signed-in viewer. Now `Follow.find({follower, status:"accepted"}).select("followee")` — the `accepted` filter keeps a pending follow on a private account from leaking stories. |
| `backend/tests/qa-mobile-server.js` | Seed for the above: real PNGs at real sizes, 16 posts, 3 events, 2 communities, one shared institution as a genuine suggestion signal. |
| `backend/tests/stories-audience.js` | New regression suite (10 assertions) that guards the follower's stories being visible, and the non-follower's not. |

---

## The rhythm, as rendered

```
post → post → post → post → card:events → post → post → post → card:people
     → post → post → post → card:communities → …
```

Cards never open the stream, are never adjacent, and never follow fewer than
three posts — checked in the DOM, not derived from the code.

---

## Evidence

### `docs/mobile-qa/phase4.js` — 390×844, real Playwright, real backend: **50 passed, 0 failed**

| Section | What it proves |
|---|---|
| 1 | Every card's rows are cross-checked against the API response fetched independently in the same page (events, people, communities); no card opens the stream; no two cards adjacent; every link has a real destination. |
| 2 | The interval: `posts before each card: [4,3]` — a card appears only after ≥3 posts. |
| 2b | After "Load more posts": `16 posts, 4 cards (events, people, communities)` — the kinds rotate, the ≥3-post spacing holds **across the page boundary**, and the card index does not restart (no duplicate React keys). |
| 3 | Following has zero discovery cards; they return on For You. |
| 4 | Request budget: **19 API calls, 3 discovery, 1 per kind**, none of them `counts/batch`. Paint order measured with a `MutationObserver`: posts and the first card land in the **same frame** — the rhythm never gates the content. |
| 5 | Like: `aria-pressed=true` and `animationName: like-pop`. Save: label `Unsave`, `animationName: save-press`, toast "Saved". Double-tap: `.animate-heart-burst` present with `animationName: heart-burst`, post liked, present in `/posts/liked` — and a **second double-tap does not unlike** (server-checked). |
| 5b | Story viewer opens from the author's ring, media decoded, `animate-viewer-in` on the media container, progress bars present. |
| 5c | Avatar preview: opens from the avatar, real decoded image (`naturalWidth > 0`), identity shown, Escape closes. |
| 5d | Follow: **label flips 6ms after the tap; the server responds 23ms after the tap** — i.e. the flip precedes the response, measured rather than assumed. |
| 6 | `prefers-reduced-motion: reduce` collapses the animations (`1e-05s` for the heart) while the feed still renders its cards. |
| 7 | The comment sheet still opens over the new stream. |
| 8 | Zero uncaught page errors for the whole run. |

### `docs/mobile-qa/phase4-widths.js` — six widths: **132 checks, 0 failures**

320/360/375/390/412/430 at deviceScaleFactor 2, `isMobile`, `hasTouch`:

* no horizontal overflow of the page (document **and** body) on the feed, the
  profile, or with the avatar preview open;
* the discovery card and every control inside it — including the follow pill —
  stays inside the viewport at every width, and each card renders real rows
  (counted by distinct child `top` offsets, not by height);
* the follow pill measures `77×36` everywhere (it was `77×25` before this phase);
* the double-tap media surface is ≥120×80 and on screen;
* the avatar affordance is square; the preview dialog fits the viewport and
  shows the decoded photo — or, for a member with no photo, initials rather than
  a broken image;
* the story viewer adds no sideways scroll and keeps its media inside;
* the profile's Follow/Edit row is inside the viewport at a tappable height;
* no uncaught page errors at any width.

### Regressions

| Suite | Result |
|---|---|
| `docs/mobile-qa/phase3.js` (profile + owner lists) | **57 passed, 0 failed** |
| `docs/mobile-qa/phase3-widths.js` | **0 failures across 6 widths** |
| `backend/tests/stories-audience.js` (new) | **10 passed, 0 failed** |
| `backend/tests/phase4.selftest.js` | 37 passed, 0 failed |
| `backend/tests/part11-profile-content.js` | 60 passed, 0 failed |
| `backend/tests/uploads-static.js` | 9 passed, 0 failed |
| `backend/tests/phase3.selftest.js` | 44 passed, 0 failed |
| `tsc --noEmit` | 0 errors |
| `npm run build` | ✓ 34/34 pages |

---

## What running it found that reading it did not

Full write-up in `docs/PHASE4_FEED_AUDIT.md` §"Part 3". In short:

1. **F5** — every phone load fetched the discovery data **twice** (5 calls, not
   3): the rail kept its own two effects. Now one request per kind, shared.
   Fixing it also removed one wasted request per signed-in load (the rail's
   logged-out events fetch fired on the first render, when `user` is still
   `null`, and then discarded its result).
2. **F6** — the profile's Follow button was **not** optimistic while the feed's
   pill was: the label flipped at **+2038ms, after the response at +2032ms**, and
   the button was disabled for the whole round trip. Now optimistic with
   rollback; measured at 6ms vs 23ms after the fix.
3. **F7** — the follow pill was **25px tall** at every width. Now 36px.
4. **F8** — `aria-label="View profile photo"` was announced even for members
   with no photo. Now `Profile photo, not added yet`.
5. The story rail was empty for every signed-in viewer — a backend field-name
   bug (`following` vs `followee`) that is indistinguishable from "nobody
   posted", which is why it survived. Fixed and guarded by a suite.

Two fixtures were also lying, and were replaced: the seeded story was a **1×1
transparent PNG** (so "media loaded" passed while the screen was empty), and a
six-post feed can only ever render **one** card kind — which meant the people
row, the tightest layout on the phone, was never rendered in any width test.

---

## Not verified — do not read these as passing

* A real phone keyboard, `env(safe-area-inset-*)`, and IME gestures. The
  on-screen keyboard does not exist in the harness; inset behaviour is
  unexercised.
* 430px on real hardware (the matrix is a viewport, not a device).
* The feed's next page is an explicit **"Load more posts"** button, not infinite
  scroll. The rhythm was verified across it; whether it *should* auto-load on
  scroll is a product decision and was deliberately not changed.
