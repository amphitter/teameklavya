# Vercel build failure — diagnosis and the parse gate

## What the log said

```
./src/app/(app)/events/[slug]/page.tsx    1083  Expected ',', got 'open'
./src/app/(app)/profile/[id]/page.tsx     434   Expected ',', got 'open'
./src/app/(app)/quiz/[id]/page.tsx        176   Expected '</', got '('
```

## What those three errors actually are

Using Next's own SWC parser (`next/dist/build/swc`), each error string was
reproduced by a single character-level slip:

| error | produced by | fix |
| --- | --- | --- |
| `Expected ',', got 'open'` | two adjacent elements returned without a fragment wrapper — i.e. the `<>` line above `<ReportDialog` is missing | put `<>` back (events + profile both have it committed) |
| `Expected '</', got '('` | a JSX comment whose closing brace was lost: `{/* results */` instead of `{/* results */}` | close the brace |

SWC stops at the *first* mistake, which is why the `{quiz.description …}` line
appears to be the problem: with the comment left open, everything after it is
garbage to the parser.

## Why no committed revision matches the log

Every historical revision of the three files parses cleanly — including the
Oct-6 `b07b173 "Major platform update"` whose line numbers (1083, 434, 177) and
neighbouring source lines match the log exactly. So the deployed tree carries
character-level edits that are not in git: one lost `<>` fragment line in each
of the two Dialog tails and one missing `}` in a JSX comment.

Those three edits are almost certainly an artefact of a bulk text edit applied
during that import — `</div>` then `<ReportDialog` is exactly where an automated
per-file transformation would drop the fragment line, and a JSX comment missing
its brace is a classic regex casualty.

**They cannot be committed from here**: the workspace copy of every one of those
files is the correct, parsing version, and `npm run build` on the current `main`
compiles clean. Recovering the deployed tree would mean overwriting working code
with the broken text, so instead:

## What was added

`frontend/scripts/parse-check.js`, wired as **`prebuild`** (and available as
`npm run check:syntax`):

* parses every `.ts/.tsx/.js/.jsx` under `src/` with `next/dist/build/swc` — the
  same parser `next build` uses, so there are no false positives
* reports the file, SWC's own `x …` headline and the `,-[line:col]` position
* exits 1 before the framework boots, so a build fails in ~1 second and in CI,
  not after a full `npm install` on Vercel

```
$ node scripts/parse-check.js
parse-check: 193 files parsed clean
```

```
$ npm run build          # prebuild runs first
> node scripts/parse-check.js
parse-check: 193 files parsed clean
 ✓ Compiled successfully
```

Verified by planting a file with exactly the first error from the log:

```
$ node scripts/parse-check.js src/__parse_probe/broken.tsx
parse-check: 1 file CANNOT BE PARSED

  src/__parse_probe/broken.tsx
    x Expected ',', got 'open'   ,-[4:1]
```

If the Vercel deployment is still building a tree that fails, the fix is to let
it build the committed `main` (`b27cbb1`) — the three files there are the correct
ones — or to re-apply the two edits described in the table above.
