# Phase 2 — the canonical avatar and cover

> Part 11 §5-9, §24-27. Status: **done, verified live and in unit tests.**
> Previous phase: `170c4e5` (Phase 1 — save reports the truth, header clickable).

## The defect, in one sentence

The app stored the **whole uploaded photo** and let every surface crop it
independently: different containers, different breakpoints, different device
pixel ratios. So the same person was framed differently on a phone, a laptop,
the feed, a comment, a chat list — and nothing could reconcile them, because
the requested crop was already different before any CSS ran. The mechanism was
in `ui/optimized-image.tsx`: a fixed box produced srcset entries like
`w_64,h_40`, `w_160,h_40`, `w_400,h_40` — a **constant height** across widths,
i.e. a different aspect ratio (and therefore a different crop) per entry. A
browser on a 1× screen picked the first, one on a 3× screen picked the second.

## The contract now

1. **One canonical file.** The crop editor renders the user's framing to a
   square (avatars, 512²) or a 3:1 frame (covers, 1600×533) **in the browser**,
   with EXIF (including GPS) dropped by the canvas round-trip, and uploads that
   file as the photo. Every surface then scales one asset instead of choosing
   its own crop.
2. **One shape per srcset.** A fixed box scales its height with its width
   (`w_64,h_64` … `w_800,h_800`), so every device gets the same composition at a
   different resolution. The rule lives in `src/lib/image-variants.ts` and is
   tested directly.
3. **No per-component cropping.** `UserAvatar` owns the box (square,
   `object-fit: cover`, centred) and does not accept an `object-position` from
   callers, so no screen can shift the framing. The shell's inline raw-`<img>`
   avatar is gone; 28 files share the one component.
4. **A versioned URL.** `avatarVersion` / `coverVersion` are bumped only when
   the asset changes and appended as `?v=`. Reloading keeps the same URL;
   replacing the photo changes it immediately. Never a render timestamp.
5. **The crop is stored, not implied.** `profile.avatarCrop` / `coverCrop`
   (four fractions of the original) persist next to the file so the editor
   re-opens on the user's framing, and the cover's focal point is derived from
   the crop so the two can never disagree.
6. **Legacy photos get a path.** A stored avatar with no crop is the marker for
   "uploaded before the editor existed": the sheet says so and offers a
   one-tap re-crop on the same photo. The API never invents a crop, so the
   signal stays truthful.
7. **The server checks what it is told.** `POST /upload/image?purpose=avatar|cover`
   validates the shape of the bytes it received (square / 3:1, with a 2%
   tolerance for whole-pixel rounding). Declaring nothing keeps the previous
   behaviour, so no existing client breaks — asserted, not assumed.

## Files

**New**
- `frontend/src/lib/crop.ts` — pure crop geometry (no React, no DOM).
- `frontend/src/lib/image-variants.ts` — the responsive-variant shape rule.
- `frontend/src/utils/canonical-image.ts` — canvas render → `File`; 512² / 1600×533.
- `frontend/src/components/media/crop-editor.tsx` — the editor: pan (pointer
  capture), pinch, wheel, double-tap reset, arrows/`+`/`-`/`0`/`Escape`,
  zoom slider, `touch-action: none`, dimmed surround, canonical render on
  confirm.
- `frontend/tests/{crop.test.js,image-variants.test.js}` + runners.
- `backend/tests/media-canonical.js` — 39 assertions on the upload + profile contract.
- `docs/mobile-qa/phase2.js`, `docs/mobile-qa/phase2-widths.js` — the live harnesses.

**Changed (why)**
- `user-avatar.tsx` — one canonical render everywhere; variants requested square;
  versioning applied centrally; `object-position` not settable from outside.
- `ui/optimized-image.tsx` — uses the tested shape rule for both `src` and `srcset`.
- `profile/media-uploader.tsx` — crop before upload; persists crop + version;
  publishes the new identity to the session; legacy re-crop and **Re-crop** for
  a photo that already has one.
- `profile/edit-profile-sheet.tsx` — carries crop/version with the image URL on
  save, derives the cover focal point from the crop.
- `shell/app-shell.tsx` — header/nav avatars now use the shared component (they
  had their own raw `<img>` at a single size: a fourth crop of the same photo).
- `stories/story-rail.tsx` — rings carry the version too.
- `shell/use-session-user.ts` — the session type includes the crop/version, and
  a session stored without a profile is healed by ONE deduped `/auth/me` fetch
  per page load (never awaited, so it adds no wait before the page's own requests).
- `controllers/auth.controller.js` — `profile` in the login payload (the shell
  renders the account avatar from it), crop/version writes with validation,
  `/uploads/…` accepted as a stored image path.
- `controllers/user.controller.js` — a private profile's identity block carries
  `avatarVersion` (otherwise it would serve a replaced photo from cache forever).
- `models/user.model.js` — `avatarCrop` / `coverCrop` (a value object, no `_id`)
  and the two version counters.
- `services/media.service.js` + `routes/upload.routes.js` — declared canonical
  shapes validated on the bytes.
- `next.config.ts` — the same-origin preview proxies `/uploads/*` (inert unless
  `BACKEND_PROXY_URL` is set; production untouched).

## Defects this work found and fixed (each was verified live)

| # | Defect | How it showed |
|---|--------|---------------|
| 1 | Constant srcset height → a different crop per device | unit test + code audit (the audit's mechanism) |
| 2 | The **shell/nav avatar kept the old photo** after an upload | live: the header showed a different asset than the profile header |
| 3 | Same again for the **login payload** (no `profile`), so a member with a photo saw initials in the header all session | live: `login user.profile = undefined` |
| 4 | The **profile page's own copy** was never told about an image write — the banner/photo behind the sheet stayed old until a reload | live: profile header showed the previous run's photo after the new upload |
| 5 | The edit sheet's **avatar preview rendered as a 25×80 oval** (flex item squeezed by the button row) | live: surface dump, box `[25,80]` |
| 6 | The profile header's **avatar ring stretched full width** — a giant pill outline lying across the cover | live screenshot + `elementsFromPoint` |
| 7 | **Local-storage deployments could not save any image**: the provider returns `/uploads/…` and `sanitizeUrl` only accepted absolute http(s) URLs | backend test: "Profile photo must be a valid http(s) URL" for a photo already stored |
| 8 | A crop sub-document carried a Mongo `_id` | backend test comparing the stored crop |
| 9 | `initialCrop` was **unreachable** — nothing opened the editor on a photo that already had a crop (so the stored crop was written but never used) | audit while wiring; fixed by adding Re-crop |

## Evidence

**Unit / integration (all green)**
| Suite | Result |
|---|---|
| `frontend/tests/run-crop-tests.js` | 26 / 0 |
| `frontend/tests/run-variant-tests.js` | 15 / 0 |
| `backend/tests/media-canonical.js` | 39 / 0 |
| `backend/tests/profile-edit.js` | 53 / 0 |
| `backend/tests/part11-teams.js` | 82 / 0 |
| `backend/tests/part10-messages.js` | 59 / 0 |
| `backend/tests/part10-realtime.js` | 38 / 0 |
| `backend/tests/user-achievements-route.js` | 10 / 0 |
| `frontend/tests/run-query-tests.js` | 11 / 0 |
| `frontend/tests/run-messages-store-tests.js` | 38 / 0 |
| `tsc --noEmit` | clean |
| `npm run build` | ✓ |

**Live, in a real browser against the real backend** (`docs/mobile-qa/phase2.js`,
390×844 at DPR 3, seeded QA server, both flows exercised):

- **79 passed, 0 failed.** Includes: real touch drag panning the crop and
  clamping at the image edge; pinch zoom; the 4× limit landing on exactly 300px
  of a 1200px source; double-tap reset; **no page scroll during manipulation**
  with `touch-action: none` asserted computed; one confirm = one upload + one
  PUT; the saved crop matching the crop the editor displayed; the served file
  being the canonical 512×512; **the centre pixel of the avatar being the band
  the crop points at** (a deliberately off-centre framing, so a default centre
  crop could not pass); the same version on every surface; the version stable
  across reloads and changing when the photo is replaced; desktop (1280×900)
  requesting the same versioned asset; the legacy re-crop path; Re-crop
  restoring the stored framing; the cover's 3:1 frame, its crop, its derived
  focal point, and the rendered `object-position`; removal clearing the image
  AND the crop; no page errors.

- **Six widths, 0 failures** (`docs/mobile-qa/phase2-widths.js`): 320 / 360 /
  375 / 390 / 412 / 430 — no horizontal overflow on the profile or in the
  sheet, the crop frame square and inside the viewport, "Use photo" and the
  zoom slider hit-testable, the sheet's preview a true circle.

**Screenshots** — `/home/user/qa/profile-audit/phase2-*.png` (outside the repo):
editor at 390, profile after the second photo, profile with cover, after
removal, desktop.

## Known limits / carried forward

- No Cloudinary credentials in this environment, so delivery is local disk and
  the CDN srcset is not exercised live; the shape rule is covered by
  `run-variant-tests.js` instead. With Cloudinary configured, `?v=` appears in
  the same URLs and the variants are requested square.
- A photo that already has a canonical crop can be re-framed **within the file
  you have** (that is what the stored photo is). Re-framing from the untouched
  original would mean storing the original as well, which §6 explicitly does
  not ask for; the sheet's hint says which of the two you are doing.
- The profile header's stat block is still the old card grid — Phase 3 replaces
  it with the compact Posts / Followers / Following row.
- `components/profile-view.tsx` (the older `/user/profile` screen) shares the
  same avatar/cover contract but keeps its own layout until Phase 3.
