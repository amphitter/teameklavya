# Phase 3 audit — profile hierarchy and the owner's own tabs

> **RESOLVED — see `docs/PHASE3_PROFILE_AND_LISTS.md`.** Everything below is the
> pre-change audit and is kept as the historical record of what was wrong. Four
> further defects were found only by running the rebuilt screen in a browser
> (archived posts still served at their permalink; the author check broken on
> populated posts; every upload 404ing because the static mount and the storage
> provider disagreed about their directory; and the owner tabs clipping off the
> right edge of every phone). Those are documented in the Phase 3 completion doc.

> Read before changing anything (§"DO NOT simply patch the existing UI").
> Every finding below was verified in the code, not assumed.

## What already exists and works

The backend for this phase is **already complete** — the audit's job was to
find out how much of it nothing can reach:

| Endpoint | State |
|---|---|
| `GET /api/posts/saved` | works, cursor-paginated, viewer-scoped |
| `GET /api/posts/liked` | works, cursor-paginated |
| `GET /api/posts/archived` | works, cursor-paginated, author-only |
| `POST /api/posts/:id/archive` | works, author-only, reversible |
| `GET /api/users/:id/posts` | works, page-paginated, excludes archived for everyone |

`Saved`, `Liked` and `Archived` are three separate homes by design
(`Save` documents / `Reaction` documents / `Post.archivedAt`) — the comment at
`post.controller.js:975` says so, and it holds.

## Findings

### A1 — Archive is unreachable. The API exists; no UI calls it.
`POST /posts/:id/archive` has **zero callers in the entire frontend**. So the
author can delete a post but cannot set it aside; §12's whole distinction —
archived ≠ deleted — was implemented and then never exposed. `FeedPost`'s menu
offers only Delete and Report.

### A2 — Liked and Archived have no page. Only `/saved` does.
The account menu links `/saved`; `/liked` and `/archived` do not exist as
routes. So even the endpoints that work are reachable only by typing a URL.

### A3 — The profile's Posts tab is a second-class grid, not the feed post.
`profile/[id]/page.tsx:384` renders `PostsGrid` — a static thumbnail grid with a
hover overlay. No like, no comment, no save, no share: the same content behaves
differently depending on which screen you are on, which the plan forbids
("no second-class profile-only post").

### A4 — Stats are five dashboard tiles.
`profile-header.tsx:166-193` renders a 3-then-5 grid of tile cards
(Events · Attended · Posts · Followers · Following). The brief asks for a
**compact social stat row (Posts · Followers · Following)**, and warns against
exactly this card-grid shape.

### A5 — The Media tab is not browseable.
It shows `posts.flatMap(p => p.images).slice(0, 12)` — the first twelve images of
the twenty-four posts that happen to be loaded, rendered as bare `<img>`s that
link nowhere and cannot be paged. Nothing indicates that more exist. There is no
media endpoint to do better.

### A6 — Tab counts do not match what the tabs show.
`label: \`Posts · ${posts.length}\`` — the count is however many posts the page
loaded (capped at 24), while the header shows the true total. On a profile with
40 posts the tab says "Posts · 24" and the header says "40": two numbers for one
thing, on one screen.

### A7 — The Posts stat counts archived posts; the Posts tab does not.
`user.controller.js:318` counts `{ author, status: "published" }` with **no
archived filter**, while `/users/:id/posts` filters `archivedAt: null`. Archive
something and the stat disagrees with the list underneath it. Same rule as A6.

### A8 — Archive ≠ saved ≠ liked is untested.
Nothing asserts that saving a post does not put it in Liked, that archiving does
not put it in Saved, or that a visitor cannot read any of the three. The
distinction is the point of §12 and has no regression cover.

## Decisions

1. **One list component, four consumers.** `components/feed/post-list.tsx`
   renders the feed's own `FeedPost` with pagination and removal, and serves the
   profile Posts tab, Saved, Liked and Archive. No second post component, no
   three copies of the same loading logic.
2. **Media gets a real endpoint** (`GET /api/users/:id/media`) rather than a
   client-side approximation of a truncated list — §41: implement the smallest
   necessary API, never silently mock.
3. **A count appears only when it is the whole truth.** The tab label shows a
   number only once the collection is fully loaded, so it can never contradict
   what the tab contains. The Posts *stat* is fixed to exclude archived posts,
   so it agrees with the tab (A7).
4. **Owner-only tabs**: Saved / Liked / Archive render only when the profile is
   your own, and the endpoints behind them are `requireAuth` + viewer-scoped, so
   hiding the tab is convenience and never the protection.
5. **The stat row stays event-first.** Posts · Followers · Following inline, plus
   a real events line (attended/created) when the numbers are non-zero — the
   tile grid goes, the event identity does not.
