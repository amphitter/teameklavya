# SECURITY MODEL

EventHub is a modular monolith. This document states where the security
boundary is, which credentials exist and where they are allowed to live, and
the decisions we made deliberately — so that the next person to touch them
knows they were decisions rather than oversights.

Scope: Part 7 §8 (Supabase security audit), §9 (RLS decision), §11 (Redis
audit), §13 (cache privacy), §15 (cookie/token security).

---

## 1. The boundary

There is exactly one security boundary: **the EventHub API**.

```
browser ──► EventHub API ──► MongoDB        (event/business source of truth)
                         ──► Supabase       (relational/social target)
                         ──► Upstash Redis  (shared ephemeral infrastructure)
                         ──► Cloudinary/R2  (binary storage)
```

The browser talks to the API and to nothing else. It has no MongoDB
connection, no Supabase client, no Redis client, and no storage credentials.
Authorisation is decided once, in the API, where it is also tested.

This is the reason the rest of this document is short. Every rule below
follows from keeping that boundary intact.

---

## 2. Credentials

| Credential | Lives in | Reaches the browser? |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `providers/supabase/` only | Never |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | `providers/redis/` only | Never |
| Cloudinary / R2 secrets | `providers`/`services/storage` | Never |
| Session JWT | HttpOnly cookie | Yes, as an opaque cookie — never readable by JS |

Rules, each enforced by a test in `tests/phase12.selftest.js`:

- The service-role key is **read in exactly one module**
  (`providers/supabase/`) and that module is the provider boundary.
- No credential is ever logged. Errors carry a message, never a URL, header
  or token.
- Provider errors are scrubbed before they are logged or returned: JWT-shaped
  blobs, Postgres DSNs (which carry the password) and supplied secrets are all
  redacted, while the host is left in place so the log stays diagnosable.
- No credential is ever part of a cache key, because keys get logged.

---

## 3. §9 — Row Level Security: the decision

**RLS is OFF, and it is off on every table.**

This is a deliberate decision, not an omission.

### Why

RLS is a database-level authorisation mechanism. It is the right tool when the
database is directly reachable by a client, because in that situation the
database is the only thing standing between a user and another user's rows.

In EventHub the database is **not** directly reachable by a client. The
service-role key is used server-side, and the service-role key **bypasses RLS
entirely**. So enabling RLS today would buy precisely nothing: the only caller
Supabase has is the API, and RLS would not constrain it.

What it would cost is real. Authorisation would then exist in two places — the
policy SQL and the tested API layer — and the two would disagree. That is the
classic failure mode: a policy that is subtly narrower or wider than the code,
nobody sure which one is authoritative, and a bug that only reproduces in
production. We already have one tested place where authorisation is decided,
and Part 7 §17 fuzzes it across seven roles. Duplicating it into SQL would
make the system less safe, not more.

### The condition under which RLS becomes mandatory

**If a browser ever talks to Supabase directly, RLS becomes mandatory on every
table that holds user data — before that path ships, not after.**

Concretely, RLS must be enabled the moment any of these becomes true:

- a Supabase client is constructed in `frontend/src`, or
- the anon key is shipped to the browser, or
- any request reaches Supabase without passing through the API.

At that point the anon key would be public and RLS would be the only thing
protecting rows, so every table needs `ENABLE ROW LEVEL SECURITY` **and** a
`CREATE POLICY` for each operation.

### No half-configured RLS

Half-configured RLS is worse than none:

- RLS enabled with **no policy** denies everything, so reads silently return
  empty. A migration "succeeds" having written nothing, and the failure looks
  like an application bug.
- RLS enabled on **some** tables gives a false sense of coverage. The
  unprotected table is the one nobody remembers.

So the rule is binary: **RLS is off everywhere, or on everywhere with a
policy for every operation on every table.** There is no intermediate state,
and `tests/phase12.selftest.js` asserts that no migration enables RLS without
also creating policies.

**Current state: off.** Verified by assertion in two directions — the migrations
do not enable it, and there is no browser→Supabase path. If either assertion
starts failing, the decision above has to be revisited rather than worked
around.

---

## 4. §11 — Redis

Upstash Redis is **shared, ephemeral infrastructure**. It is not a database.

Rules:

- **Nothing permanent lives here.** Redis holds caches, rate-limit windows,
  idempotency claims and locks. Every one of them has a TTL. A `SET` without
  an expiry is a bug — it is both a capacity leak and a privacy leak, because
  deleted data would survive in the cache.
- **No business data is reconstructed from Redis alone.** Redis going away
  degrades the product; it never breaks it. Rate limiting fails open, the
  cache falls back to memory, and idempotency refuses rather than duplicating.
- **Keys are built in exactly one place.** Controllers never construct a Redis
  key. `services/cache.service.js` owns the key builder, the namespace, the
  version and the privacy class, which is what makes the registry worth
  anything — a hand-built key bypasses all four.
- **Namespaced and versioned.** Every key is
  `{namespace}:{version}:cache:{domain}:{id}`. The namespace means a shared
  Upstash instance cannot collide with a neighbour; the version means bumping
  `CACHE_KEY_VERSION` invalidates the entire cache with one env change, which
  is what makes a key-shape migration safe.
- **Prefix isolation.** `event` and `event-counts` are separate domains, so
  invalidating one does not sweep the other.
- **Locks are owner-only.** A lock token is a random UUID, never derived from
  the lock name. Release is a Lua compare-and-delete, so a non-owner cannot
  release someone else's lock. Locks expire, so a holder that dies does not
  wedge the resource forever.
- **Raw Redis errors never reach a client.** The resilient provider swallows
  primary errors and falls back; no 5xx body carries a Redis string.

---

## 5. §13 — Cache privacy

Every cached value carries one of five classes, declared in `DOMAIN_PRIVACY`
in `services/cache.service.js`:

| Class | Meaning | SWR |
|---|---|---|
| `PUBLIC` | Any caller may see it | Allowed |
| `PRIVATE_USER` | Scoped to one user; the user id is **in the key** | Forbidden |
| `PRIVATE_ORGANIZATION` | Scoped to one org/community, for its members | Forbidden |
| `PRIVATE_EVENT` | Scoped to one event's non-public data | Forbidden |
| `PRIVATE_ADMIN` | Platform-operator data; must never reach a user | Forbidden |

Why five and not two: a binary public/private flag is enough to decide whether
stale-while-revalidate is safe, but not enough to answer the question that
matters during an incident — *whose data is in this key, and what is the blast
radius if it leaks?* A leaked `TRENDING` list is a bug. A leaked `FEED` is a
privacy breach. Collapsing them into one word loses exactly the distinction
the on-call engineer needs.

Rules:

- The identity is **part of the key**, never an argument. If it were an
  argument, two users would share one entry.
- Stale-while-revalidate is forbidden on all four private classes, because SWR
  serves a value written for an earlier request without re-checking who is
  asking.
- `privacy` is **derived** from `DOMAIN_PRIVACY`, never written by hand in
  `CACHE_REGISTRY`. Part 6 kept the two lists separately, which meant they
  could drift — and a domain that drifted out of the private list would
  silently become eligible for SWR. Drift is now an impossible state.
- The legacy `user` domain is retained even though no builder emits it,
  because keys written by older builds still exist in a live Redis and are
  still readable. Privacy rules have to cover the data that is out there, not
  just the data this build writes.

**Current classification.** `PRIVATE_EVENT` and `PRIVATE_ADMIN` are declared
but unused — no cached value holds event-private or operator-only data today.
They exist so that the day one is added it has an obvious home: an
unclassifiable new domain is then a decision, not an accident.

---

## 6. §15 — Tokens and CSRF

### The auth model, as it actually is

Authentication is **bearer-token**, not cookie-based. On a successful login the
API returns a signed JWT **in the response body**; the client stores it and
sends it on every request as:

```
Authorization: Bearer <jwt>
```

`middleware/auth.middleware.js` reads exactly that header. **The API sets no
cookies** — there is no `res.cookie` call anywhere in the codebase, and a test
in `tests/phase13.selftest.js` asserts both halves of that statement, so this
section cannot drift from the code again.

This matters because an earlier draft of this document described a
cookie-based model with `HttpOnly`/`Secure`/`SameSite` settings. That
description was wrong, and a security document describing a model the system
does not use is worse than no document: it sends the next reader looking for
controls that do not exist, and reassures them about protections they do not
have. The model is recorded here because §15 asks for it explicitly.

### CSRF does not apply — deliberately

**CSRF protection is not implemented, and it should not be.**

CSRF is an attack on *ambient authority*: the browser automatically attaches a
credential to a cross-site request, so an attacker's page can act as the
victim without ever learning the credential. That is a property of **cookies**.

A bearer token is not attached automatically. The client has to read it from
storage and set the header explicitly, which an attacker's origin cannot do
without reading the token first — and if they can read the token, they already
have it and CSRF is not the interesting attack any more.

Adding a CSRF-token scheme to a pure bearer-token API would therefore add a
second, separately-implemented mechanism defending against an attack that
cannot occur, plus a new way to get it wrong. §15's rule is that CSRF applies
*only where cookie authentication applies*; here it does not.

**This is conditional, not permanent.** If a session cookie is ever introduced
— for a server-rendered admin console, say — CSRF protection becomes mandatory
at the same moment, along with `SameSite` and the rest. The condition is
recorded so the decision is revisited rather than forgotten.

### Token handling

Because there is no HttpOnly cookie, the token is readable by JavaScript, which
makes **XSS the primary session-stealing risk** and raises the importance of
§27 (frontend security) correspondingly. The mitigations are:

- **Short expiry.** `JWT_EXPIRES_IN` bounds the window in which a stolen token
  is useful.
- **Never in a URL.** Tokens travel in a header, never in a query string, where
  they would land in access logs, `Referer` headers and browser history.
- **Never logged.** A login failure logs *that* it failed and why, never the
  credential or the token that was tried. Asserted in `tests/phase13.selftest.js`.
- **Server-side revocation.** Suspension is checked against the database on
  every authenticated request, so an existing token is not a bypass: suspending
  an account revokes its sessions immediately rather than at token expiry.

### Login

- The same `Invalid credentials` response is returned for an unknown address
  and a wrong password, so the endpoint cannot be used to enumerate accounts.
- Unverified and suspended accounts are rejected with distinct statuses.
- Repeated failures are rate-limited (§29).

### What is never logged

Passwords, OTPs, tokens and reset links.
## 7. Error handling

No infrastructure detail reaches a user. A user sees a stable error code and a
safe message — never a provider name, a quota, a stack trace, or a database
error. Provider failures are logged server-side, scrubbed, with enough detail
to debug and without the credentials.
