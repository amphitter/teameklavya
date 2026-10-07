# WHY PROFILE EDITING DOES NOT WORK — the dead wire

Traced end to end. The parts exist; **the connection between them does not.**
The user's report ("no profile section is updated") is correct, and the cause is
not a broken handler — it is that the working UI is never rendered.

## The chain, as it actually is

```
/profile/<me>          components?  "Edit profile" button
                                   → router.push("/user/profile")     ← dead end
/user/profile          renders  components/profile-view.tsx
                                   → inline form: institution / course / year
                                     … that is ALL it can edit
                                   ✗ no username  ✗ no avatar  ✗ no banner

components/profile/profile-view.tsx
  └─ imports <EditProfileSheet/> — complete, correct, 335 lines
     (username + live availability, avatar, cover, bio, location, interests,
      privacy, unsaved-changes guard)
  → NOTHING IMPORTS THIS FILE. It is orphaned.
```

Verified: `grep -rn "components/profile/profile-view"` over the whole frontend
returns **zero** results.

## So the feature is built but unreachable

| Piece | State |
|---|---|
| `PUT /api/auth/me/profile` (backend) | ✅ complete — validates + persists username, avatar, coverImage, bio, location, interests, institution, privacy |
| `GET /api/auth/username-availability` | ✅ working, debounced client-side |
| `edit-profile-sheet.tsx` | ✅ complete and correct |
| `media-uploader.tsx` (avatar + cover) | ⚠️ works, but **no reposition/crop** |
| Reachable entry point | ❌ **none** |
| Cover reposition (§7) | ❌ not implemented anywhere |

That is why nothing updates: the only reachable edit form writes three
text fields that appear nowhere prominent, and the username/avatar/banner UI
was never wired to a screen.

## Secondary gaps against §2–7

- **Cover repositioning** was an explicit acceptance criterion
  ("uploadable / croppable / repositionable / removable"). No control existed.
- The orphaned sheet's uploader writes the URL straight to the backend on
  upload, then the sheet also sends `avatar`/`coverImage` on save — two writes
  for one change.
- After a save, the session user and the query cache are not refreshed, so the
  header avatar and posts keep the old identity until a reload (§2–7 require
  propagation "everywhere without logout").
