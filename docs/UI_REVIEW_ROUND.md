# UI review round — the bottom nav, the tab strip, the desktop band, the guest screen

The user sent thirteen screenshots of the running product with "issues a lot of
issues with these ui < remove alert from bottom", naming one thing explicitly:
**remove Alerts from the bottom nav.**

The rest of the round is the audit of what those screenshots actually showed.
Every finding below was reproduced in the live app at a measured width before
anything was changed, and every fix is covered by `docs/mobile-qa/ui-fixes.js`
(221 checks), which was written first for the four cases where a screenshot alone
could be misread.

---

## What changed

| # | Finding (how it was measured) | Fix |
|---|---|---|
| 1 | **The fourth feed tab was cut off.** `"Communities"` sat 80px outside the viewport at 360 and was still clipped at 390 — the strip was a horizontal scroller with the scrollbar hidden, so the tab was not "off screen", it was *gone* with no affordance. | The strip now **wraps** (`flex-wrap`). One line at 412+, two at 320–390. No tab can be clipped at any width, in either direction. |
| 2 | **Alerts in the bottom nav** (the explicit request). | The nav is five destinations: Home · Explore · Create · Messages · Profile. The bell moved to the **home header**, beside the greeting, on phones only — where an unread indicator is looked for. It did not just disappear: notifications are still one tap from the top of the screen, still with the unread badge and the dropdown. `NotificationsNavLink` (the nav-only bell) was deleted, not left orphaned. |
| 3 | **Dead band on the right of the page.** At 1024 the feed column was pinned left with **82px** of nothing beside it; at 1120, **130px**; at 1280, **386px** — while the discovery rail stayed hidden until 1280. | The rail now appears from **lg (1024)**, `w-56` at lg and `w-80` at xl, with a `lg:min-w-[440px]` floor on the feed column. Measured after: feed 488px + gap 24 + rail 224 + **24px** margin at 1024, and the page is symmetric at every width (Δ0 left vs right at 1024/1120/1280/1440/1568). |
| 4 | **A signed-out phone saw the same pitch twice.** "Welcome to EventHub" (feed) and "Join the conversation" (composer) stacked: 174px of near-identical prose and four buttons between the search field and the first post. | One card. `CreatePost` takes `showGuestCard`; the feed turns it off when its own welcome card is already rendering. The composer card still exists for any other caller. |
| 5 | **"1 Posts"** on every new profile. | Singular when the count is one — "1 Post", "1 Follower". Derived in one place (`plural()`), so a caller cannot forget it. `Following` is unchanged (it has no separate singular). |
| 6 | **The profile's seven-tab strip** wrapped into a ragged 4 + 3 + 1 block and the unselected tabs had no surface, so the strip read as a paragraph. | Equal-width **3-column grid** on phones (7 chips, 3 rows, every label whole — including "Achievements" at 320), every chip carrying a border and surface so it reads as a menu, and the same visual language as the feed's tabs. From `sm` up it is the wrapping row it already was. |

A seventh observation was **checked and dismissed**: the user's screenshots show a
faint vertical line in the story rail next to "Workshop". That line does not exist
in the current tree — `story-rail.tsx` has no divider, and the harness now asserts
that no thin vertical element is drawn inside `.rail-scroll` at any of the six
widths. The screenshots are from the deployed build, which is older than the
current commit; the line has already been removed.

Two more from the screenshots were **deliberate, not defects**, and are recorded
here rather than "fixed":

* the notification badge is a filled red circle with a white number — a red
  count on a blue icon is a normal notification affordance, and the badge is the
  only red on the screen;
* the desktop rail at 1568 leaves 178px of margin on each side. That is the
  `max-w-6xl` content width, symmetric by design; the harness asserts symmetry
  rather than an absolute margin, so a wide monitor does not read as a bug.

---

## Evidence

`docs/mobile-qa/ui-fixes.js` — **221 checks, 0 failures**

| Section | What it proves |
|---|---|
| tabs × 6 widths (320–430) | All four tabs render, each fully inside the viewport, none stunted by an ancestor's overflow, each showing its whole label, each ≥40px tall. Reports the row count per width (2 rows ≤390, 1 row at 412+). |
| bottom nav × 6 widths | Exactly five destinations; no item labelled "Alerts"; Home/Explore/Messages/Profile all still present and none squeezed to zero width; the nav still sits on the bottom edge. |
| notifications | A bell control still exists on a phone, is **not** inside the bottom nav, and sits in the upper half of the screen. |
| rails | No thin vertical artifact inside the story rail; no visible scrollbar on it. |
| profile | "1 Post" / "1 Follower" singular; the tab strip has no cut or truncated chip, no page overflow, and stays ≤3 rows; reports pill widths per width. |
| desktop × 5 widths | No horizontal overflow; rail visible; phone nav hidden; rail gap 0–48px from the feed; **left margin = right margin (Δ0)** — i.e. no asymmetric band; feed column ≥440px; rail does not overflow its own column. |
| signed out × 2 widths | Exactly one welcome card; tabs still uncut; no bell; no overflow. |
| everywhere | Zero uncaught page errors. |

### Regressions (same run, same build)

| Suite | Result |
|---|---|
| `phase3.js` | **57 passed, 0 failed** |
| `phase3-widths.js` | 0 failures across 6 widths |
| `phase4.js` | **50 passed, 0 failed** |
| `phase4-widths.js` | 132 checks, 0 failures |
| `phase2-widths.js` | 0 failures across 6 widths |
| `tsc --noEmit` · `npm run build` | 0 errors · ✓ |

One of those suites had to be corrected, and the correction is the point: the
phase 3 harness asserted the literal string `"Followers"`, so the new (correct)
singular `"1 Follower"` made a pass look like a failure. It now matches the
intent — three stat labels present — rather than one spelling of one label.

---

## Still not verified — do not read these as passing

* `phase5.selftest` remains **65 passed, 5 failed** (adaptive-polling assertions).
  This is pre-existing: it was proved identical at earlier commits in a throwaway
  worktree, and this round did not touch `app/(app)/messages/page.tsx`,
  `components/shell/messages-link.tsx` or `presence-dot.tsx:23`.
* A real phone keyboard, `env(safe-area-inset-*)`, and IME gestures. The harness
  has no on-screen keyboard; the nav's safe-area padding is therefore unexercised.
* Messages was not part of this round's findings. The seeded account has no
  conversations, so the inbox/chat screens were not re-verified here; their
  status stands from the earlier round (`scrollbar2.js`, and the composer fix
  recorded in Phase 1).
