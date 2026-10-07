# Phase 4 audit — where the "static/dull" feeling comes from, and which micro-interactions are real

Written after reading the code and measuring the running app. Same rule as every
earlier phase: **every claim below is a measurement or a grep, not an impression**.
Where the brief's assumption and the code disagree, the code wins and it is
called out — three of the six micro-interactions the brief asks for were already
built, and two of them are sitting in `globals.css` fully written but never
wired to anything.

---

## Part 1 — The feed

### F1 · The feed body is one component repeated. There is no rhythm, by construction.

`feed-view.tsx` renders every item between the composer and "You're all caught
up" as `FeedPost`, in a single `space-y-5` column. Ten posts, ten identical
cards: same padding, same border, same weight. Nothing is emphasised because
nothing is different.

This is not an accident of styling — it is the shape of the data. `posts` is a
flat array of one type, so the renderer *cannot* vary density. The audit in
`docs/UI-UX-AUDIT.md` predicted exactly this (§1: "a ranked, interleaved feed
composer… feed items become a discriminated union").

### F2 · All of the app's real discovery content is invisible on every phone.

`right-rail.tsx:217` is `<aside className="hidden w-80 shrink-0 xl:block">`.

Everything below it — the user's registered upcoming events, trending topics,
trending events, suggested people, suggested organizations — is `display: none`
below 1280px. The app already fetches this data and already renders it well; a
phone just never sees any of it. So the mobile feed is: greeting, search, live
hero, stories, tabs, composer, then ten identical posts, forever.

This is the whole finding. "Dull" is the correct reaction to a screen that
earns its data and shows a tenth of it.

### F3 · The endpoints the rhythm needs already exist and are already in use.

| Content | Endpoint | Already called by |
|---|---|---|
| Suggested people | `GET /users/suggested?limit=` (deterministic: mutuals, co-registered, same institution) | `right-rail.tsx:165` |
| Suggested organizations | `GET /organizations/suggested?limit=` | `right-rail.tsx:176` |
| Communities | `GET /communities?limit=` (public, `optionalUser`) | `/communities` page |
| Upcoming events | `GET /events?status=upcoming&limit=` | `right-rail.tsx`, explore |
| The user's own upcoming events | `GET /registration/user/events` | **already in `feed-view.tsx` state** (`myUpcoming`) |

No new backend endpoint is needed for any of it. Nothing is fabricated: every
card renders rows the API returned.

### F4 · The brief's own rhythm was never implemented in the body.

`docs/UI-UX-AUDIT.md` §1 expected
`stories → live event → post → recommended event → post → community → post → upcoming`.
The top of the feed does the first two (live hero, story rail). The body does
none of the rest.

---

## Part 2 — The six micro-interactions, measured

| # | Brief asks for | Reality in the code | Verdict |
|---|---|---|---|
| 1 | like scale + double-tap | `feed-post.tsx:447` `whileTap={{scale:1.35}}` spring; `likeFromDoubleTap()` with `heart-burst` at the tap point, **idempotent toward liked** (`if (liked) return` — an accidental double-tap can never unlike), rollback + heart retained for the animation's length on API failure, `pointer-events:none` on the overlay | **already done (Part 9)** — verify live, change nothing |
| 2 | save confirmation | optimistic toggle + toast, and `@keyframes save-press` (`globals.css:367`) written and **referenced by nothing** | **gap: wire the existing animation** |
| 3 | instant follow transition | `follow-author-button.tsx` is optimistic with rollback and a module-level status cache; label flips `Follow → Following` immediately | **done** — only press feedback missing |
| 4 | smooth comment open | `comment-sheet.tsx:83` `animate-sheet-up` + `animate-fade-in` backdrop | **already done** — verify live |
| 5 | story transition | opening the viewer fades the whole overlay (`animate-fade-in`), but moving **between** stories swaps the `<img>`/`<video>` with no transition at all. `@keyframes viewer-in` (`globals.css:438`) exists for this and is **referenced by nothing** | **gap: wire the existing animation** |
| 6 | avatar preview | **does not exist anywhere** — `grep -rn "AvatarPreview\|lightbox"` returns nothing. Tapping the 96px avatar in `profile-header.tsx:121` does nothing at all today | **gap: build it** |

Also verified: `like-pop` (`globals.css:348`) is a third defined-but-unused
animation, and `@media (prefers-reduced-motion: reduce)` at `globals.css:453`
already neutralises every animation globally, so none of this work needs new
accessibility plumbing.

**Conclusion:** the brief's list is mostly already satisfied; the honest work is
(a) the feed rhythm, which is genuinely absent, and (b) wiring three animations
that were written for this purpose and never connected, plus one small new
component (avatar preview).

---

## Decisions

**D1 — Interleave the body, don't rebuild the page.** One discovery card after
every third post, cycling the kinds. 10-post pages therefore carry at most three
cards. The rhythm is the fix; a redesign is not.

**D2 — `for-you` only.** Following is a promise: posts from people you follow,
chronological. Interleaving a "people you may know" card into it would break the
one tab whose contract is purity. The other three tabs are already topic-shaped.

**D3 — Real rows or nothing.** A kind with no data is skipped, not shortened,
not padded, not given a placeholder count. If all three are empty the feed is
exactly what it is today.

**D4 — One cached fetch per kind, shared with the rail.** The discovery hook uses
the app's `useQuery` (staleTime 5 min) so the same data costs one request per
session even when the rail and the stream both want it — and nothing on the
critical path waits for it. *This was aspirational when written: the rail still
had its own two fetches until F5 was fixed. It is now measured — 3 discovery
requests per view, one per kind — and the paint order is checked in the DOM
rather than assumed: the first post and the first card land in the same frame.*

**D5 — Avatar preview lives on the profile header avatar, not the feed avatar.**
In the feed, an avatar's job is navigation (it is a `<Link>` to the profile), and
adding a preview there would mean two competing tap targets on one image. On the
profile header the avatar is a plain `<img>` with **no handler at all** — a pure
addition with no conflict. On your own profile the camera button keeps doing what
it does; the preview is how you check that the canonical crop from Phase 2
actually looks the way you expect, at full size.

---

## Part 3 — What live verification changed

The audit above was written from reading code. Running it against a seeded
backend found five real defects and four ways the *test* was lying. Both lists
matter, so both are here — a harness that passes for the wrong reason is worth
less than no harness.

### Real defects found by running it

**F5 · Every phone load fetched the discovery data twice.**
"D4 — one cached fetch per kind" was written before the implementation existed,
and the implementation did not honour it: `right-rail.tsx` kept two `useEffect`s
of its own (`/users/suggested`, `/events?status=upcoming`) while the new
`useFeedDiscovery` hook fetched the same three endpoints. Measured on a 390×844
viewport: **5 discovery calls** per load. The rail now consumes the hook, so the
count is **3 — one per kind**, and the same request feeds both the cards and the
rail's lists. Two second-order fixes came with it:

* the logged-out events fetch guarded on `if (user) return;` — but `user` is
  `null` for the first render of *every* signed-in visit, so it fired and then
  threw the result away. One wasted request per load, invisible because the
  list it filled was not rendered.
* the rail's public list no longer carries `participantCount`, because that
  cost a second `POST /registration/responses/counts/batch` purely to decorate a
  card a signed-out visitor cannot act on. Signed-in users still see their own
  registered events with real counts.

**F6 · The profile's Follow button was not optimistic — the feed's was.**
`profile-screen.tsx` `toggleFollow()` awaited `api.post('/follow/:id')` *before*
`setFollowing(...)`, and the button carried `disabled={followBusy}` for the whole
round trip. Instrumented in the page: the label flipped at **+2038ms, six
milliseconds *after* the response landed at +2032ms**. The follow always worked;
the transition — the thing §20 asks for — did not exist, and the same action felt
different depending on whether you tapped it in the feed (optimistic pill) or on
a profile. Now optimistic with rollback, a single-flight guard so one tap is one
request, and `aria-busy` instead of a disabled flicker.

**F7 · The follow pill was 25px tall.** Measured at all six widths: `77×25`, the
same everywhere, i.e. not an overflow bug — just a thumb-sized control. Now
`77×36` (`h-9`), which stays compact in a three-row card while being a real
target. Apple's 44px ideal is not met by design here; inline pills in suggestion
rows ship at 32–36px in comparable apps, and 44 would make the card four rows
tall. This is a choice, not an oversight.

**F8 · The avatar's label lied when there is no photo.** `aria-label="View
profile photo"` was rendered for every member, including the many with no photo —
where the preview honestly shows the initials fallback. The label now says
`Profile photo, not added yet` in that case. The preview itself was correct; the
announcement was not.

### Ways the harness was wrong first

| Symptom | The lie | Fix |
|---|---|---|
| "the post is liked" failed while the server listed it as liked | `document.querySelector('article button[aria-label*="ike" i]')` reads the **first** article. The double-tap happened on the photo post, further down | `data-testid="post-media"` on the media grid and `data-post-id` on the article; every read is scoped to the article that owns the media |
| "double-tap plays the heart burst" failed only after the seed grew | two `touchscreen.tap`s at coordinates below the fold dispatch nothing at all | `scrollIntoViewIfNeeded()` before measuring |
| "the preview opens" failed for the account's own profile | the check required `[data-testid="avatar-preview-image"]`, but the fallback correctly renders initials | assert both shapes: photo → decoded `naturalWidth > 0`, no photo → initials and no broken image |
| "the label flips instantly" failed at random | it read the label in the same tick as the click. React commits discrete updates on its own schedule, so this measured luck, not optimism | instrument the page: record when the label changes and when the XHR resolves, and assert the **order** |
| only the `events` card was ever rendered | a ten-post feed has rhythm for two cards and the kind rotates, so the people row — the tightest layout on the screen — was never measured | seed 16 posts, and verify the rotation across a page load |

Also worth recording, because two fixtures made whole assertions vacuous:

* the seeded story was a **1×1 transparent PNG**. Every "the media loaded" check
  passed while the screen showed an empty square. The seed now writes real
  solid-colour PNGs (256×256 avatar, 600×400 post photo, 400×640 story) through
  the same uploads directory the backend serves.
* `/users/suggested` has **no generic fallback**: it ranks real signals only
  (mutuals, co-registration, shared institution), so a fresh seed where the QA
  user already follows everyone correctly returns `[]`. The seed now gives the
  ranker a real signal (a shared `profile.institution`) instead of the endpoint
  being "fixed". The stale comment in `right-rail.tsx` claiming a feed-authors
  fallback is corrected.

One thing this phase deliberately did **not** change: the feed's next page is an
explicit **"Load more posts"** button, not infinite scroll. The rhythm was
verified across that boundary (cards keep their ≥3-post spacing, no card ever
becomes adjacent, and the card index does not restart — no duplicate React keys).
Whether the feed should auto-load on scroll is a product decision, not a defect,
so it is recorded rather than silently changed.

---

## What "verified" will mean for this phase

* `phase4.js` drives a real browser against the seeded backend and asserts the
  cards that render are backed by rows the API returned (fetched independently in
  the same page), that **no two discovery cards are adjacent**, that Following
  has none, that the post stream still likes/saves/comments, that the story
  viewer swaps with the transition class present, that the avatar preview opens
  a real decoded image, and that `prefers-reduced-motion: reduce` collapses every
  one of these animations.
* `phase4-widths.js` re-runs 320/360/375/390/412/430 with the cards present —
  the new cards are the densest thing added to the mobile feed and the most
  likely source of overflow.
* The request budget: one discovery request per kind, none of them the
  `counts/batch` call, and — measured with a `MutationObserver` — the posts are on
  screen no later than the first card.
