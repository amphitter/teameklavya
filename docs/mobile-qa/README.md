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
