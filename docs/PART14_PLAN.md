# PART 14 — plan (mobile-only feed + navigation + composer toolbar)

Audit verdict per requirement, then the work. Desktop is guarded everywhere.

## Audit (what is actually there today)

| § | Requirement | State before |
| --- | --- | --- |
| 1 | top bar: Explore left · logo centre · bell + profile right | logo centre + bell only |
| 2 | Explore opens EVENT discovery | `/explore` already IS it (For you / Trending / Live now + categories). Needs the entry point only |
| 3 | Search opens trending visually | `/search` showed "Type at least 2 characters" |
| 4 | bottom nav Explore → Search | bottom nav had Explore → `/events` |
| 5 | trending grid, image-first, real content | no trending endpoint for posts |
| 6 | tap post → viewer sheet (scroll preserved); tap event → details | no post viewer on search |
| 7 | search input, switch to results on typing | input existed |
| 8 | filters All / Events / People | had Events / People / Communities / Posts |
| 9 | remove filters, feed search bar, greeting, hero from MOBILE feed | all four present on mobile |
| 11–14 | composer toolbar clipped | **real bug**: `pl-[52px]` + a row wider than the card |
| 19–20 | one width system, 320–430 | feed `px-3`, composer `p-4`, toolbar `pl-[52px]` |
| 21 | + from anywhere → global composer | delivered in Part 13 — verify |
| 23–25 | seen / liked / dismissed persistence + batching + pagination | **not implemented at all** |

## Work

**A · Navigation (mobile only)**
`feed-top-bar.tsx`: left Explore → `/explore`, centre logo, right bell + account menu.
`app-shell.tsx` bottom nav: Explore → **Search** (`/search`), keep Home / + / Messages / Profile.
Desktop sidebar unchanged (`MAIN_NAV` still Explore + Events).

**B · Mobile feed cleanup**
Wrap greeting, phone search bar and the filter strip in `hidden lg:*`-scoped markup so the
mobile feed is: header → stories → What's happening → posts. Desktop untouched.

**C · Toolbar fix (the reported bug)**
- drop `pl-[52px]` on phones (that indentation is the "unnecessary left margin" in the brief);
- one flex row, `min-w-0`, `shrink-0` on the Post button, `flex-wrap` off, gap tuned;
- targets stay ≥40px; secondary actions (attach event, video, poll) move behind a "More"
  sheet **below sm only** — inline from `sm` up, so desktop is identical;
- measure 320/360/375/390/412/430 and assert no clipping/overflow.

**D · Search = trending**
New `GET /api/discover/trending` returning real posts (with images, ranked by engagement)
and real upcoming events, using the feed's own projections so `FeedPost` renders them.
`/search`: trending collage when empty; All / Events / People when typing; tapping a post
opens a **sheet containing the existing `FeedPost`** (like / double-tap / comment / save /
share / profile / event all come with it), so scroll position is preserved.

**E · Seen / liked / dismissed (backend, persistent)**
`PostImpression` model `{ user, post, kind: seen|dismissed, at }`, unique per (user, post, kind).
`POST /api/posts/impressions` — batched, one bulkWrite, capped.
`POST /api/posts/:id/dismiss` — explicit "not interested".
`getFeed` excludes liked + dismissed outright and demotes seen posts (they return only when
the eligible pool runs out — §23 "must not **unnecessarily** return" + §25 "do not return
partially empty pages").
Client: `IntersectionObserver`, ≥50% visible for ≥1.2s, batched every ~10s / on hide.

**F · QA** at 320–430 + regression suites + report.
