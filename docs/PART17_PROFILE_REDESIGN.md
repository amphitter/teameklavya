# Part 17 — Profile page visual redesign

**Scope:** the EventHub profile page, rebuilt against the supplied reference image:
hierarchy, spacing, proportions, banner/avatar relationship and responsiveness — on the real
backend data, with the existing edit, follow, post and media machinery untouched.

**Status:** implemented on top of `3abf904` (§D messaging), verified against the running app.

---

## 1 · The one rule (§34), and why the old layout broke it

The brief's critical instruction is that the banner must stay visually clean and the identity
must live *below* it. The previous build pulled the **whole header block** — avatar *and*
name — up over the banner with `-mt-12`, then laid the two side by side. Everything a reader
reads (name, `@handle`, metadata, buttons) was therefore drawn on the photo, and because the
forward half of that row was `shrink-0` it could not wrap: on a laptop the row's min-content
width exceeded the card and the card's `overflow-hidden` **clipped the buttons over the text**.

The redesign inverts the ownership of that offset:

```
BANNER
  ↓
AVATAR    ← the ONLY thing that crosses the banner's lower edge (half its height)
  ↓
IDENTITY · METADATA · BIO · TAGS · STATS · ACTIONS   ← all below the banner, in their own box
```

Concretely: the overlap now exists as a negative margin on **one** element (the avatar's
ring, `-mt-10` / `sm:-mt-12`) instead of on a container that also holds the text. The grid
row's flow height is the avatar's *lower half*, so the identity simply flows after it — there
is no shared box in which text and photo can collide, and no `z-index` stack to maintain
beyond the single avatar that must paint above the cover.

`z-index` note, because the brief bans gratuitous stacking hacks: the cover is
`position: relative` (it holds the image and the owner's "Edit cover" shortcut), so it paints
in the positioned layer above plain in-flow content. The avatar is the one element that must
cross that edge, so it — and nothing else — carries `relative z-10`. That is the narrowest
possible use of the technique, and it is commented as load-bearing in the source.

---

## 2 · Requirement by requirement

### §1 — "BTech · 2nd Year" removed

The header's chip row (`p.course`, `p.year`) is gone. Academic year is **not** displayed
anywhere in the profile header, and the metadata row now carries only what identifies or
affiliates a person: `📍 location · 🎓 institution · 🔗 website · 📅 Joined <month year>`.

The fields are still editable in the profile sheet (`PUT /me/profile` accepts `course` and
`year`, exactly as before) — they are simply no longer part of the header. The harness proves
this is a real removal rather than an empty profile: it **writes** `course: "BTech"`,
`year: "2nd Year"` through the public API, loads the profile, asserts the header contains
neither string, then restores the user's previous values.

### §2–§6 — Structure

* **Banner** (§3): one clean image, rounded top corners from the card, a natural crop, no
  overlay, no scrim, no glass. Height `h-32` → `sm:h-40` → `lg:h-48`, i.e. 128/160/192px: a
  wide strip that never dominates the card. Accounts with no banner fall back to a two-stop
  `blue → purple` gradient, with no copy on top of it.
* **Avatar** (§4): tall enough to overlap (`!h-20` / `sm:!h-24`) with a ring that wraps the
  whole photo, positioned so the overlap is ~half its height at every width — the harness
  asserts the overlap is between 25% and 65% of the avatar, so "the photo is the thing that
  crosses, not the whole block" is measured, not asserted by eye.
* **Grid** (§6): `grid-cols-[auto_minmax(0,1fr)]` on phones and
  `sm:grid-cols-[auto_minmax(0,1fr)_auto]` from 640px — avatar | identity | actions. The
  identity column is `minmax(0,1fr)` so a long name shrinks the column instead of widening
  the grid; `col-start`/`col-end`/`row-start` pairs are written explicitly (mixing
  `col-span-2` with a breakpoint override leaves `grid-column-end: span 2` in place, which is
  what produced a real span-into-the-actions bug during development).

### §7–§13 — Identity stack

Name (`text-[22px]` → `sm:text-[28px]`, wrapping naturally), verified badge beside it,
`@username` below in muted type, then metadata, then the real bio, then the user's interest
tags. Each block only renders when there is data — no placeholder bio, no invented tags. The
metadata wraps (`break-words`, never `truncate`) so nothing is clipped at 320px.

### §10 — Actions

Own profile: **Edit profile · ⋯**; another user: **Following · Message · ⋯**. The actions are
rendered into whichever region applies — the third grid column from `sm` up (right-aligned,
line-up with the name via matching top padding) and their own row under the handle on phones
(§22's order) — and the unused region is `display: none`, so exactly one copy is ever on
screen. They may wrap internally; they can never reach the name, handle, metadata, bio, or
tags.

### §14–§15 — Stats

Five real numbers in one row: `Posts · Followers · Following · Events Attended/Hosted`, with
the reference's short spellings (`Attended`, `Hosted`) on phones and full labels from `sm`.
No tiles, no gauges, no icons — number above label, separated by hairlines from `sm`. Every
value comes from `GET /users/:id/profile → stats`; the harness compares the five on-screen
numbers against that payload so the reference's illustrative figures can never leak in.

### §16–§17 — Tabs

The same seven tabs (Posts · Events · Media · Achievements · Saved · Liked · Archive), with
the active one carrying the blue→purple treatment and the inactive ones a plain surface and a
subtle border. On phones the strip is **one row that scrolls horizontally by itself** — the
page never scrolls sideways, no label is shrunk, and no tab is dropped. History worth
recording: bare wrapping gave a ragged 4 + 3 + 1 block; a fixed 3-column grid fixed the
raggedness but cost three rows; the reference's answer is the scrollable strip, which is what
Part 17 §17 asks for and what ui-fixes now asserts (labels unclipped, page overflow zero,
off-screen tabs reachable inside the strip's own scroller).

### §18–§19 — Posts and the empty state

The Posts tab reuses the **feed's** card (`article[data-post-id]`, same like / comment / share
/ menu affordances) — there is no profile-only post UI. A profile with no posts shows the
compact panel: an inline icon with "No posts yet." and one line of explanation, measured at
~130px rather than the old full-height dashed box. (The compact variant is opt-in; every other
`EmptyState` in the app keeps its original proportions.)

### §20–§21 — Sidebar and top bar

Untouched. The redesign is the profile page; the shell's navigation, search, create button and
account menu are exactly as they were.

### §22–§23 — Mobile

The same component, re-flowed rather than squeezed: banner → avatar overlap → name → handle →
actions → metadata → bio → tags → stats → tabs → posts. The identity is never beside the
avatar in the overlap band on a phone; it begins under the photo.

### §24–§26 — Breakpoints, width, card

Asserted at 320, 360, 375, 390, 412, 430, 768, 820, 1024, 1280, 1366, 1440 and 1920, on both
the owner's profile and another user's: no text/action intersects the banner, no collision
between the actions and the identity, the avatar overlaps the banner but not the name, and
`documentElement.scrollWidth === clientWidth`. The card keeps a comfortable measure (≤~900px)
centred in its column with even margins, a light surface, a 1px border and a small shadow.

### §29–§30 — Edit

Three ways into the same sheet: **Edit profile**, the banner's **Edit cover**, and the avatar's
camera chip. Every field the brief names is still there (photo, banner, display name,
username, bio, location, website, skills/interests), and course/year are not required to save.
The avatar and banner keep their existing deterministic crops and stored focal point, so the
framing is identical on every device.

Two small fixes came out of building this:

* the edit sheet was the **only overlay in the app without an Escape exit** (search, comments,
  stories and the create composer all have one). It now closes on Escape through its existing
  `requestClose`, so unsaved edits still prompt.
* the sheet is a plain `role="dialog"` div, so nothing was regressed by keeping it that way —
  the harness drives it the way a keyboard user would.

### §31–§32 — Save and live updates

No change was needed and none was made: `PUT /me/profile` already treats 2xx as success, sends
one request per click and treats cancellations as silent (asserted by the Part 16 C harness,
which still passes 56/0). The profile reflects a change on the next load through the app's own
cache invalidation; the harness writes a value through the API and reads it back on the
profile.

---

## 3 · Evidence

Live app: QA backend on `:5999`, `next start` on `:3000`, seeded fresh (`qa-mobile-server.js`).

| Harness | Result |
|---|---|
| `docs/mobile-qa/check-part17.js` | **220 passed, 0 failed** — §1 removal (falsifiable), §3–§9 banner/avatar/identity geometry at 13 widths × own & peer profiles, §10 actions, §14–§15 stats vs API, §16–§17 tabs, §18–§19 posts + empty state, §25–§26 card, §29 edit entry points, §6 long-name stability, §32 live update |
| `docs/mobile-qa/check-part16-profile.js` | **56 passed, 0 failed** (assertion corrected: measure the *visible* edit affordance, and count that exactly one is on screen) |
| `docs/mobile-qa/check-part16-messaging.js` | **106 passed, 0 failed** (assertion corrected: the Message button is looked up as `:visible`, since the profile now renders the actions in two regions and only one is on screen) |
| `docs/mobile-qa/ui-fixes.js` | **179 checks, 0 failures** (12 of them new: off-screen tabs must be reachable inside the strip's own scroller, labels unclipped, page overflow zero) |
| `docs/mobile-qa/check-part16.js` | 163 passed, 0 failed |
| `docs/mobile-qa/check-part16-avatar.js` | 23 passed, 0 failed |
| `docs/mobile-qa/check-identity.js` | 23 avatar renders, 0 leaks |
| `docs/mobile-qa/check-messages.js` | 130 passed, 0 failed |
| `docs/mobile-qa/check-part15.js` | 218 passed, 0 failed |
| `docs/mobile-qa/part9.js` | 98/98 |
| `docs/mobile-qa/part14.js` | 320 passed, 0 failed |
| frontend units | 26 / 15 / 38 / 17, 0 failed |
| backend `part16-old-feed` · `part10-messages` · `part10-realtime` · `part14-feed-impressions` | 28 / 59 / 38 / 30, 0 failed |
| `tsc --noEmit` + `next build` | clean |

Screenshots (`/home/user/qa/part17/`): `p17-own-{320,390,768,1024,1366,1920}.png`,
`p17-peer-1366.png`, `p17-posts-390.png`, `p17-longname-320.png`.

---

## 4 · §35 acceptance checklist

| Criterion | Where it is proven |
|---|---|
| BTech • 2nd Year removed | check-part17 §B — set via API, asserted absent, restored |
| Academic year not in the header | same block; the sheet still edits it |
| Banner visually clean | no overlay text; only the owner's Edit cover chip |
| Avatar overlaps the banner correctly | overlap between 25% and 65% of the avatar, 13 widths |
| Name / username / metadata / bio / tags below identity | hierarchy assertion, 13 widths × 2 profiles |
| Actions never overlap text | rectangle intersection, 13 widths; one visible copy |
| Stats clean, real numbers | five cells vs `GET /users/:id/profile` |
| Tabs match reference | active gradient, bordered inactive, 7 tabs, 1 row on phones |
| Posts match reference | feed's own card + its actions |
| Mobile layout matches hierarchy | §22 order asserted at all six phone widths |
| Desktop layout matches hierarchy | actions in their own column from `sm`, peer + owner |
| No horizontal overflow | `scrollWidth === clientWidth` at every width |
| No text / avatar / banner collision | intersection checks; avatar crosses, nothing else does |
| Real backend data only | stats vs API; bio/tags/location rendered from the profile |
| Existing profile + post functionality preserved | Part 16 C harness, messages, parts 9/14/15 all green |
| Profile save works | Part 16 C §31 block (2xx = success, one PUT, silent cancels) |
| Avatar crop consistent across devices | Part 16 avatar harness (canonical crop + focal point) |

---

## 5 · Remaining issues

* **The reference's exact palette, shadows and type scale are approximated, not cloned** — the
  implementation uses EventHub's own tokens (primary, muted-foreground, border, card) so the
  profile matches the rest of the product. Where the reference is visually louder (its banner
  photo, its blue check) this build keeps product-consistent treatment instead.
* **The reference shows a "Following / Message" pair plus a share glyph on desktop; this build
  keeps the app's existing `Follow · Message · ⋯` set.** The ⋯ menu already carries
  copy-profile-link, so adding a third duplicate share control was not worth the clutter.
* **Empty-state height (~130px) is measured, not pixel-matched** to the reference, which has
  posts in every screenshot.
* **Native iOS focus-zoom and real-device rendering remain unobservable here** (as in Part 16):
  the CSS rules that govern them are asserted; the magnification itself is device behaviour.
* **`course` and `year` are still storable** (backend accepts them, the sheet can edit them) and
  are simply never rendered in the header — removing the fields outright would have been a
  data migration with no UI benefit.

## 6 · Files changed

`frontend/src/components/profile/profile-header.tsx` (rebuilt: grid regions, overlap by the
avatar alone, metadata/bio/tags/stats, short stat labels on phones, Edit cover + camera chip),
`frontend/src/components/profile/profile-screen.tsx` (edit shortcut wiring, gradient active
tab, scrollable one-row strip), `frontend/src/components/profile/edit-profile-sheet.tsx`
(Escape closes), `frontend/src/components/states.tsx` (compact empty state; the default
variant is untouched), plus the four harness files under `docs/mobile-qa/`.

New: `docs/mobile-qa/check-part17.js` (220 assertions), `docs/mobile-qa/dbg-part17.js`.
