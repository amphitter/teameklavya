# MESSAGES — the missing right margin, and the top section that was oversized

Two things were asked for, in the message component:

> "the margin from right coz we have to provide few in right side of messge
> margin from left to right so margin-right=43px would be working"
>
> "and also in few mobile phones the size issue is there due to that the top
> user nave wala section"

They turned out to be **one bug with one root cause**, and it was not a styling
preference — the inbox was being laid out several times wider than the phone and
then clipped. Everything below was measured in a real browser at 320, 360, 375,
390, 412 and 430 px (and 1280 for desktop).

---

## 1. What was actually wrong

The conversation list (`frontend/src/components/messages/conversation-list.tsx`)
is a flex item of the messages page's row. Its root was

```jsx
<div className="flex min-h-0 flex-1 flex-col">
```

with **no `min-w-0`**. The automatic minimum size of a flex item is its
min-content width, and a conversation row contains a `truncate` (nowrap) preview
line — so the row's min-content width was the width of the whole sentence, and
the list sized itself to that. The page around it is `overflow-hidden`, so
nothing scrolled and nothing looked broken from the outside: the extra width was
simply cut off at the right edge.

Measured on the **pre-fix** build, phone width 320, seeded preview text:

| what | before |
| --- | --- |
| list root | **1321 px wide** in a 320 px viewport |
| conversation row (`<button>`, `<li>`, `<ul>`) | 1321 px, `[0..1321]` |
| preview text span | 1237 px wide, `scrollWidth` 1285 — never truncated, just clipped |
| search field | 1309 px wide — ran off the screen |
| "New team" button | pushed to x=1309, i.e. **off screen** |
| row timestamp / unread badge | `shrink-0` items at x≈1672 — **off screen** |
| `document.scrollWidth` | 320 — *nothing to detect* |

That last line is why this survived four parts of review: the usual "is there
horizontal overflow?" check answers *no*, because the ancestor `overflow-hidden`
eats the evidence. The fix has to be measured on the **elements**, not the page.

With a long preview restored, the same page measured **1684 px** wide on both a
320 px and a 390 px viewport — the layout is content-driven, so it is wrong on
every phone, and on desktop windows narrower than the sentence.

## 2. The fix

| file | change |
| --- | --- |
| `components/messages/conversation-list.tsx` | `min-w-0` on the list root — the load-bearing one |
| `components/messages/conversation-list.tsx` | `min-w-0` on the list scroller, so the same class of bug cannot come back if it becomes a row item |
| `components/messages/thread-view.tsx` | `px-[9px] … sm:px-4` on the message scroller — the two gutters, below |
| `components/messages/thread-panel.tsx` | the thread header reserves the notch inset, exactly like the feed's top bar |

None of the four touches desktop layout maths, the message store, the realtime
path or the composer.

### The two gutters (the "margin-right=43px")

Every bubble row is `[rail][6px gap][bubble]`, where the rail is the 28 px avatar
column on a received row and an invisible 28 px spacer on an own row. One padding
value therefore sets **both** gutters:

```
gutter = padding + 28 + 6
```

`9px` is chosen so the phone gutter measures exactly **43 px** — the value asked
for — and it is identical on the left and on the right, so the column is mirrored
rather than offset. From `sm` there is room for 16 px (50 px gutters). Before
this change the phone padding was 12 px, i.e. a 46 px gutter on both sides.

Note for the record: there is **no negative margin anywhere** in the messages
components, and there is no `-42px` in the source, in `git log -S marginRight`,
or in the reference HTML in `uploads/`. The number in the report ("42") matches
how much of the *inbox* was cut off on a ~1280 px window by the bug above; the
fix removes the cause rather than compensating with a margin.

### The top section ("the top user nave wala section")

Same cause: the title row, the search field and the tab strip are all inside
that clamped column, which is why the search box ran off the right edge on a
phone. With the clamp, at 320 px:

| element | before | after |
| --- | --- | --- |
| search field | 1309 px wide, clipped | 296 px, ends at 308 (12 px margin) |
| "New team" button | off screen (x=1309) | visible, top right |
| tab strip | fine (own horizontal scroll) | fine |
| row preview | clipped mid-word | truncates with an ellipsis |
| row timestamp | off screen | visible at the right |

The thread header was measured separately at all six phone widths and was
already sound: 57 px tall, 44×44 px targets, 8 px side padding, controls ending
at x=312 on a 320 px screen, and a long name (33 characters) truncates without
changing the height or pushing anything out. It gained one thing — the safe-area
top padding it was missing, so on a notched phone (where this screen owns the top
edge, because the shell's top bar is desktop-only and the bottom nav is hidden in
a chat) it no longer sits under the status bar.

## 3. Evidence

```
BEFORE 320: list 1684 px · preview 1600 px · timestamp right edge 1672   (viewport 320)
AFTER  320: list  320 px · preview  236 px · timestamp right edge  308
BEFORE 390: list 1684 px · preview 1600 px · timestamp right edge 1672   (viewport 390)
AFTER  390: list  390 px · preview  306 px · timestamp right edge  378
```

Screenshots (same page, same seeded text, `min-width:auto` restored for the
"before"):

* `qa/profile-audit/msg-inbox-320-before.png` / `msg-inbox-320-after.png`
* `qa/profile-audit/msg-inbox-390-before.png` / `msg-inbox-390-after.png`
* `qa/profile-audit/msg-thread-320.png`, `msg-thread-390.png`, `msg-thread-desktop.png`

Harness: `docs/mobile-qa/check-messages.js` — **130 passed, 0 failed** over
320/360/375/390/412/430 + 1280, asserting the clamp, all three tabs, the two
gutters (43/43 phones, 50/50 desktop), the header height/targets/notch padding,
and "no element anywhere is wider than the viewport" on both screens.

Regression gates re-run after the change:

| gate | result |
| --- | --- |
| `check-messages.js` | 130 / 0 |
| `part14.js` (feed, nav, impressions) | 320 / 0 |
| `part9.js` (profile, stories, tabs) | 100 / 0 |
| `ui-fixes.js` | 167 / 0 failures |
| backend `part10-messages.js` | 59 / 0 |
| backend `part10-realtime.js` | 38 / 0 |
| frontend units (messages store, crop, query, variants) | 38 / 0, 26 / 0, 17 / 0, 15 / 0 |
| `next build` | clean |

Desktop at 1280 is unchanged apart from the bug it shared: the inbox pane is
still 21 rem, the thread gutters are 50/50, and the row that used to lose ~41 px
on a 1280 px window now ends inside its own pane.

## 4. Notes and what is not covered

* `part9.js` §32 asserts the bottom nav's Messages badge, so `check-messages.js`
  ends by leaving one unread message from ben in the fixture — opening a thread
  marks it read, and a later harness would otherwise fail on an empty badge.
* Long names still truncate in the thread header at 320 px (110 px of title on a
  team thread). That is the intended behaviour at that width, not a clip — the
  controls and the height are unaffected.
* The same clamp mistake could exist in other features' list columns; this
  change only covers the messages components, which is what was reported.
