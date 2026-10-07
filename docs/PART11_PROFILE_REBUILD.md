# Part 11 — Profile System Rebuild + Messages polish

Two asks, one plan:

1. The profile rebuild brief (save bug, crop, cross-device consistency, live feel).
2. "message wale section me right side me kaafi faltu gap hai + message likhne wale
   section me scroll bar hai" — the messages screen has a wide dead band on the
   right and an inner scrollbar in the composer.

**I audited before touching anything.** What the audit actually found (as opposed
to what the brief assumed) is in `docs/PART11_PROFILE_AUDIT.md`. The short
version: the save flow was not the problem the brief suspected, and the thing
blocking the whole feature turned out to be a paint-order bug that made the
**Edit profile button unclickable**.

---

## Phase 1 — "Click Save, it saves. Click Edit, it opens."

No redesign. Only things that are objectively broken, each with a live repro.

| # | Fix | Why |
|---|-----|-----|
| 1 | Cover no longer paints over the header content | The cover strip is `position: relative`; the content block that overlaps it with `-mt-12` is static, so the cover painted **on top** — the name, `@username` and the Edit button were underneath it and `elementFromPoint` returned the cover. The profile edit feature was unreachable by mouse, on every screen size |
| 2 | Any 2xx = success; a cancelled request is not an error | The sheet treated a `undefined` result as failure. `useMutation` also swallowed every error, so a real 422 and a user-cancelled request were indistinguishable |
| 3 | One click → one PUT | In-flight guard, so a double click cannot fire two saves |
| 4 | Username availability: no request when unchanged, no request for invalid input, cached while you retype | Plus a server-side short-circuit that answers "same as mine" without a database round trip |
| 5 | Trace the 500 | Found and fixed: `/users/:idOrUsername/achievements` called `findById` on a username. It is the profile page's own request, which is why the console showed a 500 next to a successful save |
| 6 | Messages: dead band on the right | `max-w-5xl` (1024px) inside a 1200px column left an 88px empty band on each side at 1440 |
| 7 | Messages: composer scrollbar | The growing `textarea` kept `overflow-y: auto`, so past its cap it drew an inner scrollbar gutter inside the pill |

## Phase 2 — Crop and canonical avatar

> **Status: DONE — verified live and in unit tests.** See `docs/PHASE2_AVATAR_CANONICAL.md` for what shipped, the nine defects it found and fixed, and the evidence.

The root of "nose on one device, whole face on another": the stored image is
whatever the user uploaded and every surface crops it independently.

* Square 1:1 crop editor — zoom, pan, pinch, `touch-action: none` on the canvas
  so the page never scrolls mid-gesture, circular preview, Cancel / Use Photo.
* The crop is rendered to a **canonical square** (512²) at upload time and that
  one file is what the server stores. Every surface then shows the same image.
* Variants (`sm`/`md`/`lg`) generated from that canonical file — same
  composition, different resolution — never a re-crop of the original.
* `avatarVersion` on the user record drives `?v=` cache-busting, so a new avatar
  is never served stale from the CDN, and the version only changes when the
  asset does.
* Cover gets its own crop flow with a stored focal point (the existing
  `coverPosition` becomes a real control rather than a hidden number).
* Legacy avatars with no canonical crop get a re-crop prompt.
* Server-side validation: MIME, extension, size, real decoded dimensions
  (never trusting the client), metadata stripped, no base64 in Mongo.

## Phase 3 — Profile rebuild

* New header: cover, overlapping avatar with a camera affordance, name/handle,
  bio, then a **compact social stat row** (Posts · Followers · Following) —
  not five dashboard tiles.
* Tabs: Posts / Events / Media / Achievements, plus **Saved / Liked / Archive
  for your own profile only**.
* Profile posts use the **feed's** post component, so likes, comments, saves
  and shares behave identically. No second-class profile-only post.
* Media tab is a real browseable grid; tab counts only appear where the count
  matches what the tab actually shows.
* Density and hierarchy pass on both breakpoints — less empty chrome, more
  content, without becoming cramped.

## Phase 4 — Where the "static/dull" feeling actually comes from

* Feed audit for the same flatness: content-first ordering (stories, posts,
  event activity, people, communities), real data only.
* Micro-interactions: like scale + double-tap, save confirmation, instant
  follow transition, smooth comment open, story transition, avatar preview.
  Short, GPU-friendly, none of it decorative.

## Phase 5 — Verification and report

* Every box in the §33 acceptance list, run against a real backend — including
  six widths (320/360/375/390/412/430) with zero horizontal overflow, and the
  cross-surface avatar check: profile, feed, comments, messages, notifications.
* The §34 report, answering all fourteen points from measurement.

---

## Standing rules this work inherits

No fake engagement numbers · no invented identities · real backend data only ·
DESIGN.md palette, gradients reserved for CTAs and milestones · no
glassmorphism/blob/neon · animations short and purposeful · mobile is designed,
not a stack of desktop cards · "team" not "group" · do not redecorate the rest
of EventHub while doing this.
