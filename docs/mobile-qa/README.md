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
