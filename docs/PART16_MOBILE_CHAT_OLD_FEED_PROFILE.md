# PART 16 — Mobile chat viewport · Old Feed · Profile

Three blocks, one theme: things that looked right in a screenshot but were not
right on a phone. Everything below was measured on the running app, at the
widths a phone actually uses, and every number in this document comes from a
check that is committed alongside it.

| Block | Harness | Result |
|---|---|---|
| A · mobile chat viewport | `docs/mobile-qa/check-part16.js` | 162 passed / 0 failed |
| B · Old Feed (browser) | same file, section B | included above |
| B · Old Feed (server) | `backend/tests/part16-old-feed.js` + `docs/mobile-qa/check-part16-oldfeed-api.js` | 28 / 0 · 23 / 0 |
| C · profile | `docs/mobile-qa/check-part16-profile.js` | 50 passed / 0 failed |
| C · identity pipeline | `docs/mobile-qa/check-part16-avatar.js` | 23 passed / 0 failed |
| C · cross-surface avatar gate | `docs/mobile-qa/check-identity.js` | 18 avatar renders, 0 leaks |

Regression gates re-run after these changes: `check-part15` 218/0 ·
`check-messages` 130/0 · `part14` 320/0 · `part9` 100/100 · `ui-fixes` 167/0 ·
`part14-feed-impressions` 30/0 · `part10-messages` 59/0 · `part10-realtime`
38/0 · frontend units 26/0, 15/0, 17/0, 38/0 · `npm run build` clean
(parse-check 193 files, compiled).

---

## Section 1 — the thread fits the phone, and the feed no longer dead-ends

### 1. The chat is one viewport tall, and the document never outgrows the screen

**Root cause, at the source.** `components/shell/app-shell.tsx` wrapped every
route in `min-h-screen` — `min-height: 100vh`. On a phone `100vh` is the
viewport *with the browser chrome hidden*, so it is taller than what the user
can actually see. The conversation page is exactly one visible viewport tall
(`h-[100dvh]`), which put a 100dvh box inside a 100vh minimum: the document
grew, the page itself became scrollable, and the chat stopped being pinned.

The fix is one declaration plus its fallback:

```tsx
<div className="min-h-screen min-h-[100dvh] bg-background">
```

`min-h-screen` stays first for engines without `dvh`; the `dvh` value wins
where it is supported, and on desktop the two are identical, so nothing moves
there. The chat route also gained `overscroll-none` so iOS cannot rubber-band
the document behind a thread that carries its own `overscroll-contain`.

**Measured** at 320 / 360 / 375 / 390 / 412 / 430 and in landscape
(844×390): document height ≤ viewport, body height ≤ viewport, header at
`top = 0`, composer's bottom edge exactly at the viewport bottom, and exactly
one element in the entire chat whose `overflow-y` allows scrolling.
The mechanism is measured too, not just asserted: on the real page with a
`100vh > dvh` gap introduced, the page becomes scrollable and the header drifts
off-screen (`headerTop < 0`) — and with the `dvh` minimum it does not.

### 2. Only the history scrolls; header and composer stay put

The header is a 44–64px strip at the top edge at every width, the composer row
spans the full viewport width with its bottom edge on the viewport bottom, and
the history is the only scroller (`scrollHeight > clientHeight` is asserted, so
an empty thread cannot pass this section by accident). The last message clears
the composer when scrolled to the end.

### 3. The keyboard lifts the composer instead of pushing it off

On focus, a 320px keyboard inset shrinks the history by ~320px, ends the input
*above* the keyboard, keeps the header at `top = 0`, and never makes the
document scroll. In landscape (390px of height) a 320px keyboard leaves 70px —
less than the header plus the input row, so no layout can satisfy "input above
the keyboard" there; the assertion at that size is the one that still matters
(inset applied, header unmoved, no page scroll), and the harness says so in a
comment rather than hiding it.

### 4. Landscape and tablet widths, and the Part 15 right edge

Part 15 fixed a phantom 28px rail that pushed sent bubbles 43px off the edge.
That guarantee is re-asserted at every width above as two precise facts:

* the sent row is **flush** with its message column — 0px inset, no rail;
* its distance from the screen edge is the **16px safe padding plus the
  centring of the capped column** (`max-w-3xl`, 768px), which is 38px at 844
  and 16px on every phone.

An earlier version of the harness compared the bubble to the *scroller*, read
38px at 844 and called it a regression. It was the centring gutter; the
reference was wrong, not the layout. Worth recording because it is exactly the
kind of measurement that starts a second round of "fixing" a thing that is
already correct.

### 5. Desktop is unchanged

The `min-h-screen` / `min-h-[100dvh]` pair is identical above the `dvh`
breakpoint, the desktop aside (`w-60`) and the capped column are untouched, and
`part14.js` §G (desktop unchanged, §26) still passes — 320 checks, 0 failures.

### 6. The fresh feed keeps its own policy — nothing was relaxed

The fresh query still excludes liked and dismissed posts and still **demotes**
seen ones below everything unseen (§23–§25, unchanged). This mattered enough to
test twice: `part14-feed-impressions.js` (30/0) asserts "demoted, not deleted",
and the new `part16-old-feed.js` asserts the ranking property directly — every
unread post above every read one — plus that liked and dismissed stay excluded.

An early draft of the new browser harness asserted "seen posts are never
re-served", which contradicts the policy Part 14 already locked in. The
assertion was wrong and was corrected, not the product.

### 7. "You're all caught up" appears when the fresh stream is actually spent

The strip is bounded by the stream's own state (`!isLoading && !error &&
!hasMore`), because its words are a promise: showing it while pages are still
arriving would be a lie. It reads as a pill between two rules, then one line of
copy.

### 8. The OLD FEED section sits below it, never interleaved

The server marks each fresh card with `seenByMe` — a report from the ranking
pass it already performs, not a second query — and the boundary is drawn at the
**first demoted card**, once the stream is spent:

```
… unread posts … | ✓ You're all caught up | OLD FEED | … posts you have read …
```

Everything above the boundary is content the viewer had not seen; everything
below is history. No post is rendered twice (asserted on `data-post-id`). The
browser harness seeds this state deterministically by publishing a post as
another user, then removes it again — the first version left those posts behind
and eventually crowded the second viewer's feed badly enough to break
`part14.js` §F, which is how the cleanup requirement was discovered.

### 9. "History" is seen posts **and** liked posts

This is where the pass found a real defect. Likes live in `Reaction`; reads
live in `PostImpression`. Nothing ever writes a `kind: "liked"` impression row,
so a history built from impressions alone silently dropped **every post the
viewer liked without opening it** — which is most of them.

`findSeenCandidates()` now reads both stores over the same bounded window the
feed itself uses (`EXCLUSION_WINDOW`), merges them keeping the newest signal
per post, and sorts by time. `part16-old-feed.js` has a dedicated case: a post
that is liked and never read must appear in the history, and "the two stores
really are separate" is asserted from the row counts.

### 10. A dismissed post never comes back — not even later

Dismissals are read first and applied as a hard exclusion before the candidate
scan. The suite dismisses a post, then records *two more* impressions for it,
and asserts it is still absent from every page: dismissal beats a fresh
impression. This is the one rule the spec states twice (§21), so it is tested
twice.

### 11. Cursor-paginated, newest signal first, no repeats

Pages honour the requested size, return `hasMore` + `nextCursor`
(`<ISO at>|<postId>` — the same shape the fresh feed's cursor has), and a full
crawl contains no duplicates. The crawl is also repeated at a different page
size, because an off-by-one that only shows up at one size is the classic
pagination bug.

### 12. Visibility is respected, and anonymous callers get a page, not an error

The ids go through `PostRepository.hydratePostsForViewer`, so the repository
decision — published, visible to this viewer — is the only thing that can put a
card on screen. Deleting a post removes it from the history (asserted). A
signed-out caller gets `200` with an empty page.

*(An earlier assertion used the author's "archive" flag as a visibility probe
and failed: archiving is a personal flag of the author, not a visibility
change — a viewer legitimately still sees the post. The probe was replaced with
deletion, which is unambiguous.)*

### 13. Old cards are ordinary feed cards

Same hydration, same shape (`author`, `likeCount`, `savedByMe`), so the same
`FeedPost` component renders them. No second card component, no second style.

### 14. History is per viewer

One viewer's history is not another's — asserted on the server suite and in the
browser probe.

### 15. Nothing is listed twice

The in-place demotion and the fetched history cannot duplicate each other: the
`mode=old` results are filtered against every id already on screen before
rendering. The "extra history" block only ever adds posts from *older than the
current pool*.

---

## Section 2 — Profile

### 16. One canonical avatar, one asset, everywhere — verified end to end

The requirement was a deterministic crop pipeline with a single canonical
avatar for every surface, and no per-component cropping. **That architecture
was already in place and the pass verified it rather than rewriting it**, which
matters for what you should expect from this section:

* `services/media.service.js` rejects a non-square avatar at upload ("A profile
  photo is uploaded as a square, but that one is W×H. Crop it first."), so the
  stored asset *is* the user's chosen square;
* `components/user-avatar.tsx` requests square variants only, with an explicit
  `object-fit: cover` + `50% 50%` box and no caller-supplied `object-position`;
* `components/media/crop-editor.tsx` + `lib/crop.ts` + `utils/canonical-image.ts`
  own the pick → crop → canonical render → upload → store flow.

`check-part16-avatar.js` drives the real UI: pick a file, drag the crop, confirm
(`POST /upload/image?folder=avatars&purpose=avatar → 200`), persist
(`PUT /auth/me/profile → 200`), then assert the *stored* shape (`avatar`,
`avatarCrop`, a non-zero `avatarVersion`) and that the new photo appears on the
profile **without a page reload** and on the feed top bar after client-side
navigation — same asset, square, centred. Dragging the crop canvas does not
scroll the page (the classic mobile trap for a gesture editor).

### 17. Banner: its own crop, and a focal point that survives a reload

The cover has a separate editor (`aria-label="Cover photo"`, 3:1) and uploads
to `folder=posters&purpose=cover`. The harness drags it, saves, reloads, and
asserts the banner renders at the **stored** focal point — it came back as
`50% 75%`, not a reset to `50%`. Fixture note: a 3:1 source cannot move
vertically (the canonical canvas is already 3:1), so the harness uses a taller
source; a 3:1 fixture would have made this assertion pass vacuously.

### 18. Counters, tabs, and a save that reports the truth

* **Counters are the server's numbers.** Posts / Followers / Following read off
  the screen match `GET /users/:id/profile`'s `stats` exactly.
* **They move in place.** Following someone moves the follower counter without
  a reload (1 → 0 in the run, direction depending on the fixture), and toggling
  back restores it.
* **Tabs are backed by real data.** Events, Media, Achievements, Saved, Liked
  and Archive each select, render, and produce no error state; no API call
  fails while walking the whole profile.
* **Owner-only stays owner-only.** Another user's profile does not show Saved /
  Liked / Archive.
* **Mobile.** At 320/360/375/390/412/430: no horizontal overflow, nothing wider
  than the screen, the edit affordance inside the screen and ≥32px tall.
* **The save contract.** One save action issues exactly **one** `PUT
  /api/auth/me/profile` (double-click included), a 2xx never surfaces
  "Couldn't save", and a genuinely forced `500` **is** reported to the user
  (the run shows the server's own message: `boom`).

The "Couldn't save profile after HTTP 200" symptom did **not** reproduce here.
`edit-profile-sheet.tsx` already treats a 2xx as success, already guards the
double submit and already silences cancelled requests. What the new checks
guarantee is the part that was missing before: the *contract* is now pinned by
tests, so a future change that swallows a real error, or invents one after a
success, fails the suite instead of shipping.

---

## Remaining issues

1. **This block was verification, not a rewrite, for most of Part C.** The
   canonical avatar pipeline, the crop editors, the upload validation and the
   save semantics were already implemented and correct; §16–§18 above pin them
   with tests. The only *product* defects this pass fixed were the chat viewport
   (`min-h-screen`) and the liked-but-never-read hole in the history query
   (§9). Saying otherwise would overstate it.
2. **Liked-but-never-read history could not be cross-checked against pre-existing
   database data.** The dev/QA data here is seeded fresh; the fix is proven by
   the suite, and the same two collections are read, but no production corpus
   was available to compare against.
3. **Landscape + 320px keyboard is physically unsatisfiable on a 390px-tall
   screen.** Recorded rather than papered over (§3).
4. **`seenByMe` is attached to fresh feed responses.** It is additive metadata
   on a response clients already parse; older clients ignore it. Worth knowing
   if the API is ever frozen.
5. **The identity sweep covers the six surfaces that draw people** (feed +
   stories, inbox, thread, search, explore, notifications). Raw `<img>` tags
   elsewhere in the app are media (posters, event banners, org logos), not
   identity, and were not part of this sweep.

## Files

* `frontend/src/components/shell/app-shell.tsx` — `min-h-screen min-h-[100dvh]`
* `frontend/src/app/(app)/messages/[id]/page.tsx` — `overscroll-none`
* `frontend/src/components/feed/feed-view.tsx` — `seenByMe` boundary, OLD FEED section, `mode=old` query
* `backend/services/feed-impressions.service.js` — `findSeenCandidates()` (Reaction ∪ PostImpression, dismissal as a hard exclusion)
* `backend/controllers/post.controller.js` — `mode=old`, `seenByMe`
* `backend/tests/part16-old-feed.js` — the server contract (self-booting, in-memory Mongo)
* `docs/mobile-qa/check-part16.js` · `check-part16-profile.js` · `check-part16-avatar.js` · `check-part16-oldfeed-api.js` · `check-identity.js`

---

## §B update — history is the fallback when the fresh stream is empty

**Rule change.** `mode=old` was only asked for when the fresh stream contained a demoted
(already-seen) card to draw the boundary at (`boundaryIndex >= 0`). A pool with **nothing
fresh at all** therefore never fetched history and fell through to the onboarding panel —
"Your event story starts here" — with the viewer's own history one query away and no way to
reach it. It hit hardest for the most active user: liked posts and dismissed posts are
HARD-excluded from the fresh query (only *seen* posts are demoted), so someone who liked
everything is exactly who gets an empty fresh stream.

The gate is now:

```
oldEnabled = for-you  &&  fresh exhausted  &&  (a boundary to draw  ||  nothing fresh at all)
```

Yes — liked posts appear, and that is the intended reading of the rule: a liked post is never
in FRESH (unchanged), and OLD FEED is precisely where it may surface. Both queries keep their
own policy; this changes **when** `mode=old` is requested, never what `mode=fresh` returns.

**Where the strip goes.** The "✓ You're all caught up / OLD FEED" boundary normally lives
*inside* the stream at the first demoted card. In a history-only feed there is no such card,
so the same strip is drawn above the history section (same copy, same weight — §89).

**Five states, one decision.** The render used to be a chain of negated conditions. It is now
`resolveFeedSections()` in `frontend/src/lib/feed-sections.ts` — a pure function covering:
fresh loading · fresh error · fresh posts · nothing fresh + history in flight (skeletons, so a
viewer with a full history is never told their feed is empty while it loads) · nothing fresh +
history · nothing fresh and nothing in history (a genuinely new account keeps the onboarding
panel). Verified by compiling the module and running 14 cases against it, including the bug
case and the cached-history case.

**Deliberately not changed:** history stays cursor-paginated at 10 per page with an explicit
"Load more from Old feed"; the history pool stays bounded by `EXCLUSION_WINDOW` (400), the same
window the feed itself uses, so an empty fresh stream does not turn the Old Feed into an
unbounded archive walk (§88); and a history fetch that fails degrades to the ordinary empty
state rather than an error panel — a fallback that cannot load must not take the screen down.
