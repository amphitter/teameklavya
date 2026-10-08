# PART 14 — Final mobile feed, navigation and composer toolbar

Scope: **mobile only**. Desktop is not redesigned, the feed is not rewritten, no dependency was
added, no fake content or fake trending source exists anywhere in this round.

Everything below was measured in a browser at **320 / 360 / 375 / 390 / 412 / 430** (phases) and
**1440** (desktop), against the seeded QA backend, on the production build.

---

## 1 · Mobile feed cleanup (§9–§10)

Removed from the **phone** feed, not from the product:

| Removed on phones | Where it still lives |
| --- | --- |
| `Good afternoon, Ana` greeting + live badge | desktop feed, unchanged |
| phone search field | Search is a destination now (`/search`), plus the desktop top-bar field |
| `For You / Following / Events / Communities` strip | desktop feed, unchanged (still 4 filters, still ≥44px) |
| the vertical gap they left behind | nothing — the column closes up |

Result on a 390px screen: **top bar → stories → What's happening? → posts**. The first post card now
starts **368px** below the top bar at 320px and **~425px** at 390px (measured), where the old layout
put it below the fold. `feed-view.tsx` hides them with `hidden lg:block` / `hidden lg:flex` rather
than unmounting, so the desktop tree — and its state — is byte-for-byte what it was (§26).

## 2 · Top navigation change (§1–§3)

`components/feed/feed-top-bar.tsx`, mounted once in `app/(app)/page.tsx` (a direct child of the
shell's content column, so `sticky top-0` sticks to the real scroll edge).

```
[ Explore ]              EventHub                [ 🔔 ]
```

* Explore (left) → `/explore` — event discovery only.
* The logo is **absolutely centred on the bar**, because flex-centring inside the leftover space put
  it 22px left of true centre at 320px. Measured centre error at all six widths: ≤3px.
* Right: the real `NotificationBell` (unread badge, dropdown), sitting in the corner.
* **The profile avatar was removed from this bar on the product owner's request.** Nothing became
  unreachable: the bottom nav's Profile item is wrapped in the same account menu, so profile, theme,
  settings and log out are still one tap away, one row lower. The harness now asserts both halves of
  that trade — no avatar in the bar, account menu reachable from the bottom nav — at all six widths.
* The bar exists on the feed only; from `lg` up it renders nothing.

> Fixed during verification: the bar had been left mounted **twice** (route + `feed-view`), which put
> two bars and two bells on screen. Caught by `feed-topbar.js` ("the feed has exactly one top bar"),
> removed the duplicate, harness green at 125/0.

## 3 · Bottom navigation (§4, §29)

`Home · Search · + · Messages · Profile` — the `Explore` item is **gone** from the bottom row, and no
bottom-nav item points at `/explore` (asserted). Search opens `/search`; from `lg` up the bottom row
is hidden as before.

## 4 · Explore / event flow (§4, §29)

`/explore` was already event-only discovery (trending / upcoming / categories / event cards) — the
audit found nothing to rebuild, so only the entry point changed. Verified: the top bar's Explore lands
on `/explore`, which lists real `a[href^="/events/"]` cards and contains **no search input**, and
`/search` contains **no event-discovery cards**. The two surfaces never merge.

## 5 · Trending / search flow (§5–§8)

`app/(app)/search/page.tsx` + new `components/search/trending-grid.tsx`.

* **Empty query is no longer empty.** `Type at least 2 characters` and `SuggestedPeople`-as-landing are
  gone from the default tab; Search opens on **Trending**: a 2-column (3 from `sm`) square-tile collage
  of **real** posts and **real** events. `POST` / `EVENT` badges, one clamp-1 caption line under an
  image, no text walls.
* **Filters: `All · Events · People`** — three pills that fit 320px without scrolling. Communities and
  Posts are not lost: they appear inside **All**, which is the server's own `type=all` group set.
  Old `?tab=posts` / `?tab=communities` links resolve to All instead of an empty panel.
* **Post viewer (§6)** = new `components/search/post-viewer-sheet.tsx`: a bottom sheet that renders the
  **feed's own `FeedPost`**, so like · double-tap like · comment · save · share · open profile · open
  event are the same code, not a second viewer. Grid taps pass a full post; result rows pass an id and
  the sheet hydrates via `GET /posts/:id`, so like/save state is the server's answer rather than a
  guess from the search projection. Closing the sheet does not navigate, so **the scroll position is
  preserved** (asserted: `scrollY` before/after within 40px).
* Event tiles link to the existing `/events/[slug]` details page, where the existing registration flow
  takes over.
* Input placeholder is exactly `Search people, events, posts…`; typing filters through All/Events/People
  and a no-match query gets a real message, never a blank page.

**New backend endpoint used here:** `GET /api/posts/trending?limit=24` — 300 recent public posts ranked
by real engagement (likes×2 + comments) over 30 days, image-first, hydrated through the existing
`PostRepository.hydratePostsForViewer`, so every result is shaped exactly like a feed post.

## 6 · Composer toolbar alignment fix (§11–§19)

**The actual cause**, measured at 390px before the change: the card's content box is **326px**, the row
carried `pl-[52px]` (an indent borrowed from the avatar column above it) and then held a 3-button
visibility control, tag, photo, attach-event, two placeholders and Post — **~300px of controls plus
gaps in a 274px space**. The row could not shrink, so its last child (Post) was pushed outside the
card, and at 320px the visibility control itself was cut to a sliver. Nothing wrapped, nothing
scrolled — it simply overflowed. `overflow-x: hidden` was **not** used (§14).

Fixed at the source in `components/feed/create-post.tsx`:

* the 52px indent is gone on phones — the row starts at the card's content edge, which is what §19
  asks for anyway;
* one `flex-wrap` row with `gap-x-1`, `min-w-0` behaviour and `shrink-0` on Post;
* visibility segments are icon-only and 28px wide below `sm` (36px tall); tag / photo / More are 36×36;
* the `Send` glyph inside Post is hidden below `sm` (19px of a 262px budget) so the single line fits;
* **attach event / video / poll move into a "More" menu below `sm` only** (§16) — nothing is dropped,
  and from `sm` up they are inline exactly as before, so the desktop composer is unchanged.

Measured after the fix, at every QC width: every control inside the card's padding, Post's right edge
**exactly** on the toolbar's right edge (gap 0px), no control over 44px tall, no squashed control,
`scrollWidth == innerWidth`, one visual line from 320px up. `Labels`/admin actions return at `sm`.

**Known, documented edge:** at ≤325px only, *while a publish is in flight*, the wider `Posting…` label
pushes Post onto its own right-aligned second line for the ~1s of the request. The idle toolbar — the
state a user actually looks at — is a single clean line at 320px, and nothing is ever clipped.

## 7 · Seen / liked / dismissed persistence (§23–§25)

Server-side, in the database — not frontend state.

* `backend/models/post-impression.model.js` — `(user, post, kind)`, kinds `seen | dismissed`, unique
  index, `count`/`at`/`lastAt`, **partial TTL on `seen` only** (30 days, `POST_SEEN_TTL_DAYS`).
* `backend/services/feed-impressions.service.js` — loads `{liked, dismissed, seen}` in one pass;
  `recordImpressions` is a **single `bulkWrite` upsert**; `EXCLUSION_WINDOW` 400, `MAX_BATCH` 60.
* For You: liked + dismissed are **hard exclusions**; seen posts are **demoted** by `SEEN_PENALTY`
  (30 days in ms > the largest 72h source weight), so new-to-me content always wins while the pool
  stays full. Following (chronological) excludes liked + dismissed only — a time-ordered tab must not
  silently skip posts.
* `POST /api/posts/impressions` (batched, always 200, cap 60, junk ids ignored),
  `POST /api/posts/:id/dismiss` → "Not interested" in the post menu (idempotent, reversible).
* Client: `components/feed/use-seen-impression.ts`. A card is seen only if **≥50% visible for ≥1.2s,
  in a visible tab, signed in, and not your own post**; the queue flushes **once per ~4s** (one request
  for many posts, never one per scroll event), plus a `keepalive` flush on `pagehide`.

Verified end-to-end: liking a post removes it from For You and it survives a refresh; "Not interested"
removes it instantly and it is still gone after reload **and** absent from the API itself; recorded
impressions demote (not delete) posts, the page stays full (≥8 of 12); a scroll burst produced
**1 impression request** for many posts; another viewer is unaffected by either.

## 8 · Files changed

**Backend (new):** `models/post-impression.model.js` · `services/feed-impressions.service.js` ·
`tests/part14-feed-impressions.js`
**Backend (edited):** `controllers/post.controller.js` (exclusions, seen penalty, `recordImpressions`,
`toggleDismiss`, `getTrendingPosts`) · `routes/post.routes.js` (`GET /trending`, `POST /impressions`,
`POST /:id/dismiss`, all above `GET /:id`)
**Frontend (new):** `components/shell/account-menu.tsx` (shared `AccountMenu` + `AccountAvatar`) ·
`components/feed/feed-top-bar.tsx` · `components/feed/use-seen-impression.ts` ·
`components/search/trending-grid.tsx` · `components/search/post-viewer-sheet.tsx`
**Frontend (edited, follow-up):** `components/feed/feed-top-bar.tsx` — the profile avatar was
removed from the phone top bar on request; the bell is now the right-hand control, and the account
menu is reached from the bottom nav's Profile item.
**Frontend (edited):** `app/(app)/page.tsx` (mounts the bar once) · `app/(app)/search/page.tsx` ·
`components/feed/feed-view.tsx` · `components/feed/create-post.tsx` · `components/feed/feed-post.tsx`
(impressions + "Not interested") · `components/shell/app-shell.tsx` (shared account menu, Search slot)
**QA:** `docs/mobile-qa/part14.js` (new, 302 checks) + Part 14 updates inside
`part9.js`, `ui-fixes.js`, `feed-topbar.js`, `phase4.js`.

## 9 · Mobile widths tested

320 · 360 · 375 · 390 · 412 · 430, plus 640 (the `sm` boundary where labels/admin actions return) and
1440 for desktop. Checks run at every width: top bar geometry, bottom-nav labels/targets, page
overflow, every toolbar control inside the card, Post aligned and never clipped, no page errors.

## 10 · Desktop unchanged (§26)

Asserted explicitly in `part14.js` §G at 1440×900: greeting present, filter strip present with all four
filters, desktop search field present, phone top bar **not rendered**, phone bottom nav **not
rendered**, sidebar Explore present, feed column still offset by the sidebar, the phone-only "More"
control absent, Post still right-aligned. `phase3/4 (+widths)`, `part9`, `part13`, `ui-fixes`,
`feed-topbar`, `sweep` and the backend suites all pass.

## 11 · Mobile login / signup screens (follow-up)

Two changes on the auth screens, both requested directly:

1. **The mobile hero is the supplied campaign poster** ("Events · People · Progress"),
   `public/brand/auth-mobile-poster.webp` (720×1080 WebP, 213 KB — down from the 2.2 MB PNG master;
   the artwork keeps its own alpha, so it floats on the page's pale gradient rather than sitting in a
   black box). It replaces the old portrait `auth-mobile.webp` on **login and signup**, since both
   routes render the shared `AuthSplit`. It is bound by height (`max-h-[40vh]`), which is what keeps
   both choice buttons above the fold even at 320×568, and it disappears the moment the email form
   opens — the form then owns the screen. Desktop is untouched: it still uses `auth-hero.webp`.
2. **The EventHub lockup that sat directly above the Google button was removed** from the mobile choice
   card. The screen is still branded twice — the header's logo (top-left) and the poster itself — so
   nothing is lost.

One pre-existing bug surfaced while checking this at 320px and was fixed: the header's logo was being
flex-shrunk below its intrinsic width, so the wordmark spilled **11px** under "Create an account".
The logo is now `shrink-0` and the link wraps instead.

### Follow-up 2 — no plate behind the art, and the dead band is gone

* **"remove bg effect"** — the poster no longer sits in a box we drew: `rounded-xl` and the drop
  shadow are gone. The artwork's own alpha is what separates it from the page, exactly like the
  desktop hero. Verified: computed `box-shadow: none`, `border-radius: 0px`.
* **"reduce the extra bottom margin"** — measured, the gap *inside* the card was already just the
  normal 24px; the real dead space was **below** the card, because the page is `min-h-screen` and its
  content simply sat at the top of it. On a 390×844 phone that was **185px of empty page** under the
  card. The shell is now a column flex (`flex-1` main) and the content block uses **`my-auto`** —
  auto margins, not `justify-center`, so on a 320×568 phone (content taller than the viewport) it
  collapses to zero and the page still starts at the top and scrolls rather than being clipped at both
  ends. Residual band: **87px at 390** (63 above / 87 below — centred, not dumped at the bottom),
  **30px at 360**, **0 at 320**. `lg:my-0` keeps desktop's composition untouched (verified: hero at
  y=95 and card 485×500 at 1280/1440/1920, identical to before).
* The poster also grew from `40vh` to `44vh` so the composition fills the phone instead of leaving a
  gap between the art and the card. At 320×568 both buttons are still well above the fold
  (Google ends 434, mail 494, of 568).

New harness `docs/mobile-qa/check-auth.js` — **132 checks** over login + signup at all six widths: the
poster loads from the new path, no plate/shadow/rounding behind it, no horizontal overflow, the header
logo and link never collide, **no mark directly above the Google button**, the Google button stays
above the fold, leftover height balanced above/below (≤24px skew) with ≤130px below, no page errors.

---

## Gate results (this round)

| Suite | Result |
| --- | --- |
| `part14.js` (new, phone + desktop + search + toolbar + persistence) | **320 passed, 0 failed** |
| `part9.js` (Part 9 acceptance, restated for §9) | **100 / 100** |
| `part13.js` (one composer, sharing, people search) | **98 / 98** |
| `ui-fixes.js` | **167 / 0** |
| `feed-topbar.js` | **131 / 0** |
| `phase3.js` / `phase3-widths.js` | **57 / 0** · **0 failures × 6 widths** |
| `phase4.js` / `phase4-widths.js` | **50 / 0** · **120 / 0** |
| `sweep.js` (15 routes × 320/390) | **0 overflowing elements** |
| backend `part14-feed-impressions` | **30 / 0** |
| backend `part9-stories` · `part13-social` | 42 / 0 · 40 / 0 |
| backend `part10-messages` · `part10-realtime` | 59 / 0 · 38 / 0 |
| backend `part11-profile-content` · `profile-edit` · `stories-audience` | 60 / 0 · 53 / 0 · 10 / 0 |
| frontend unit: query · messages-store · crop · variants | 17 / 0 · 38 / 0 · 26 / 0 · 15 / 0 |
| `check-auth.js` (new — login + signup, 6 widths) | **132 passed, 0 failed** |
| `tsc --noEmit` · `next build` | 0 errors · clean |

## Harnesses updated because Part 14 **supersedes** what they asserted

These were not broken by the change — they encoded the *previous* design, so the assertions were
restated to the new one instead of being deleted:

* `ui-fixes.js` — "all four tabs render" on a phone → now asserts the strip is **absent** on phones and
  still present/44px on desktop; the bottom-nav check → `Home, Search, Messages and Profile` plus a new
  check that **Explore is reachable from the top bar**.
* `feed-topbar.js` — "bell in the right corner" → the bell is the control at the **far right** (the
  account avatar was removed from the bar), plus an assertion that the account menu is still one tap
  away in the bottom nav; added "exactly one bar / one bell".
* `part9.js` — the filter checks now run at desktop width (where the strip lives) and a new assertion
  covers its absence on phones; section A now **creates the own-story fixture** when it is missing
  instead of silently depending on a previous run of itself.
* `phase4.js` — "Following is still just the people you follow" moved to a desktop page, because the
  tab strip it clicks only exists there now.

## Remaining issues / honest limits

1. At **≤325px, while posting**, the `Posting…` label wraps Post to its own right-aligned line for the
   duration of the request (see §6). Idle layout at 320px is one line.
2. Trending tiles without any image render as a pastel text tile. That is the honest representation of
   a text-only post — no stock imagery is invented to fill the grid (§41).
3. `seen` state is written by the client observer *and* by the batched endpoint; there is no server-side
   "did the user really look" signal beyond the 50%/1.2s rule, and no per-post view counter is exposed
   to users (deliberate — no fake metrics, §32/§72).
4. Trending ordering is engagement × recency only. No personalisation, no geo, no follower-graph
   weighting — the brief forbids inventing a ranking system beyond real signals.
5. `/search`'s Communities/Posts groups are rendered inside **All** only; the brief lists three filters
   and there is no separate chip for them by design.
