# EventHub — Production Deployment Guide

**Vercel (frontend) + Render (backend)**

Work through this top to bottom. Each step ends with a command you can run to
confirm it worked. Do not skip to the deploy — most production failures here are
configuration, not code, and they are much cheaper to catch before traffic.

---

## 0. What you need before starting

| Service | Purpose | Free tier? |
|---|---|---|
| [Render](https://render.com) | Backend API | Yes — spins down when idle |
| [Vercel](https://vercel.com) | Frontend | Yes |
| [MongoDB Atlas](https://mongodb.com/atlas) | Event database (source of truth) | Yes — 512 MB |
| [Upstash](https://upstash.com) | Redis for cache / locks / rate limits | Yes — 500K commands/month |
| [Cloudinary](https://cloudinary.com) | Image storage | Yes — 25 credits/month |
| [Resend](https://resend.com) | Transactional email | Yes — 3K/month |

> **Render's free tier spins down after ~15 minutes idle** and the first request
> after that takes 30–60 seconds. That is not a bug in EventHub. If it matters,
> use the Starter plan.

---

## 1. Generate your secrets

Run these locally. **Save the output** — you will paste each value once and you
cannot retrieve them later.

```bash
# JWT signing key (rotate this and every session is invalidated)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Keep the output somewhere safe (password manager, not a text file in the repo).

---

## 2. MongoDB Atlas

1. Create a free **M0** cluster (Singapore region to match Render).
2. **Database Access** → add a user with `readWriteAnyDatabase`. Save the password.
3. **Network Access** → add `0.0.0.0/0`.
   Render's egress IPs are not static, so an allowlist will break after a redeploy.
4. **Database → Connect → Drivers** → copy the connection string.

Your `MONGO_URI` looks like:

```
mongodb+srv://user:PASSWORD@cluster.xxxxx.mongodb.net/eventhub?retryWrites=true&w=majority
```

> ⚠️ **The variable name is `MONGO_URI`.** Not `MONGODB_URI`. The server exits
> with `FATAL: MONGO_URI is not set.` if you get this wrong.

---

## 3. Upstash Redis

1. Create a database — **Regional**, same region as Render.
2. Copy the **REST URL** and **REST token** (not the TCP endpoint).

```
UPSTASH_REDIS_REST_URL=https://apn1-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxx
```

> **Why this matters:** with the in-memory fallback, each instance keeps its own
> cache, locks, idempotency keys and rate-limit counters. Two instances would
> silently **double your real rate limit** and could double-process an idempotent
> write. Set it now even on one instance.

---

## 4. Cloudinary

Dashboard → copy Cloud Name, API Key, API Secret.

> **Without Cloudinary, uploads fall back to local disk.** On Render the disk is
> ephemeral and wiped on every deploy — your users' images would disappear.

---

## 5. Resend

1. Add and verify your sending domain (required — Resend rejects unverified senders).
2. Create an API key.

---

## 6. Deploy the backend to Render

### 6.1 Create the service

1. Render → **New → Web Service** → connect your GitHub repo.
2. Configure:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Starter (free tier spins down) |

3. **Environment → Add Environment Variables.** Paste from
   `backend/.env.example`:

```
NODE_ENV=production
PORT=5000
MONGO_URI=<from step 2>
JWT_SECRET=<from step 1>
FRONTEND_URL=https://YOUR-APP.vercel.app      ← set in step 7, can update after
SUPER_ADMIN_EMAIL=devanshsinghr00@gmail.com
UPSTASH_REDIS_REST_URL=<from step 3>
UPSTASH_REDIS_REST_TOKEN=<from step 3>
CACHE_PROVIDER=upstash
RATE_LIMIT_PROVIDER=upstash
CLOUDINARY_CLOUD_NAME=<from step 4>
CLOUDINARY_API_KEY=<from step 4>
CLOUDINARY_API_SECRET=<from step 4>
RESEND_API_KEY=<from step 5>
EMAIL_FROM_ADDRESS=noreply@YOURDOMAIN.com
EMAIL_FROM_NAME=EventHub
LOG_LEVEL=info
SYNC_ENABLED=false
```

> Leave `SYNC_ENABLED=false` unless you have actually set up Supabase. The event
> engine does not need it, and a misconfigured Supabase should never be able to
> affect events.

4. **Create Web Service** → wait for the first deploy.

### 6.2 Verify

```bash
curl https://YOUR-API.onrender.com/api/health
# expect: {"status":"ok",...}
```

Then run the preflight against production config. This distinguishes
*configured* from *reachable* from *healthy* — a wrong Redis URL still "looks"
configured:

```bash
cd backend
MONGO_URI="<prod uri>" \
UPSTASH_REDIS_REST_URL="<url>" \
UPSTASH_REDIS_REST_TOKEN="<token>" \
npm run preflight
```

---

## 7. Deploy the frontend to Vercel

1. Vercel → **Add New → Project** → import the same repo.
2. Configure:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Next.js |
| Build Command | `npm run build` (default) |

3. **Environment Variables** — set for both Production and Preview:

```
NEXT_PUBLIC_API_URL=https://YOUR-API.onrender.com
NEXT_PUBLIC_SITE_URL=https://YOUR-APP.vercel.app
```

> ⚠️ **No trailing slash on `NEXT_PUBLIC_API_URL`.** This is the single most
> common deployment mistake — you get CORS errors and 404s that look exactly
> like a backend outage.
>
> ⚠️ **`NEXT_PUBLIC_` variables are baked into the bundle at build time.**
> Changing one in the Vercel dashboard does nothing until you **redeploy**.

4. **Deploy.** Then go back to Render and set `FRONTEND_URL` to your real Vercel
   URL — this is the CORS allowlist.

---

## 8. Google OAuth (if you use it)

**Google Cloud Console → Credentials → OAuth 2.0 Client → Authorised redirect URIs:**

```
https://YOUR-API.onrender.com/api/auth/google/callback
```

Then on Render set:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://YOUR-API.onrender.com/api/auth/google/callback
```

All three must match exactly, or Google returns `redirect_uri_mismatch`.

---

## 9. Create the Super Admin

This account is **undeletable, undemotable and untransferable** by design
(Part 7 §10). Create it once:

Only `ADMIN_EMAIL` and `ADMIN_PASSWORD` are required (the first/last name
default to `EventHub` / `Admin`):

```bash
cd backend
ADMIN_EMAIL=devanshsinghr00@gmail.com \
ADMIN_PASSWORD='<strong password>' \
MONGO_URI="<prod uri>" \
npm run create-admin
```

Then **delete `ADMIN_PASSWORD` from your shell history** and never commit it.

---

## 10. Post-deploy verification

Run these in order. **Do not announce the launch until all pass.**

```bash
cd backend

# 1. No credentials are about to travel with your artifact
npm run scan-secrets
#    expect: ✅ no secrets found      (exit 0)

# 2. Full regression suite still green
npm run test:all
#    expect: 1364 assertions, 0 failed

# 3. Health check against the live API
curl -s https://YOUR-API.onrender.com/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-API.onrender.com/api/events
#    expect: 200

# 4. Load smoke test — 30s of realistic browse traffic
npm run load-test -- --profile A \
  --base-url https://YOUR-API.onrender.com \
  --duration 30 --rps 20
#    expect: 0% errors. Watch the p95 against the 600ms budget.
#    NOTE: Render's free tier spins down when idle — warm it up first or the
#    first requests will be very slow and the numbers will be meaningless.
```

Then check the frontend in a browser:

- [ ] Signup works and a verification email arrives
- [ ] Login works
- [ ] Creating an event works
- [ ] **Uploading an image works and the URL is a `res.cloudinary.com` URL**
      (if it is `/uploads/...`, Cloudinary is not configured and images will be lost on the next deploy)
- [ ] No CORS errors in the browser console

---

## 11. Before you announce it — the one thing that is still outstanding

**Run the restore drill.** You have backups you have never restored from, and
that is the one failure you cannot recover from.

```bash
# Follow docs/RESTORE-DRILL.md against an ISOLATED target, then:
npm run verify-restore -- --target <restored-uri> --source <live-uri>
# expect: PASS  (exit 0)
```

Exit 1 means **do not go live yet**.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FATAL: MONGO_URI is not set.` | Wrong variable name | Use `MONGO_URI`, not `MONGODB_URI` |
| CORS errors in browser | `FRONTEND_URL` on Render ≠ Vercel URL | Set it exactly, no trailing slash |
| All API calls 404 | `NEXT_PUBLIC_API_URL` has a trailing slash or `/api` suffix | Fix, then **redeploy** (it is baked in at build time) |
| Images disappear after deploy | Cloudinary not configured | Set all three Cloudinary vars |
| `redirect_uri_mismatch` | Google callback mismatch | All three Google vars must match Console exactly |
| First request takes 30–60s | Render free tier spun down | Expected. Upgrade to Starter, or accept it |
| Rate limits too aggressive | Everyone shares one IP bucket (campus NAT) | See below |
| Emails not arriving | Unverified Resend domain | Verify the domain in Resend |

---

## 13. After your first real event

**Watch your 429s.** Every bucket is currently keyed by IP alone. On a campus
NAT, 500 students share one bucket — one active user can throttle everyone. My
own measurement: at 60 rps from a single IP, **422 of 722 responses were rate
limited**.

I deliberately did not change this, because the brief was to *measure before
raising limits*. Now you will have data. If NAT-wide throttling shows up, key
authenticated write domains by user instead of IP.

```bash
# Capture a real baseline so drift is detectable from here on
npm run load-test -- --profile A --base-url https://YOUR-API.onrender.com \
  --duration 60 --rps 50 --json baseline.json

# Later, compare against it
npm run perf-guard -- --input results.json --baseline baseline.json
```

**Before scaling past one instance**, confirm shared state is on:

```bash
CACHE_PROVIDER=upstash
RATE_LIMIT_PROVIDER=upstash
LOCK_PROVIDER=upstash
IDEMPOTENCY_PROVIDER=upstash
```

With the in-memory fallback, two instances each enforce their own limits — so
your real rate limit silently doubles, and an idempotent write can be processed
twice.

---

## Quick reference

| Task | Command |
|---|---|
| Lint for committed secrets | `npm run scan-secrets` |
| Check prod config reachability | `npm run preflight` |
| Full test suite | `npm run test:all` |
| Load test | `npm run load-test -- --profile A --base-url <url>` |
| Perf regression gate | `npm run perf-guard -- --input r.json --baseline b.json` |
| Verify a restore | `npm run verify-restore -- --target <uri> --source <uri>` |
| Reconcile Mongo → Supabase | `npm run reconcile` — **dry-run by default**; add `-- --apply` to enqueue repairs |
| Live-activity load test | `npm run test:load:100` |
