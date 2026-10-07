#!/usr/bin/env node
/**
 * The responsive-variant shape rule — the fix for "cropped differently on every device".
 *
 *   node tests/run-variant-tests.js
 *
 * This is the defect in one sentence: the old srcset asked for a fixed HEIGHT
 * at every width (`w_64,h_40`, `w_160,h_40`, …). Two entries with different
 * aspect ratios are two different crops, so the browser — which picks an entry
 * by width and device pixel ratio — showed a different slice of the same photo
 * on a phone and a laptop. Nothing in the app could compensate, because the
 * requested crop was already different before any CSS ran.
 *
 * Asserted here:
 *   • a fixed box keeps its SHAPE at every width (height scales with width)
 *   • a bare width stays a resize — no height is fabricated
 *   • the exact regression cannot come back: no two entries share a height
 *     while having different widths
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const work = path.join(__dirname, ".variant-build");

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.copyFileSync(path.join(root, "src/lib/image-variants.ts"), path.join(work, "image-variants.ts"));

execFileSync(
  path.join(root, "node_modules/.bin/tsc"),
  [
    path.join(work, "image-variants.ts"),
    "--outDir",
    path.join(work, "out"),
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--strict",
  ],
  { stdio: "inherit" }
);

const { buildSrcset, heightForWidth, isFixedBox } = require(path.join(work, "out", "image-variants.js"));

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n── ${t} ──`);

/** A fake CDN encoder that records what was asked for. */
const asks = [];
const encode = (w, h) => {
  asks.push([w, h]);
  return `https://cdn.example.com/image/upload/w_${w}${h ? `,h_${h}` : ""}/a.jpg`;
};

const AVATAR_WIDTHS = [64, 160, 400, 800]; // VARIANT_PRESETS.avatar
const POSTER_WIDTHS = [320, 640, 1024, 1600];

section("an avatar box is square at every width");
asks.length = 0;
const avatarSet = buildSrcset(AVATAR_WIDTHS, { width: 40, height: 40 }, encode);
ok(asks.length === 4, "four entries, one per preset width", JSON.stringify(asks));
ok(
  asks.every(([w, h]) => w === h),
  "every entry asks for a square (64×64, 160×160, 400×400, 800×800)",
  JSON.stringify(asks)
);
ok(/ 64w/.test(avatarSet) && / 800w/.test(avatarSet), "…and the srcset still carries the width descriptors", avatarSet);

section("a square box for a 96px avatar stays square after rounding");
asks.length = 0;
buildSrcset([64, 96, 160, 240], { width: 96, height: 96 }, encode);
ok(
  asks.every(([w, h]) => w === h),
  "no width/height pair drifts apart through Math.round",
  JSON.stringify(asks)
);

section("the regression itself: a constant height across widths");
asks.length = 0;
buildSrcset(POSTER_WIDTHS, { width: 320, height: 180 }, encode);
const heights = asks.map(([, h]) => h);
ok(new Set(heights).size > 1, "a 16:9 card never asks for the same height at four widths", JSON.stringify(asks));
ok(
  asks.every(([w, h]) => Math.abs(w / h - 16 / 9) < 0.01),
  "every entry keeps the 16:9 shape (320×180, 640×360, 1024×576, 1600×900)",
  JSON.stringify(asks)
);
ok(
  !(heights.length === 4 && heights.every((h) => h === heights[0])),
  "explicitly NOT the old behaviour (a fixed height with a varying width)",
  JSON.stringify(asks)
);

section("a bare width stays a resize, not a crop");
ok(!isFixedBox({ width: 640 }), "width alone is not a fixed box");
ok(heightForWidth(1024, { width: 640 }) === undefined, "so no height is fabricated");
asks.length = 0;
buildSrcset([320, 640], { width: 640 }, encode);
ok(
  asks.every(([, h]) => h === undefined),
  "…and the entries carry no height parameter at all",
  JSON.stringify(asks)
);
ok(!isFixedBox({}), "no dimensions at all is also a resize");

section("a non-transformable source produces no srcset");
asks.length = 0;
const none = buildSrcset(AVATAR_WIDTHS, { width: 40, height: 40 }, () => null);
ok(none === undefined, "local/legacy uploads get no srcset instead of four copies of one URL");
ok(buildSrcset([], { width: 40, height: 40 }, encode) === undefined, "an empty preset produces nothing");

section("extreme boxes are still sane");
ok(heightForWidth(1, { width: 1000, height: 1 }) === 1, "a sliver never rounds to a zero height");
ok(heightForWidth(1600, { width: 1600, height: 533 }) === 533, "the canonical cover round-trips exactly");

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
