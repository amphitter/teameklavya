# Mobile QA harness

The scripts that produced the Part 11 mobile evidence. They drive a headless
Chromium at real phone sizes against a **real backend** — no mocking of the
app's own logic, no fixtures pretending to be features.

## Setup

```bash
# 1. a throwaway backend on :5999 (memory Mongo, seeded people/team/DM)
cd backend && npm install && node tests/qa-mobile-server.js
#    → prints a QA_READY line with the ids and tokens

# 2. the frontend, built to talk to that backend
cd frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:5999 npm run build
./node_modules/.bin/next start -p 3211

# 3. drive it
node docs/mobile-qa/verify.js "$(cat ids.json)"    # layout at 390/360/320
node docs/mobile-qa/live.js   "$(cat ids.json)"    # two users, real sockets
node docs/mobile-qa/kb.js     "$(cat ids.json)"    # keyboard inset
node docs/mobile-qa/sweep.js  "$(cat ids.json)"    # every route, both widths
```

Playwright lives outside the repo (`npm i playwright && npx playwright install
chromium`), because it is a verification tool, not a runtime dependency.

## What each one answers

| Script | Question |
|--------|----------|
| `verify.js` | Is the top bar really gone on a phone? Is the nav complete and on-screen? Does anything overflow at 390/360/320? |
| `live.js` | Does Ana's typing reach Ben's screen — and clear when she stops? |
| `live2.js` | Does a team bubble name its sender? Does a direct chat say "Active now"? Does the roster load? |
| `kb.js` | Does a 300px keyboard lift the sheet's action button clear of it? |
| `sweep.js` | Do nine routes at two widths survive without the top bar? |

## Same-origin mode (how the phone preview works)

A preview served from one sandbox origin cannot call the API on a second
sandbox port — the cross-port host is token-gated — and a sandbox browser has
no egress to Render. So the app can be built to call its own origin and let the
Next server forward:

```bash
cd frontend
NEXT_PUBLIC_API_URL=same-origin \
BACKEND_PROXY_URL=http://127.0.0.1:5999 \
npm run build
BACKEND_PROXY_URL=http://127.0.0.1:5999 next start -p 3000 -H 0.0.0.0
```

* `NEXT_PUBLIC_API_URL=same-origin` makes `src/utils/api.js` use `/api`
  relative to the page, `socket.ts` connect to `window.location.origin`, and
  the OAuth/verify-email redirects build absolute URLs from the live origin.
* `BACKEND_PROXY_URL` emits the `/api` and `/socket.io` rewrites in
  `next.config.ts`.

**Both switches are inert when unset**, so production keeps talking to Render
directly: unset `BACKEND_PROXY_URL` means no rewrites are emitted at all, and
an unset/absolute `NEXT_PUBLIC_API_URL` behaves exactly as before. The one
detail that bit us: Next strips the trailing slash before rewrites run, and
socket.io only answers on `/socket.io/` — hence the literal slash in that
rewrite, plus `skipTrailingSlashRedirect` (only in this mode).

## Phase 2 — the canonical avatar and cover

```bash
# the same throwaway backend, but with the browser talking to the app's own
# origin (the same-origin proxy), so uploads and their /uploads/* files resolve
cd frontend
NEXT_PUBLIC_API_URL=same-origin BACKEND_PROXY_URL=http://127.0.0.1:5999 npm run build
BACKEND_PROXY_URL=http://127.0.0.1:5999 ./node_modules/.bin/next start -p 3000 -H 0.0.0.0

# drive it (the seeded accounts are timestamped, so read the QA_READY line)
cd /var/tmp/pw
QA_EMAIL=ana<stamp>@qa.com node phase2.js          # both flows, 390×844 at DPR 3
QA_EMAIL=ana<stamp>@qa.com node phase2-widths.js   # 320/360/375/390/412/430
```

`phase2.js` generates its own banded fixtures (a 1200×1600 four-band portrait
and a 2400×1800 three-band cover) so it can ask a question a flat image cannot
answer: *which region of the photo survived the crop?* It samples the centre
pixel of the served avatar and compares it to the band the stored crop points
at — a default centre crop fails that check, a deliberate framing passes it.

`phase2-widths.js` opens the crop editor at every width the brief names and
asserts the frame is square, on screen, and that the confirm button and the
zoom slider are hit-testable (not merely present in the DOM).

Both need `LD_LIBRARY_PATH=/var/tmp/libs/usr/lib/x86_64-linux-gnu` and
`PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/ms-playwright` in this sandbox.

## Phase 3 — profile and the owner's own lists

```bash
cd /var/tmp/pw
QA_EMAIL=ana<stamp>@qa.com node phase3.js          # 390x844, drives the real UI
QA_EMAIL=ana<stamp>@qa.com node phase3-widths.js  # 320/360/375/390/412/430
```

`phase3.js` signs in with the seeded account, renames its handle to `ana_roy`,
creates its own fixtures through the real API, and then **goes through the
screens**: it archives from the ••• menu (not the API), checks the toast, the
card leaving the list, the Archive tab, restore, the media grid and the visitor's
view of the same profile. Fixture captions carry a per-run tag, because the
seeded database keeps its posts and two runs sharing a caption makes
"is this card still on screen" unanswerable.

`phase3-widths.js` asserts the tab strip hides **nothing** behind a horizontal
scroll (`scrollWidth - clientWidth <= 1`) — that failure is what made the Archive
tab invisible on every phone — and measures the stat row, the media tiles and the
Archive menu item at each width. Tabs are hit-tested after `scrollIntoView`,
because on a 320x568 screen content can sit under the fixed bottom nav at
scroll-top, which is normal and not a defect.
