# PART 15 — the mobile chat right edge

The sent bubbles stopped ~43 CSS px short of the right edge (≈95px at a 2.2–2.4×
device pixel ratio — the "90–105px" in the report), and every content type
stopped at the *same* place. That was the tell: it was never the bubble's
`margin-right`. It was the row's container.

---

## 1. Root cause

A message row is a flex line with three parts:

```
[ rail 28px ][ gap 6px ][ bubble ]
```

The rail exists so a **received** bubble can sit beside its avatar. On a **sent**
row there is no avatar, but the row still carried a 28px invisible spacer in that
slot (`message-bubble.tsx`, the `mine ? <div className="w-7 shrink-0" />` tail).
On top of that, the message column's own side padding was 9px. So every sent
bubble was held

```
9 (padding) + 6 (gap) + 28 (phantom rail) = 43px
```

away from the right edge — at *every* width and for *every* kind of message,
because the constraint lives on the row, not the bubble. The composer was never
part of this: it is full-bleed to the viewport and its send button sits 8px from
the edge, which is why the screenshots looked like "everything stops early"
while the composer's own frame looked fine.

Measured before the fix (Playwright, DPR 2, seeded fixtures):

| viewport | sent bubble right edge | gap | identical for all types? |
| --- | --- | --- | --- |
| 320 | 277 | 43 | yes |
| 390 | 347 | 43 | yes |
| 688 (the report's example) | 638 | 50 (≥sm rail + 16 padding) | yes |

At a 390px phone with DPR 2.24 (Pixel-class) the 43 CSS px render as **96
device px**, and 43 × 2 = **84** at the 688/2 ratio in the report. The report's
"expected 672" for a 688px viewport is the same arithmetic read forwards:
688 − 16 = 672.

## 2. Component / CSS responsible

| file | what it owned |
| --- | --- |
| `frontend/src/components/messages/message-bubble.tsx` | the row's phantom 28px spacer on sent messages |
| `frontend/src/components/messages/thread-view.tsx` | the message column's side padding (9px on phones) |

No `80%/85%` widths, no `max-width` container, no `calc()`, no negative margins,
no `100vw` anywhere in the chain — the audit of the full ancestor path
(`chat page → shell → panel → scroller → inner column → row → wrapper → bubble`)
is in `docs/mobile-qa/probe-chat-edges.js`, which prints all seventeen properties
per level (§3), and its dump is what identified the rail.

## 3. The fix

Two edits, both at the container level, no bubble touched:

```diff
  message-bubble.tsx   — the phantom rail is dropped below lg
- {mine ? <div className="w-7 shrink-0" /> : null}
+ {mine ? <div className="hidden w-7 shrink-0 lg:block" /> : null}

  thread-view.tsx      — one safe padding, the canonical 16px
- className="… px-[9px] py-2 sm:px-4"
+ className="… px-4 py-2"
```

* **Why remove the spacer rather than shrink it:** the row is a `gap-1.5` flex
  container, so a spacer of *any* width adds its width on top of the 6px gap (a
  6px spacer measured 21px, not 15px). Removing the item is the only way to get
  the padding alone.
* **Why `lg` and not `sm`:** below 1024px the thread is a single full-width
  column (the inbox pane is `lg:flex`), so 768px or the report's 688px is the
  same mobile layout with more room — its sent bubble belongs on the safe
  padding too, which is what §8's 672 example asks for. From `lg` up the
  original rail returns and the pane keeps its 50/50 gutters.
* **Nothing else changed:** bubble `max-w-[78%]`, gradients, radii, shadows,
  typography, timestamps, ticks, avatars and the shared-post card are untouched.
  `max-width` still belongs to the bubble and resolves against the row, so no
  bubble changed size — long text grows **leftward** (§8/§26) because the row is
  `justify-end`.

Measured after the fix:

| viewport | sent right edge | gap | received avatar | received bubble | composer |
| --- | --- | --- | --- | --- | --- |
| 320 | 304 | **16** | 16 | 50 | 0..320 |
| 360 | 344 | **16** | 16 | 50 | 0..360 |
| 375 | 359 | **16** | 16 | 50 | 0..375 |
| 390 | 374 | **16** | 16 | 50 | 0..390 |
| 412 | 396 | **16** | 16 | 50 | 0..412 |
| 430 | 414 | **16** | 16 | 50 | 0..430 |
| 688 | **672** | **16** | 16 | 50 | 0..688 |
| 768 | 752 | **16** | 16 | 50 | 0..768 |
| 1024 | 973 | 51 | 16 | 627 | pane 577..1010 |
| 1280 | 1229 | 51 | 16 | 627 | pane 577..1278 |

## 4. Mobile widths tested

320 · 360 · 375 · 390 · 412 · 430 — plus 688 and 768 (single-column tablet and
the report's own example) and 1024/1280 for desktop. All eight content types
were measured at each phone width — sent text, sent emoji, the four-message
consecutive group, long text, sent image, **sent shared post**, received text,
received image and received shared post — and they share one right edge to the
pixel at every width.

`docs/mobile-qa/check-part15.js` — **218 passed, 0 failed**. It asserts the
spec's own numbers: one right edge for every sent type (§1/§9/§11), the 12–16px
safe padding (§5), received stays left with its avatar (§7), consecutive
messages stay separate with a small gap (§10), the composer spans the column
(§12/§13), header/composer fixed and only the history scrolling (§15/§16),
`document.scrollWidth ≤ viewport` and no element crossing the viewport edge
(§18/§19), and the exact pre-fix desktop figures at 1024/1280 (§23).

## 5. iPhone Safari

Chromium here cannot run WebKit, so iOS was verified by construction rather than
by device: the only viewport unit on this route is `100dvh` with a `100vh`
fallback (`app/(app)/messages/[id]/page.tsx`); there is no `100vw` anywhere in
the chain (grep-verified) so the scrollbar-width subtraction that causes iOS
overflow cannot apply; the composer's bottom inset is
`max(var(--keyboard-inset, 0px), env(safe-area-inset-bottom, 0px))`, unchanged;
the header keeps `calc(0.375rem + env(safe-area-inset-top, 0px))`; and the fix
itself is pure flex + padding, i.e. identical maths in WebKit. The one iOS-only
residual — the browser's own address-bar animation changing `dvh` mid-scroll —
is handled by the existing `dvh` maths and is not affected by this change.
**Worth one real-device check on your side:** open a chat and confirm the sent
bubbles sit 16px from the edge and no horizontal scroll appears.

## 6. Android Chrome

Same story: 8 phone widths × Chromium at DPR 2, `isMobile: true`, `hasTouch:
true`, plus a real-mobile user agent in the probe. No horizontal overflow at any
width (`docScrollWidth == viewport`), no inner horizontal scroll in the history,
and the page itself never scrolls (`scrollHeight == viewport height`).

## 7. Desktop verified unchanged

Measured, not eyeballed — the harness asserts the exact pre-fix numbers:

* 1280: sent bubble right edge **1229**, received left **627**, pane **577..1278**,
  header y 70, composer bottom 832 — identical before and after.
* 1024: 973 / 627 / pane 577..1010 — identical before and after.
* The inbox pane is still 21rem, the gutters are still 50/50, and the `lg` rail
  is byte-for-byte the original element.

---

## Evidence

| artefact | what it is |
| --- | --- |
| `docs/mobile-qa/check-part15.js` | the acceptance harness — **218/0** |
| `docs/mobile-qa/probe-chat-edges.js` | the DOM/computed-style audit (§3) — prints the ancestor chain and per-type geometry |
| `docs/mobile-qa/seed-part15.js` | seeds one message of every content type through the real API |
| `docs/mobile-qa/before-after-part15.js` | the same page measured with the old rail/padding restored, then fixed |
| `qa/profile-audit/p15-chat-{320,390,430}-after.png` | phone renders |
| `qa/profile-audit/p15-chat-{390,688}-{before,after}.png` | before/after pairs, measured 43 → 16 |
| `qa/profile-audit/p15-chat-desktop.png` | desktop unchanged |

Regression gates re-run after the change: **check-part15 218/0 · check-messages
130/0 (expectations upgraded for Part 15) · part14 320/0 · part9 100/0 ·
ui-fixes 167/0 · backend part10-messages 59/0 · part10-realtime 38/0 · frontend
units 38/26/17/15 · `next build` clean.**

## Note on the build failure

The Vercel log (`Expected ',', got 'open'` in `events/[slug]/page.tsx` and
`profile/[id]/page.tsx`, `Expected '</', got '('` in `quiz/[id]/page.tsx`) does
not correspond to any committed revision: all three files parse cleanly in the
current `main` **and** in every historical revision, and the deployed line
numbers (1083/1079–1080, 434/431–432, 177) match the Oct-6 "Major platform
update" commit while its *content* matches a build whose character-level edits
(one lost `<>` fragment line per Dialog tail, one missing `}` on a JSX comment)
are not in git. Both error strings were reproduced and their fixes verified with
Next's own SWC parser, and `frontend/scripts/parse-check.js` now runs as
`prebuild` — the same parser `next build` uses — so a file like that fails in
~1s locally and in CI instead of after a full Vercel build. See
`docs/BUILD_PARSE_GATE.md`.
