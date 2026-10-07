# Profile system — audit, before any fix

Written after measuring the running app at 1440×900 and 390×844, against a real
seeded backend, with Playwright driving the real UI. Every claim below has a
measurement behind it. Where the brief's guess and the code disagreed, the code
won and it is called out.

---

## 1. "Profile save shows 'Couldn't save profile' even though the backend returns 200"

**Reproduced, and the cause is not where the brief expected.**

The save request itself was always fine — HTTP 200, `{ success: true, user: … }`.
What broke is that **the caller never saw that response**. Two unwraps:

```js
// hooks/use-social.ts — unwrap #1
useMutation((body) => api.put("/auth/me/profile", body).then((r) => r.data), …)

// lib/query.ts — unwrap #2
const res = await request(vars);
return res.data;      // ← `res` is already the payload; res.data is undefined
```

`mutate()` therefore resolved `undefined` for **every** mutation written in that
style, and `edit-profile-sheet.tsx` did:

```js
const res = await save.mutate(payload);
if (res?.success) { …success… } else { toast.error("Couldn't save your profile") }
```

The success branch was unreachable. Instrumented proof:
`[TMP request] status=200 keys=success,message,user` immediately followed by
`[TMP mutate:return] undefined`.

Six of the seven mutations in the app are written in that style, so the same
latent bug sat under every one of them. It also meant the *other* half of the
brief was guaranteed: because the sheet's `else` branch is what produced the
toast, a 422, a 500, a cancellation and a success all produced the same
sentence. Nothing could be distinguished from anything.

**Fixed** in `unwrapAxios()`: a raw axios response carries `status` + `headers` +
`data` together, so it is unwrapped once; an already-unwrapped payload — even one
that happens to contain a `data` field — is passed through untouched.

## 2. "API Error: canceled" treated as a failure

The response interceptor logs `console.error("API Error:", …)` for every
rejection, cancellation included — hence the console line. The sheet's catch was
worse: it had none. `useMutation` swallowed the error and returned `undefined`,
so a cancellation was indistinguishable from a rejection *by construction*.

**Fixed**: `throwOnError` on the mutation, plus `classifySaveError()` — cancelled
/ network / validation / auth / server — with only the real failures speaking.
A cancelled request is now silent by design, and `isCancelled()` already
existed for the retry policy (a cancellation is never retried).

## 3. "There is a 500 — trace it, don't guess"

Traced to the profile page's own request:

```
GET /api/users/ana_roy/achievements → 500
Cast to ObjectId failed for value "ana_roy" (type string) at path "_id" for model "User"
```

`getUserAchievements` called `User.findById(req.params.id)` on a route that
accepts a username or an id. Every neighbouring handler in that file already
resolved either. So the console showed a 500 *next to* a successful save — two
unrelated problems sitting in the same screenshot.

**Fixed** (commit `b220728`), with `backend/tests/user-achievements-route.js`
pinning the username path, the id path, the 404, and the honest-achievements
rule.

## 4. "PUT /me/profile was happening twice"

**It was not.** With the corrected selectors the harness measured one click →
**one** PUT, before and after the fix. The duplicate saves in the logs were two
separate sheet sessions (two clicks), not a double submit: there is no
`onSubmit` + `onClick` pair — the button is `type="button"` with a single
`onClick`, not inside a form, and the build is a production build (no
StrictMode double-invoke).

**Still hardened**, because the *risk* is real: `canSave` goes false
asynchronously, so two clicks in one tick both read the old state and both fire.
A ref guard flips synchronously and cannot be raced.

## 5. The thing nobody asked about, which made the whole feature unreachable

**"Edit profile" could not be clicked with a mouse.**

```
elementFromPoint(centre of the Edit profile button) → <div class="relative h-28 … cover …">
button rect top=174   cover rect bottom=230
```

The cover strip is `position: relative`, the block that overlaps it with
`-mt-12` is static — so the cover painted **on top of** the name, the
`@username` and every header action. Visible, and inert. This is the same class
of defect as the Part 9 one (`docs/PART9_PROFILE_DEFECT.md`): the feature
existed, the code was correct, and the user could not reach it.

**Fixed** with `relative z-10` on the overlapping block — a stacking context,
not a raised z-index arms race.

## 6. Username availability

Measured 700 ms for a single indexed lookup — that is cold-connection latency,
not query time. The real cost was made by the caller: six keystrokes, and the
hook had no memory of answers it already had.

* debounce exists (400 ms) and works — 6 keystrokes → **1** request
* but the sheet fired the check whenever `username !== user.username`, so
  retyping your own handle made a pointless request. Now: no request at all
* results cached 5 minutes per username, not 30 seconds
* the server now answers "that is your own username" without a database query

## 7. Messages — "right side me kaafi faltu gap" and "scroll bar"

Both measured at 1440×900:

| Symptom | Measurement | Cause |
|---|---|---|
| Wide dead band on the right | messages surface 1024px wide (328→1352) inside a 1200px column: **88px empty on each side** | `max-w-5xl` on both message routes |
| A scrollbar in the message box | the growing `textarea` keeps `overflow: auto`; at full height (132px) it overflows and the app's **global** `::-webkit-scrollbar { width: 10px }` draws inside the pill | no scrollbar suppression on the composer |

The composer *row* itself measured clean (`scrollW == clientW`, 8px padding) —
worth recording, because the obvious suspects (flex gap, padding) were all
innocent.

---

## What the brief assumed that the code did not support

* **"PUT happens twice"** — it does not; two clicks did. Recorded rather than
  "fixed" so the next reader is not sent chasing a phantom.
* **"The 500 hides behind the save"** — they are independent: the 500 is the
  achievements fetch, the save is a separate 200.
* **"object-fit: cover is not enough"** — correct, and the deeper point is
  right: today every surface crops the *original* upload independently, so the
  same file yields different framing per device. Phase 2 replaces that with one
  canonical square produced once, plus resolution variants of that same crop.
